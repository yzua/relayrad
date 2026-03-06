import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { RelayRecord } from "../relay/relay-types";
import { connectViaSocks5 } from "./socks5";

export interface ProxyRuntime {
  pickRelay: () => RelayRecord | undefined;
  markRelayUnhealthy: (hostname: string) => void;
}

export { connectViaSocks5 };

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
    const chunks: Buffer[] = [];
    let totalLength = 0;
    let trailingBytes = Buffer.alloc(0);
    const headerEndMarker = Buffer.from("\r\n\r\n");

    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      totalLength += chunk.length;

      const window =
        trailingBytes.length > 0
          ? Buffer.concat([trailingBytes, chunk])
          : chunk;

      if (window.includes(headerEndMarker)) {
        cleanup();
        socket.pause();
        resolve(Buffer.concat(chunks, totalLength));
        return;
      }

      trailingBytes =
        window.length > 3
          ? Buffer.from(window.subarray(window.length - 3))
          : Buffer.from(window);
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
