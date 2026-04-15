import { createHash } from "node:crypto";
import { connect as connectTcp, type Socket } from "node:net";
import type { RelayRecord } from "../relay/relay-types";
import { prewarmRelaySocket, takePrewarmedSocket } from "./socket-prewarm";

const SOCKS5_CONNECT_TIMEOUT_MS = 30_000;
const TCP_CONNECT_TIMEOUT_MS = 10_000;

export async function connectViaSocks5(
  relay: RelayRecord,
  targetHost: string,
  targetPort: number,
  uniqueAuthKey?: string,
): Promise<Socket> {
  const socket = await openSocket(relay.socks5Hostname, relay.socks5Port);

  try {
    const auth = resolveSocks5Auth(relay, uniqueAuthKey);
    const hasAuth = auth !== undefined;

    // Build all SOCKS5 handshake payloads upfront.
    // Sending method + auth + connect in one TCP write collapses 3 round
    // trips (method, auth, connect) into a single round trip.
    const parts: Buffer[] = [
      hasAuth
        ? Buffer.from([0x05, 0x01, 0x02])
        : Buffer.from([0x05, 0x01, 0x00]),
    ];

    if (hasAuth && auth) {
      parts.push(buildSocks5AuthPayload(auth.username, auth.password));
    }

    parts.push(buildSocks5ConnectRequest(targetHost, targetPort));

    // With auth: method(2) + auth(2) + connect(10) = 14 bytes
    // Without:   method(2) + connect(10) = 12 bytes
    const response = await writeAndExpect(
      socket,
      Buffer.concat(parts),
      hasAuth ? 14 : 12,
      SOCKS5_CONNECT_TIMEOUT_MS,
    );

    // Parse the combined response
    let offset = 0;
    const methodStatus = response[1] ?? 0xff;

    if (hasAuth) {
      if (methodStatus !== 0x02) {
        throw new Error(
          `SOCKS5 auth negotiation failed with method ${methodStatus}`,
        );
      }
      const authStatus = response[3] ?? 0x01;
      if (authStatus !== 0x00) {
        throw new Error("SOCKS5 username/password authentication rejected");
      }
      offset = 4;
    } else {
      if (methodStatus !== 0x00) {
        throw new Error(
          `SOCKS5 auth negotiation failed with method ${methodStatus}`,
        );
      }
      offset = 2;
    }

    const connectStatus = response[offset + 1] ?? 0xff;
    if (connectStatus !== 0x00) {
      throw new Error(`SOCKS5 connect failed with status ${connectStatus}`);
    }

    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function resolveSocks5Auth(
  relay: RelayRecord,
  uniqueAuthKey?: string,
): { username: string; password: string } | undefined {
  if (relay.socks5UniqueAuth) {
    const usernameSuffix = uniqueAuthKey
      ? hashUniqueAuthKey(uniqueAuthKey)
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    return {
      username: `${relay.hostname}-${usernameSuffix}`,
      password: relay.socks5Password ?? "",
    };
  }

  if (relay.socks5Username === undefined) {
    return undefined;
  }

  return {
    username: relay.socks5Username,
    password: relay.socks5Password ?? "",
  };
}

function hashUniqueAuthKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function buildSocks5AuthPayload(username: string, password: string): Buffer {
  const userBuf = Buffer.from(username, "utf8");
  const passBuf = Buffer.from(password, "utf8");

  if (userBuf.length > 255 || passBuf.length > 255) {
    throw new Error("SOCKS5 auth credentials too long (max 255 bytes each)");
  }

  return Buffer.concat([
    Buffer.from([0x01, userBuf.length]),
    userBuf,
    Buffer.from([passBuf.length]),
    passBuf,
  ]);
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
  const prewarmed = takePrewarmedSocket(host, port);
  if (prewarmed) {
    prewarmRelaySocket(host, port);
    return Promise.resolve(prewarmed);
  }

  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TCP connect to ${host}:${port} timed out`));
    }, TCP_CONNECT_TIMEOUT_MS);
    timer.unref?.();

    socket.once("connect", () => {
      clearTimeout(timer);
      prewarmRelaySocket(host, port);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function writeAndExpect(
  socket: Socket,
  payload: Buffer,
  minimumLength: number,
  timeoutMs?: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      totalLength += chunk.length;
      if (totalLength >= minimumLength) {
        cleanup();
        resolve(Buffer.concat(chunks, totalLength));
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onEnd = () => {
      cleanup();
      reject(new Error("SOCKS5 connection closed during handshake"));
    };

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("end", onEnd);
    socket.write(payload);

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`SOCKS5 handshake timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
    }
  });
}
