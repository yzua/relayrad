import type { IncomingMessage, ServerResponse } from "node:http";
import { connect as connectTcp, type Socket } from "node:net";
import type { RelayRecord } from "./relay-types";

export interface ProxyRuntime {
  pickRelay: () => RelayRecord | undefined;
  markRelayUnhealthy: (hostname: string) => void;
}

export async function handleHttpProxyRequest(
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
  runtime: ProxyRuntime,
): Promise<void> {
  const targetUrl = parseProxyTarget(clientRequest.url);
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

  const lastError = await tryRelays(runtime, async (relay) => {
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

      relayHttpResponse(upstreamSocket, clientResponse)
        .then(resolve)
        .catch((error) => {
          upstreamSocket.destroy();
          reject(error);
        });
    });
  });

  if (lastError) {
    clientResponse.writeHead(502, { "content-type": "application/json" });
    clientResponse.end(JSON.stringify({ error: lastError.message }));
  }
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
    upstreamSocket.write(chunk);
  }
}

function writeHttpRequest(
  socket: Socket,
  method: string,
  path: string,
  headers: Record<string, string | string[] | undefined>,
): void {
  const lines = [`${method} ${path || "/"} HTTP/1.1`];

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        lines.push(`${name}: ${item}`);
      }
      continue;
    }

    lines.push(`${name}: ${value}`);
  }

  lines.push("", "");
  socket.write(lines.join("\r\n"));
}

async function relayHttpResponse(
  upstreamSocket: Socket,
  clientResponse: ServerResponse,
): Promise<void> {
  const initialChunk = await readUntilHeaderEnd(upstreamSocket);
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

function readUntilHeaderEnd(socket: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.includes("\r\n\r\n")) {
        cleanup();
        socket.pause();
        resolve(buffer);
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

export async function handleConnectTunnel(
  requestUrl: string | undefined,
  clientSocket: Socket,
  head: Buffer,
  runtime: ProxyRuntime,
): Promise<void> {
  const destination = parseConnectTarget(requestUrl);
  if (!destination) {
    clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  const lastError = await tryRelays(runtime, async (relay) => {
    const upstreamSocket = await connectViaSocks5(
      relay,
      destination.host,
      destination.port,
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
  });

  if (lastError) {
    clientSocket.write(
      `HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(lastError.message)}\r\n\r\n${lastError.message}`,
    );
    clientSocket.destroy();
  }
}

async function tryRelays(
  runtime: ProxyRuntime,
  action: (relay: RelayRecord) => Promise<void>,
): Promise<Error | undefined> {
  const attempted = new Set<string>();
  let lastError: Error | undefined;

  while (true) {
    const relay = runtime.pickRelay();
    if (!relay || attempted.has(relay.hostname)) {
      return lastError;
    }

    attempted.add(relay.hostname);

    try {
      await action(relay);
      return undefined;
    } catch (error) {
      runtime.markRelayUnhealthy(relay.hostname);
      lastError =
        error instanceof Error
          ? error
          : new Error("Failed to use upstream relay");
    }
  }
}

export async function connectViaSocks5(
  relay: RelayRecord,
  targetHost: string,
  targetPort: number,
): Promise<Socket> {
  const socket = await openSocket(relay.socks5Hostname, relay.socks5Port);

  try {
    await writeAndExpect(socket, Buffer.from([0x05, 0x01, 0x00]), 2);
    const request = buildSocks5ConnectRequest(targetHost, targetPort);
    const response = await writeAndExpect(socket, request, 10);

    if (response[1] !== 0x00) {
      throw new Error(
        `SOCKS5 connect failed with status ${response[1] ?? "unknown"}`,
      );
    }

    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function buildSocks5ConnectRequest(
  targetHost: string,
  targetPort: number,
): Buffer {
  const hostType = classifyHost(targetHost);
  const port = Buffer.alloc(2);
  port.writeUInt16BE(targetPort, 0);

  if (hostType === "ipv4") {
    return Buffer.from([
      0x05,
      0x01,
      0x00,
      0x01,
      ...targetHost.split(".").map((part) => Number(part)),
      ...port,
    ]);
  }

  const hostBuffer = Buffer.from(targetHost, "utf8");
  if (hostBuffer.length > 255) {
    throw new Error("Target host is too long for SOCKS5 domain encoding");
  }

  return Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuffer.length]),
    hostBuffer,
    port,
  ]);
}

function classifyHost(host: string): "ipv4" | "domain" {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) ? "ipv4" : "domain";
}

function openSocket(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host, port });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function writeAndExpect(
  socket: Socket,
  payload: Buffer,
  minimumLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= minimumLength) {
        cleanup();
        resolve(buffer);
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.write(payload);
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

function onceSocketClosed(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      socket.off("close", finish);
      socket.off("end", finish);
      resolve();
    };

    socket.once("close", finish);
    socket.once("end", finish);
  });
}
