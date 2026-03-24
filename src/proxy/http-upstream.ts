import type { Socket } from "node:net";
import { connect as connectTls } from "node:tls";
import type { RelayRecord } from "../relay/relay-types";
import { readUntilHeaderEnd } from "./socket-utils";

const HTTP_PROXY_CONNECT_TIMEOUT_MS = 10_000;

export async function connectViaHttpProxy(
  relay: RelayRecord,
  targetHost: string,
  targetPort: number,
): Promise<Socket> {
  const socket = await openTlsSocket(relay.socks5Hostname, relay.socks5Port);

  try {
    const connectLine =
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
      `Host: ${targetHost}:${targetPort}\r\n`;

    const authHeader = buildProxyAuthHeader(relay);
    const request = authHeader
      ? `${connectLine}${authHeader}\r\n`
      : connectLine;

    socket.write(`${request}\r\n`);

    const responseBuffer = await readUntilHeaderEnd(
      socket,
      HTTP_PROXY_CONNECT_TIMEOUT_MS,
    );
    const headerText = responseBuffer.toString("utf8");
    const statusLine = headerText.split("\r\n")[0];
    const statusMatch = statusLine?.match(/HTTP\/\d+\.\d+\s+(\d{3})/);

    if (!statusMatch || statusMatch[1] !== "200") {
      throw new Error(
        `HTTP proxy CONNECT failed: ${statusLine ?? "no response"}`,
      );
    }

    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

export async function openHttpProxySocket(relay: RelayRecord): Promise<Socket> {
  return openTlsSocket(relay.socks5Hostname, relay.socks5Port);
}

export function buildHttpProxyRequest(
  method: string,
  targetUrl: URL,
  headers: Record<string, string | string[] | undefined>,
): string {
  const requestLine = `${method} ${targetUrl.pathname}${targetUrl.search || ""} HTTP/1.1`;
  return formatHttpHeaders(requestLine, headers);
}

export function formatHttpHeaders(
  requestLine: string,
  headers: Record<string, string | string[] | undefined>,
): string {
  const lines = [requestLine];

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`${name}: ${item}`);
    } else {
      lines.push(`${name}: ${value}`);
    }
  }

  lines.push("", "");
  return lines.join("\r\n");
}

export function buildProxyAuthHeader(relay: RelayRecord): string | undefined {
  if (!relay.socks5Username) return undefined;
  const credentials = Buffer.from(
    `${relay.socks5Username}:${relay.socks5Password ?? ""}`,
  ).toString("base64");
  return `Proxy-Authorization: Basic ${credentials}`;
}

function openTlsSocket(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectTls({ host, port, rejectUnauthorized: false }, () => {
      resolve(socket);
    });

    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });

    socket.setTimeout(HTTP_PROXY_CONNECT_TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error(`TLS connection to ${host}:${port} timed out`));
    });
  });
}
