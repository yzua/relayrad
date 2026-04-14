import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { createLogEvent } from "../logging/proxy-request-logger";
import type { ProxyRuntime } from "./http-proxy";
import { createRetryDeps } from "./http-proxy";
import { connectViaHttpProxy, formatHttpHeaders } from "./http-upstream";
import { tryRelays } from "./relay-retry";
import { onceSocketClosed } from "./socket-utils";
import { connectViaSocks5 } from "./socks5";

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
      const connectPromise =
        relay.protocol === "http"
          ? connectViaHttpProxy(relay, destination.host, destination.port)
          : connectViaSocks5(
              relay,
              destination.host,
              destination.port,
              sessionKey,
            );

      const upstreamSocket = await raceConnectOrClientClose(
        connectPromise,
        clientSocket,
      );

      runtime.requestLogger.log(
        createLogEvent("connect", destination.host, destination.port, relay),
      );
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
    sendTunnelError(clientSocket, lastError.message);
  }
}

export async function handleWebSocketUpgrade(
  req: IncomingMessage,
  clientSocket: Socket,
  head: Buffer,
  runtime: ProxyRuntime,
  sessionKey?: string,
): Promise<void> {
  const target = parseWsTarget(req.url, req.headers.host);
  if (!target) {
    clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  const lastError = await tryRelays(
    createRetryDeps(runtime, sessionKey),
    async (relay) => {
      const connectPromise =
        relay.protocol === "http"
          ? connectViaHttpProxy(relay, target.host, target.port)
          : connectViaSocks5(relay, target.host, target.port, sessionKey);

      const upstreamSocket = await raceConnectOrClientClose(
        connectPromise,
        clientSocket,
      );

      runtime.requestLogger.log(
        createLogEvent("upgrade", target.host, target.port, relay),
      );

      writeWsUpgradeRequest(upstreamSocket, req, target);

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
    sendTunnelError(clientSocket, lastError.message);
  }
}

function parseWsTarget(
  url: string | undefined,
  hostHeader?: string,
): { host: string; port: number; path: string } | undefined {
  if (!url) return undefined;

  try {
    if (url.includes("://")) {
      const parsed = new URL(url);
      const defaultPort = parsed.protocol === "wss:" ? 443 : 80;
      const port = Number(parsed.port) || defaultPort;
      return {
        host: parsed.hostname,
        port,
        path: parsed.pathname + (parsed.search || ""),
      };
    }

    if (hostHeader) {
      const colonIdx = hostHeader.lastIndexOf(":");
      const hostname =
        colonIdx > 0 ? hostHeader.slice(0, colonIdx) : hostHeader;
      const port = colonIdx > 0 ? Number(hostHeader.slice(colonIdx + 1)) : 80;
      if (!hostname || !Number.isFinite(port) || port <= 0) return undefined;
      return { host: hostname, port, path: url };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function writeWsUpgradeRequest(
  socket: Socket,
  req: IncomingMessage,
  target: { host: string; port: number; path: string },
): void {
  const headers: Record<string, string | string[] | undefined> = {
    ...req.headers,
  };
  delete headers["proxy-connection"];
  delete headers["proxy-authorization"];
  headers["host"] =
    target.port === 80 || target.port === 443
      ? target.host
      : `${target.host}:${target.port}`;

  const requestLine = `${req.method ?? "GET"} ${target.path || "/"} HTTP/1.1`;
  socket.write(formatHttpHeaders(requestLine, headers));
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

async function raceConnectOrClientClose(
  connectPromise: Promise<Socket>,
  clientSocket: Socket,
): Promise<Socket> {
  let cleanupClientListeners: (() => void) | undefined;

  const clientGone = new Promise<never>((_, reject) => {
    const onEnd = () =>
      reject(new Error("Client disconnected before tunnel was established"));
    clientSocket.once("end", onEnd);
    clientSocket.once("close", onEnd);
    cleanupClientListeners = () => {
      clientSocket.off("end", onEnd);
      clientSocket.off("close", onEnd);
    };
  });

  try {
    const socket = await Promise.race([connectPromise, clientGone]);
    return socket;
  } finally {
    cleanupClientListeners?.();
  }
}

function sendTunnelError(socket: Socket, message: string): void {
  socket.write(
    `HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  );
  socket.destroy();
}
