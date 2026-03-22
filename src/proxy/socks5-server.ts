import { createServer as createTcpServer, type Socket } from "node:net";
import type { ProxyRuntime } from "./http-proxy";
import { connectViaSocks5 } from "./socks5";

export interface Socks5Server {
  listen(port: number, hostname?: string): Promise<void>;
  close(): Promise<void>;
}

export function createSocks5Server(runtime: ProxyRuntime): Socks5Server {
  const server = createTcpServer((clientSocket) => {
    handleClient(clientSocket, runtime).catch(() => {
      clientSocket.destroy();
    });
  });

  return {
    listen(port: number, hostname = "127.0.0.1") {
      return new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, hostname, () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function handleClient(
  clientSocket: Socket,
  runtime: ProxyRuntime,
): Promise<void> {
  runtime.statsTracker.connectionStart();
  clientSocket.once("close", () => runtime.statsTracker.connectionEnd());

  const greeting = await readExact(clientSocket, 2);
  if (greeting[0] !== 0x05) {
    clientSocket.destroy();
    return;
  }

  const methodCount = greeting[1] ?? 0;
  await readExact(clientSocket, methodCount);
  clientSocket.write(Buffer.from([0x05, 0x00]));

  const header = await readExact(clientSocket, 4);
  if (header[0] !== 0x05 || header[1] !== 0x01) {
    clientSocket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
    clientSocket.destroy();
    return;
  }

  let targetHost: string;
  const atyp = header[3];

  if (atyp === 0x01) {
    const addr = await readExact(clientSocket, 4);
    targetHost = Array.from(addr).join(".");
  } else if (atyp === 0x03) {
    const lenBuf = await readExact(clientSocket, 1);
    const len = lenBuf[0] ?? 0;
    const domain = await readExact(clientSocket, len);
    targetHost = domain.toString("utf8");
  } else if (atyp === 0x04) {
    const addr = await readExact(clientSocket, 16);
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(addr.readUInt16BE(i).toString(16));
    }
    targetHost = parts.join(":");
  } else {
    clientSocket.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
    clientSocket.destroy();
    return;
  }

  const portBuf = await readExact(clientSocket, 2);
  const targetPort = portBuf.readUInt16BE(0);

  const lastError = await tryRelaysSocks5(runtime, async (relay) => {
    const upstreamSocket = await connectViaSocks5(
      relay,
      targetHost,
      targetPort,
    );

    runtime.requestLogger.log({
      timestamp: new Date().toISOString(),
      requestType: "connect",
      destinationHost: targetHost,
      destinationPort: targetPort,
      relayHostname: relay.hostname,
    });

    clientSocket.write(
      Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]),
    );

    clientSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientSocket);

    await new Promise<void>((resolve) => {
      const done = () => {
        clientSocket.off("close", done);
        clientSocket.off("end", done);
        upstreamSocket.off("close", done);
        upstreamSocket.off("end", done);
        resolve();
      };
      clientSocket.once("close", done);
      clientSocket.once("end", done);
      upstreamSocket.once("close", done);
      upstreamSocket.once("end", done);
    });
  });

  if (lastError) {
    clientSocket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
    clientSocket.destroy();
  }
}

async function tryRelaysSocks5(
  runtime: ProxyRuntime,
  action: (relay: import("../relay/relay-types").RelayRecord) => Promise<void>,
): Promise<Error | undefined> {
  const attempted = new Set<string>();
  let lastError: Error | undefined;

  while (true) {
    const relay = runtime.pickRelay();
    if (!relay || attempted.has(relay.hostname)) {
      if (lastError) {
        runtime.statsTracker.recordRequestFailed();
      }
      return lastError;
    }

    attempted.add(relay.hostname);

    try {
      await action(relay);
      runtime.statsTracker.recordRequest(relay.hostname);
      return undefined;
    } catch (error) {
      runtime.markRelayUnhealthy(relay.hostname);
      runtime.statsTracker.recordRelayFailure(relay.hostname);
      lastError =
        error instanceof Error
          ? error
          : new Error("Failed to use upstream relay");
    }
  }
}

function readExact(socket: Socket, count: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      received += chunk.length;
      if (received >= count) {
        cleanup();
        resolve(Buffer.concat(chunks, received));
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("Socket closed before data received"));
    };

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}
