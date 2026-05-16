import type { Socket } from "node:net";
import type { RelayRecord } from "../relay/relay-types";
import { openRelaySocket } from "./relay-socket";
import { readUntilHeaderEnd } from "./socket-utils";

const HTTP_PLAIN_RESPONSE_TIMEOUT_MS = 5_000;

export async function connectViaHttpPlain(
  relay: RelayRecord,
  targetHost: string,
  targetPort: number,
): Promise<Socket> {
  const socket = await openRelaySocket(relay);

  try {
    const connectLine =
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
      `Host: ${targetHost}:${targetPort}\r\n\r\n`;

    socket.write(connectLine);

    const responseBuffer = await readUntilHeaderEnd(
      socket,
      HTTP_PLAIN_RESPONSE_TIMEOUT_MS,
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

export function openPlainHttpProxySocket(relay: RelayRecord): Promise<Socket> {
  return openRelaySocket(relay);
}
