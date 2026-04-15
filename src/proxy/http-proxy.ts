import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { createLogEvent } from "../logging/proxy-request-logger";
import type { RelayRecord } from "../relay/relay-types";
import { connectViaRelay } from "./connect-via-relay";
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

  const lastError = await tryRelays(
    createRetryDeps(runtime, sessionKey),
    async (relay) => {
      if (relay.protocol === "http") {
        await handleHttpViaHttpProxy(
          clientRequest,
          clientResponse,
          relay,
          targetUrl,
          headers,
          () => logHttpRelay(relay),
        );
      } else {
        await handleHttpViaSocks5(
          clientRequest,
          clientResponse,
          relay,
          targetUrl,
          headers,
          sessionKey,
          () => logHttpRelay(relay),
        );
      }
    },
  );

  if (lastError) {
    clientResponse.writeHead(502, { "content-type": "application/json" });
    clientResponse.end(JSON.stringify({ error: lastError.message }));
  }
}

async function handleHttpViaSocks5(
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
  relay: RelayRecord,
  targetUrl: URL,
  headers: Record<string, string | string[] | undefined>,
  sessionKey: string | undefined,
  onRelaySuccess: () => void,
): Promise<void> {
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
    onRelaySuccess,
  );
}

async function handleHttpViaHttpProxy(
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
  relay: RelayRecord,
  targetUrl: URL,
  headers: Record<string, string | string[] | undefined>,
  onRelaySuccess: () => void,
): Promise<void> {
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
    onRelaySuccess,
  );
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
