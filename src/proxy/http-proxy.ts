import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { ProxyRequestLogger } from "../logging/proxy-request-logger";
import type { RelayRecord } from "../relay/relay-types";
import type { StatsTracker } from "../stats";
import {
  buildHttpProxyRequest,
  buildProxyAuthHeader,
  connectViaHttpProxy,
  formatHttpHeaders,
  openHttpProxySocket,
} from "./http-upstream";
import type { RelayRetryDeps } from "./relay-retry";
import { tryRelays } from "./relay-retry";
import {
  onceSocketClosed,
  readUntilHeaderEnd,
  waitForSocketDrain,
} from "./socket-utils";
import { connectViaSocks5 } from "./socks5";

const UPSTREAM_HEADER_READ_TIMEOUT_MS = 10_000;

export interface ProxyRuntime {
  pickRelay: () => RelayRecord | undefined;
  pickStickyRelay: (sessionKey: string) => RelayRecord | undefined;
  rememberStickyRelay: (sessionKey: string, relayHostname: string) => void;
  clearStickyRelay: (sessionKey: string) => void;
  markRelayUnhealthy: (hostname: string) => void;
  requestLogger: ProxyRequestLogger;
  statsTracker: StatsTracker;
}

export async function handleHttpProxyRequest(
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
  runtime: ProxyRuntime,
): Promise<void> {
  const targetUrl = parseProxyTarget(clientRequest.url);
  const sessionKey = parseStickySessionHeader(
    clientRequest.headers["x-proxy-session"],
  );
  if (!targetUrl || targetUrl.protocol !== "http:") {
    clientResponse.writeHead(400, { "content-type": "application/json" });
    clientResponse.end(
      JSON.stringify({
        error: "Proxy requests must use an absolute http:// URL",
      }),
    );
    return;
  }

  const headers = { ...clientRequest.headers };
  delete headers["proxy-connection"];
  headers.host = targetUrl.host;
  headers.connection = "close";

  const lastError = await tryRelays(
    createRetryDeps(runtime, sessionKey),
    async (relay) => {
      if (relay.protocol === "http") {
        await handleHttpViaHttpProxy(
          clientRequest,
          clientResponse,
          runtime,
          relay,
          targetUrl,
          headers,
        );
      } else {
        await handleHttpViaSocks5(
          clientRequest,
          clientResponse,
          runtime,
          relay,
          targetUrl,
          headers,
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
  runtime: ProxyRuntime,
  relay: RelayRecord,
  targetUrl: URL,
  headers: Record<string, string | string[] | undefined>,
): Promise<void> {
  const upstreamSocket = await connectViaSocks5(
    relay,
    targetUrl.hostname,
    Number(targetUrl.port || 80),
  );

  await new Promise<void>((resolve, reject) => {
    upstreamSocket.once("error", reject);
    writeHttpRequest(
      upstreamSocket,
      clientRequest.method ?? "GET",
      `${targetUrl.pathname}${targetUrl.search}`,
      headers,
    );
    void forwardRequestBody(clientRequest, upstreamSocket).catch((error) => {
      upstreamSocket.destroy();
      reject(error);
    });

    relayHttpResponse(upstreamSocket, clientResponse, () => {
      runtime.requestLogger.log({
        timestamp: new Date().toISOString(),
        requestType: "http",
        destinationHost: targetUrl.hostname,
        destinationPort: Number(targetUrl.port || 80),
        relayHostname: relay.hostname,
        relaySource: relay.source,
      });
    })
      .then(resolve)
      .catch((error) => {
        upstreamSocket.destroy();
        reject(error);
      });
  });
}

async function handleHttpViaHttpProxy(
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
  runtime: ProxyRuntime,
  relay: RelayRecord,
  targetUrl: URL,
  headers: Record<string, string | string[] | undefined>,
): Promise<void> {
  const upstreamSocket = await openHttpProxySocket(relay);

  await new Promise<void>((resolve, reject) => {
    upstreamSocket.once("error", reject);

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

    void forwardRequestBody(clientRequest, upstreamSocket).catch((error) => {
      upstreamSocket.destroy();
      reject(error);
    });

    relayHttpResponse(upstreamSocket, clientResponse, () => {
      runtime.requestLogger.log({
        timestamp: new Date().toISOString(),
        requestType: "http",
        destinationHost: targetUrl.hostname,
        destinationPort: Number(targetUrl.port || 80),
        relayHostname: relay.hostname,
        relaySource: relay.source,
      });
    })
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

export async function handleConnectTunnel(
  requestUrl: string | undefined,
  clientSocket: Socket,
  head: Buffer,
  runtime: ProxyRuntime,
  sessionKey?: string,
): Promise<void> {
  const destination = parseConnectTarget(requestUrl);
  if (!destination) {
    clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  const lastError = await tryRelays(
    createRetryDeps(runtime, sessionKey),
    async (relay) => {
      const upstreamSocket =
        relay.protocol === "http"
          ? await connectViaHttpProxy(relay, destination.host, destination.port)
          : await connectViaSocks5(relay, destination.host, destination.port);
      runtime.requestLogger.log({
        timestamp: new Date().toISOString(),
        requestType: "connect",
        destinationHost: destination.host,
        destinationPort: destination.port,
        relayHostname: relay.hostname,
        relaySource: relay.source,
      });
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

      if (head.length > 0) {
        upstreamSocket.write(head);
      }

      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);

      await Promise.race([
        onceSocketClosed(clientSocket),
        onceSocketClosed(upstreamSocket),
      ]);
    },
  );

  if (lastError) {
    clientSocket.write(
      `HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(lastError.message)}\r\n\r\n${lastError.message}`,
    );
    clientSocket.destroy();
  }
}

function createRetryDeps(
  runtime: ProxyRuntime,
  sessionKey?: string,
): RelayRetryDeps {
  const stickyRelay = sessionKey
    ? runtime.pickStickyRelay(sessionKey)
    : undefined;
  let stickyRelayAvailable = Boolean(stickyRelay);

  const deps: RelayRetryDeps = {
    pickRelay: () => {
      if (stickyRelayAvailable) {
        stickyRelayAvailable = false;
        return stickyRelay;
      }

      return runtime.pickRelay();
    },
    markRelayUnhealthy: runtime.markRelayUnhealthy,
    statsTracker: runtime.statsTracker,
  };

  if (sessionKey) {
    deps.onRelaySuccess = (relay) => {
      runtime.rememberStickyRelay(sessionKey, relay.hostname);
    };
    deps.onRelayFailure = (relay) => {
      if (relay.hostname === stickyRelay?.hostname) {
        runtime.clearStickyRelay(sessionKey);
      }
    };
  }

  return deps;
}

function parseStickySessionHeader(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const sessionKey = value.trim();
  return sessionKey ? sessionKey : undefined;
}

function parseConnectTarget(
  authority: string | undefined,
): { host: string; port: number } | undefined {
  if (!authority) {
    return undefined;
  }

  const separator = authority.lastIndexOf(":");
  if (separator <= 0) {
    return undefined;
  }

  const host = authority.slice(0, separator);
  const port = Number(authority.slice(separator + 1));
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65_535) {
    return undefined;
  }

  return { host, port };
}
