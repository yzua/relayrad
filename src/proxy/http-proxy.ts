import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { createLogEvent } from "../logging/proxy-request-logger";
import type { RelayRecord } from "../relay/relay-types";
import { connectViaRelay } from "./connect-via-relay";
import { openPlainHttpProxySocket } from "./http-plain";
import {
  buildHttpProxyRequest,
  buildProxyAuthHeader,
  formatHttpHeaders,
  openHttpProxySocket,
} from "./http-upstream";
import {
  createRetryDeps,
  type ProxyRuntime,
  parseStickySessionHeader,
  tryRelays,
} from "./relay-retry";
import { readUntilHeaderEnd, waitForSocketDrain } from "./socket-utils";

const UPSTREAM_HEADER_READ_TIMEOUT_MS = 10_000;

export async function handleHttpProxyRequest(
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
  runtime: ProxyRuntime,
): Promise<void> {
  const targetUrl = parseProxyTarget(clientRequest.url);
  const sessionKey = parseStickySessionHeader(
    clientRequest.headers["x-proxy-session"],
  );
  if (
    !targetUrl ||
    (targetUrl.protocol !== "http:" && targetUrl.protocol !== "ws:")
  ) {
    clientResponse.writeHead(400, { "content-type": "application/json" });
    clientResponse.end(
      JSON.stringify({
        error: "Proxy requests must use an absolute http:// or ws:// URL",
      }),
    );
    return;
  }

  const headers = { ...clientRequest.headers };
  delete headers["proxy-connection"];
  headers.host = targetUrl.host;
  headers.connection = "close";

  const logHttpRelay = (relay: RelayRecord) => {
    runtime.requestLogger.log(
      createLogEvent(
        "http",
        targetUrl.hostname,
        Number(targetUrl.port || 80),
        relay,
      ),
    );
  };

  const retryDeps = createRetryDeps(runtime, sessionKey);

  const lastError = await tryRelays(
    retryDeps,
    connectAndRelay(
      clientRequest,
      clientResponse,
      targetUrl,
      headers,
      sessionKey,
      () => logHttpRelay,
    ),
  );

  if (lastError) {
    if (!clientResponse.headersSent) {
      clientResponse.writeHead(502, { "content-type": "application/json" });
      clientResponse.end(JSON.stringify({ error: lastError.message }));
    }
  }
}

function connectAndRelay(
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
  targetUrl: URL,
  headers: Record<string, string | string[] | undefined>,
  sessionKey: string | undefined,
  getLogFn: () => (relay: RelayRecord) => void,
): (relay: RelayRecord) => Promise<void> {
  return async (relay: RelayRecord) => {
    const logRelay = getLogFn();

    if (relay.protocol === "http") {
      const upstreamSocket = await openHttpProxySocket(relay);
      const authHeader = buildProxyAuthHeader(relay);
      if (authHeader) {
        headers["proxy-authorization"] = authHeader.replace(
          "Proxy-Authorization: ",
          "",
        );
      }
      const requestText = buildHttpProxyRequest(
        clientRequest.method ?? "GET",
        targetUrl,
        headers,
      );
      upstreamSocket.write(requestText);
      await relayHttpThroughUpstream(
        upstreamSocket,
        clientRequest,
        clientResponse,
        () => logRelay(relay),
      );
    } else if (relay.protocol === "http-plain") {
      const upstreamSocket = await openPlainHttpProxySocket(relay);
      const requestText = buildHttpProxyRequest(
        clientRequest.method ?? "GET",
        targetUrl,
        headers,
      );
      upstreamSocket.write(requestText);

      const parsed = await readUpstreamResponse(upstreamSocket);
      if (isProxyLevelError(parsed.statusCode)) {
        upstreamSocket.destroy();
        throw new Error(
          `Upstream proxy returned ${parsed.statusCode}: ${parsed.statusLine}`,
        );
      }

      commitResponse(
        upstreamSocket,
        clientResponse,
        parsed.statusCode,
        parsed.statusMessage,
        parsed.responseHeaders,
        parsed.bodyRemainder,
      );
      logRelay(relay);
    } else {
      const upstreamSocket = await connectViaRelay(
        relay,
        targetUrl.hostname,
        Number(targetUrl.port || 80),
        sessionKey,
      );
      writeHttpRequest(
        upstreamSocket,
        clientRequest.method ?? "GET",
        `${targetUrl.pathname}${targetUrl.search}`,
        headers,
      );
      await relayHttpThroughUpstream(
        upstreamSocket,
        clientRequest,
        clientResponse,
        () => logRelay(relay),
      );
    }
  };
}

async function relayHttpThroughUpstream(
  upstreamSocket: Socket,
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
  onHeadersReady?: () => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    upstreamSocket.once("error", reject);

    void forwardRequestBody(clientRequest, upstreamSocket).catch((error) => {
      upstreamSocket.destroy();
      reject(error);
    });

    relayHttpResponse(upstreamSocket, clientResponse, onHeadersReady)
      .then(resolve)
      .catch((error) => {
        upstreamSocket.destroy();
        reject(error);
      });
  });
}

async function forwardRequestBody(
  clientRequest: IncomingMessage,
  upstreamSocket: Socket,
): Promise<void> {
  if (
    clientRequest.method === "GET" ||
    clientRequest.method === "HEAD" ||
    clientRequest.method === "DELETE"
  ) {
    return;
  }

  for await (const chunk of clientRequest) {
    if (!upstreamSocket.write(chunk)) {
      await waitForSocketDrain(upstreamSocket);
    }
  }
}

function writeHttpRequest(
  socket: Socket,
  method: string,
  path: string,
  headers: Record<string, string | string[] | undefined>,
): void {
  const requestLine = `${method} ${path || "/"} HTTP/1.1`;
  socket.write(formatHttpHeaders(requestLine, headers));
}

async function relayHttpResponse(
  upstreamSocket: Socket,
  clientResponse: ServerResponse,
  onHeadersReady?: () => void,
): Promise<void> {
  const initialChunk = await readUntilHeaderEnd(
    upstreamSocket,
    UPSTREAM_HEADER_READ_TIMEOUT_MS,
  );
  const headerEnd = initialChunk.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    throw new Error("Invalid upstream HTTP response");
  }

  const headerText = initialChunk.subarray(0, headerEnd).toString("utf8");
  const bodyRemainder = initialChunk.subarray(headerEnd + 4);
  const [statusLine, ...headerLines] = headerText.split("\r\n");
  const statusMatch = statusLine?.match(
    /^HTTP\/\d+\.\d+\s+(\d{3})(?:\s+(.*))?$/,
  );
  if (!statusMatch) {
    throw new Error("Invalid upstream HTTP status line");
  }

  const statusCode = Number(statusMatch[1]);
  const statusMessage = statusMatch[2] ?? "";
  const responseHeaders: Record<string, string> = {};
  for (const line of headerLines) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    responseHeaders[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim();
  }

  onHeadersReady?.();
  clientResponse.writeHead(statusCode, statusMessage, responseHeaders);
  if (bodyRemainder.length > 0) {
    clientResponse.write(bodyRemainder);
  }

  upstreamSocket.resume();
  upstreamSocket.pipe(clientResponse);
  await new Promise<void>((resolve, reject) => {
    clientResponse.once("finish", resolve);
    clientResponse.once("error", reject);
    upstreamSocket.once("error", reject);
  });
}

async function readUpstreamResponse(upstreamSocket: Socket): Promise<{
  statusCode: number;
  statusMessage: string;
  statusLine: string;
  responseHeaders: Record<string, string>;
  bodyRemainder: Buffer;
}> {
  const initialChunk = await readUntilHeaderEnd(
    upstreamSocket,
    UPSTREAM_HEADER_READ_TIMEOUT_MS,
  );
  const headerEnd = initialChunk.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    throw new Error("Invalid upstream HTTP response");
  }

  const headerText = initialChunk.subarray(0, headerEnd).toString("utf8");
  const bodyRemainder = initialChunk.subarray(headerEnd + 4);
  const [statusLine, ...headerLines] = headerText.split("\r\n");
  const statusMatch = statusLine?.match(
    /^HTTP\/\d+\.\d+\s+(\d{3})(?:\s+(.*))?$/,
  );
  if (!statusMatch) {
    throw new Error("Invalid upstream HTTP status line");
  }

  const statusCode = Number(statusMatch[1]);
  const statusMessage = statusMatch[2] ?? "";
  const responseHeaders: Record<string, string> = {};
  for (const line of headerLines) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    responseHeaders[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim();
  }

  return {
    statusCode,
    statusMessage,
    statusLine: statusLine ?? "",
    responseHeaders,
    bodyRemainder,
  };
}

function commitResponse(
  upstreamSocket: Socket,
  clientResponse: ServerResponse,
  statusCode: number,
  statusMessage: string,
  responseHeaders: Record<string, string>,
  bodyRemainder: Buffer,
): void {
  clientResponse.writeHead(statusCode, statusMessage, responseHeaders);
  if (bodyRemainder.length > 0) {
    clientResponse.write(bodyRemainder);
  }

  upstreamSocket.resume();
  upstreamSocket.pipe(clientResponse);
}

function parseProxyTarget(url: string | undefined): URL | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function isProxyLevelError(statusCode: number): boolean {
  return statusCode === 407 || statusCode === 403 || statusCode === 502;
}
