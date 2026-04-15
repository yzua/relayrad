import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { createLogEvent } from "../logging/proxy-request-logger";
import { connectViaRelay } from "./connect-via-relay";
import { formatHttpHeaders } from "./http-upstream";
import { createRetryDeps, type ProxyRuntime, tryRelays } from "./relay-retry";
import { onceSocketClosed, sendSocketError } from "./socket-utils";

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

  await tunnelThroughRelay(
    clientSocket,
    runtime,
    sessionKey,
    destination,
    "connect",
    (upstreamSocket) => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) {
        upstreamSocket.write(head);
      }
    },
  );
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

  await tunnelThroughRelay(
    clientSocket,
    runtime,
    sessionKey,
    target,
    "upgrade",
    (upstreamSocket) => {
      writeWsUpgradeRequest(upstreamSocket, req, target);
      if (head.length > 0) {
        upstreamSocket.write(head);
      }
    },
  );
}

async function tunnelThroughRelay(
  clientSocket: Socket,
  runtime: ProxyRuntime,
  sessionKey: string | undefined,
  target: { host: string; port: number },
  logType: "connect" | "upgrade",
  onConnected: (upstreamSocket: Socket) => void,
): Promise<void> {
  const lastError = await tryRelays(
    createRetryDeps(runtime, sessionKey),
    async (relay) => {
      const connectPromise = connectViaRelay(
        relay,
        target.host,
        target.port,
        sessionKey,
      );

      const upstreamSocket = await raceConnectOrClientClose(
        connectPromise,
        clientSocket,
      );

      runtime.requestLogger.log(
        createLogEvent(logType, target.host, target.port, relay),
      );

      onConnected(upstreamSocket);

      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);

      await Promise.race([
        onceSocketClosed(clientSocket),
        onceSocketClosed(upstreamSocket),
      ]);
    },
  );

  if (lastError) {
    sendSocketError(clientSocket, 502, "Bad Gateway", lastError.message);
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
