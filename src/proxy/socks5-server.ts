import { createServer as createTcpServer, type Socket } from "node:net";
import { createLogEvent } from "../logging/proxy-request-logger";
import { connectViaRelay } from "./connect-via-relay";
import {
  type ProxyRuntimeBase,
  type RelayRetryDeps,
  tryRelays,
} from "./relay-retry";
import { onceSocketClosed, readExact } from "./socket-utils";

export interface Socks5Server {
  listen(port: number, hostname?: string): Promise<void>;
  close(): Promise<void>;
}

export function createSocks5Server(runtime: ProxyRuntimeBase): Socks5Server {
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
  runtime: ProxyRuntimeBase,
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

  const retryDeps: RelayRetryDeps = {
    pickRelay: runtime.pickRelay,
    markRelayUnhealthy: runtime.markRelayUnhealthy,
    statsTracker: runtime.statsTracker,
  };

  const lastError = await tryRelays(retryDeps, async (relay) => {
    const upstreamSocket = await connectViaRelay(relay, targetHost, targetPort);

    runtime.requestLogger.log(
      createLogEvent("connect", targetHost, targetPort, relay),
    );

    clientSocket.write(
      Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]),
    );

    clientSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientSocket);

    await Promise.race([
      onceSocketClosed(clientSocket),
      onceSocketClosed(upstreamSocket),
    ]);
  });

  if (lastError) {
    clientSocket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
    clientSocket.destroy();
  }
}
