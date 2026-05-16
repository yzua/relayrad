import { createHash } from "node:crypto";
import type { Socket } from "node:net";
import type { RelayRecord } from "../relay/relay-types";
import { openRelaySocket } from "./relay-socket";

const SOCKS5_CONNECT_TIMEOUT_MS = 30_000;

export async function connectViaSocks5(
  relay: RelayRecord,
  targetHost: string,
  targetPort: number,
  uniqueAuthKey?: string,
): Promise<Socket> {
  const socket = await openRelaySocket(relay);

  try {
    const auth = resolveSocks5Auth(relay, uniqueAuthKey);
    const hasAuth = auth !== undefined;

    const handshakeTimeout =
      relay.connectTimeoutMs ?? SOCKS5_CONNECT_TIMEOUT_MS;
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

    // When all frames are sent in one write, some SOCKS5 servers (notably Tor)
    // skip the method selection response and reply with auth + connect only
    // (12 bytes).  Others send method + auth + connect (14 bytes).  Request
    // the lower bound and parse based on the first byte.
    const response = await writeAndExpect(
      socket,
      Buffer.concat(parts),
      12,
      handshakeTimeout,
    );

    // Parse the combined response — layout depends on whether the server
    // included the method selection reply.
    let offset = 0;

    if (hasAuth) {
      if (response[0] === 0x05) {
        // Full response: method(05 02) + auth(01 00) + connect(10)
        const methodStatus = response[1] ?? 0xff;
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
      } else if (response[0] === 0x01) {
        // Tor pipelined: auth(01 00) + connect(10) — method reply omitted
        const authStatus = response[1] ?? 0x01;
        if (authStatus !== 0x00) {
          throw new Error("SOCKS5 username/password authentication rejected");
        }
        offset = 2;
      } else {
        throw new Error(
          `Unexpected SOCKS5 response byte: 0x${response[0]?.toString(16).padStart(2, "0")}`,
        );
      }
    } else {
      const methodStatus = response[1] ?? 0xff;
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
