import type { Socket } from "node:net";
import type { RelayRecord } from "../relay/relay-types";
import { openRelaySocket } from "./relay-socket";
import { readUntilHeaderEnd } from "./socket-utils";

const HTTP_PROXY_CONNECT_TIMEOUT_MS = 10_000;

export async function connectViaHttpProxy(
  relay: RelayRecord,
  targetHost: string,
  targetPort: number,
): Promise<Socket> {
  const socket = await openRelaySocket(relay);

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
  return openRelaySocket(relay);
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
  let out = requestLine;
  for (const name of Object.keys(headers)) {
    const value = headers[name];
    if (value === undefined) continue;
    if (typeof value === "string") {
      out += `\r\n${name}: ${value}`;
    } else {
      for (let j = 0; j < value.length; j++) {
        out += `\r\n${name}: ${value[j]}`;
      }
    }
  }
  return `${out}\r\n\r\n`;
}

const proxyAuthCache = new WeakMap<RelayRecord, string>();

export function buildProxyAuthHeader(relay: RelayRecord): string | undefined {
  if (!relay.socks5Username) return undefined;
  const cached = proxyAuthCache.get(relay);
  if (cached) return cached;
  const credentials = Buffer.from(
    `${relay.socks5Username}:${relay.socks5Password ?? ""}`,
  ).toString("base64");
  const header = `Proxy-Authorization: Basic ${credentials}`;
  proxyAuthCache.set(relay, header);
  return header;
}
