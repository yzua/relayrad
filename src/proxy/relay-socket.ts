import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";
import type { RelayRecord } from "../relay/relay-types";
import { prewarmRelaySocket, takePrewarmedSocket } from "./socket-prewarm";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export function openRelaySocket(relay: RelayRecord): Promise<Socket> {
  const host = relay.socks5Hostname;
  const port = relay.socks5Port;
  const timeoutMs = relay.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

  if (relay.protocol === "http") {
    return openTlsSocket(host, port, timeoutMs);
  }

  return openPlainSocket(host, port, timeoutMs);
}

function openTlsSocket(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectTls({ host, port, rejectUnauthorized: false }, () =>
      resolve(socket),
    );

    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error(`TLS connection to ${host}:${port} timed out`));
    });
  });
}

function openPlainSocket(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<Socket> {
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
    }, timeoutMs);
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
