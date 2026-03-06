import { connect as connectTcp, type Socket } from "node:net";
import type { RelayRecord } from "../relay/relay-types";

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
