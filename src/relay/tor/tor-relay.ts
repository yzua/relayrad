import { connect as connectTcp } from "node:net";
import type { RelayRecord } from "../relay-types";

const TOR_DEFAULT_HOST = "127.0.0.1";
const TOR_DEFAULT_PORT = 9050;
const TOR_CHECK_TIMEOUT_MS = 2000;

export function createTorRelay(port = TOR_DEFAULT_PORT): RelayRecord {
  return {
    source: "tor",
    countryName: "Tor",
    countryCode: "tor",
    cityName: "Tor Network",
    cityCode: "tor",
    hostname: "tor-relay",
    ipv4: TOR_DEFAULT_HOST,
    ipv6: "",
    protocol: "socks5",
    provider: "tor-project",
    ownership: "owned",
    socks5Hostname: TOR_DEFAULT_HOST,
    socks5Port: port,
    socks5UniqueAuth: true,
    socks5Password: "",
  };
}

export async function checkTorAvailable(
  port = TOR_DEFAULT_PORT,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connectTcp({
      host: TOR_DEFAULT_HOST,
      port,
      timeout: TOR_CHECK_TIMEOUT_MS,
    });

    const done = (available: boolean) => {
      socket.destroy();
      resolve(available);
    };

    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}
