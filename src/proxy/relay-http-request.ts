import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { RelayRecord } from "../relay/relay-types";
import { connectViaRelay } from "./connect-via-relay";
import { openPlainHttpProxySocket } from "./http-plain";
import {
  buildHttpProxyRequest,
  buildProxyAuthHeader,
  formatHttpHeaders,
  openHttpProxySocket,
} from "./http-upstream";
import { readUntilHeaderEnd, waitForSocketDrain } from "./socket-utils";

const UPSTREAM_HEADER_READ_TIMEOUT_MS = 10_000;

export async function relayHttpRequest(
  relay: RelayRecord,
  method: string,
  targetUrl: URL,
  headers: Record<string, string | string[] | undefined>,
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
  sessionKey?: string,
  onRelayUsed?: () => void,
): Promise<void> {
  if (relay.protocol === "http") {
    await relayViaHttpProxy(
      relay,
      method,
      targetUrl,
      headers,
      clientRequest,
      clientResponse,
      onRelayUsed,
    );
  } else if (relay.protocol === "http-plain") {
    await relayViaHttpPlain(
      relay,
      method,
      targetUrl,
      headers,
      clientResponse,
      onRelayUsed,
    );
  } else {
    await relayViaSocks5(
      relay,
      method,
      targetUrl,
      headers,
      clientRequest,
      clientResponse,
      sessionKey,
      onRelayUsed,
    );
  }
}

async function relayViaHttpProxy(
  relay: RelayRecord,
  method: string,
  targetUrl: URL,
  headers: Record<string, string | string[] | undefined>,
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
  onRelayUsed?: () => void,
): Promise<void> {
  const upstreamSocket = await openHttpProxySocket(relay);

  try {
    const authHeader = buildProxyAuthHeader(relay);
    if (authHeader) {
      headers["proxy-authorization"] = authHeader.replace(
        "Proxy-Authorization: ",
        "",
      );
    }
    upstreamSocket.write(buildHttpProxyRequest(method, targetUrl, headers));
    await relayStreamedResponse(
      upstreamSocket,
      clientRequest,
      clientResponse,
      onRelayUsed,
    );
  } catch (error) {
    upstreamSocket.destroy();
    throw error;
  }
}

async function relayViaHttpPlain(
  relay: RelayRecord,
  method: string,
  targetUrl: URL,
  headers: Record<string, string | string[] | undefined>,
  clientResponse: ServerResponse,
  onRelayUsed?: () => void,
): Promise<void> {
  const upstreamSocket = await openPlainHttpProxySocket(relay);

  try {
    upstreamSocket.write(buildHttpProxyRequest(method, targetUrl, headers));

    const parsed = await parseUpstreamResponse(upstreamSocket);
    if (isProxyLevelError(parsed.statusCode)) {
      throw new Error(
        `Upstream proxy returned ${parsed.statusCode}: ${parsed.statusLine}`,
      );
    }

    commitResponse(upstreamSocket, clientResponse, parsed);
    onRelayUsed?.();
  } catch (error) {
    upstreamSocket.destroy();
    throw error;
  }
}

async function relayViaSocks5(
  relay: RelayRecord,
  method: string,
  targetUrl: URL,
  headers: Record<string, string | string[] | undefined>,
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
  sessionKey?: string,
  onRelayUsed?: () => void,
): Promise<void> {
  const upstreamSocket = await connectViaRelay(
    relay,
    targetUrl.hostname,
    Number(targetUrl.port || 80),
    sessionKey,
  );

  try {
    const path = `${targetUrl.pathname}${targetUrl.search}`;
    const requestLine = `${method} ${path || "/"} HTTP/1.1`;
    upstreamSocket.write(formatHttpHeaders(requestLine, headers));
    await relayStreamedResponse(
      upstreamSocket,
      clientRequest,
      clientResponse,
      onRelayUsed,
    );
  } catch (error) {
    upstreamSocket.destroy();
    throw error;
  }
}

async function relayStreamedResponse(
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

    readAndPipeResponse(upstreamSocket, clientResponse, onHeadersReady)
      .then(resolve)
      .catch((error) => {
        upstreamSocket.destroy();
        reject(error);
      });
  });
}

async function readAndPipeResponse(
  upstreamSocket: Socket,
  clientResponse: ServerResponse,
  onHeadersReady?: () => void,
): Promise<void> {
  const parsed = await parseUpstreamResponse(upstreamSocket);

  onHeadersReady?.();
  clientResponse.writeHead(
    parsed.statusCode,
    parsed.statusMessage,
    parsed.responseHeaders,
  );
  if (parsed.bodyRemainder.length > 0) {
    clientResponse.write(parsed.bodyRemainder);
  }

  upstreamSocket.resume();
  upstreamSocket.pipe(clientResponse);
  await new Promise<void>((resolve, reject) => {
    clientResponse.once("finish", resolve);
    clientResponse.once("error", reject);
    upstreamSocket.once("error", reject);
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

interface ParsedUpstreamResponse {
  statusCode: number;
  statusMessage: string;
  statusLine: string;
  responseHeaders: Record<string, string>;
  bodyRemainder: Buffer;
}

async function parseUpstreamResponse(
  upstreamSocket: Socket,
): Promise<ParsedUpstreamResponse> {
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
  parsed: ParsedUpstreamResponse,
): void {
  clientResponse.writeHead(
    parsed.statusCode,
    parsed.statusMessage,
    parsed.responseHeaders,
  );
  if (parsed.bodyRemainder.length > 0) {
    clientResponse.write(parsed.bodyRemainder);
  }

  upstreamSocket.resume();
  upstreamSocket.pipe(clientResponse);
}

function isProxyLevelError(statusCode: number): boolean {
  return statusCode === 407 || statusCode === 403 || statusCode === 502;
}
