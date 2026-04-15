import type { Socket } from "node:net";
import type { RelayRecord } from "../relay/relay-types";
import { connectViaHttpProxy } from "./http-upstream";
import { connectViaSocks5 } from "./socks5";

export function connectViaRelay(
  relay: RelayRecord,
  targetHost: string,
  targetPort: number,
  sessionKey?: string,
): Promise<Socket> {
  if (relay.protocol === "http") {
    return connectViaHttpProxy(relay, targetHost, targetPort);
  }
  return connectViaSocks5(relay, targetHost, targetPort, sessionKey);
}
