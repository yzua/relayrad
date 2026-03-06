import type { RelayRecord } from "../src/relay/relay-types";

export function makeRelayRecord(
  overrides: Partial<RelayRecord> = {},
): RelayRecord {
  return {
    countryName: "Sweden",
    countryCode: "se",
    cityName: "Stockholm",
    cityCode: "sto",
    hostname: "se-sto-wg-001",
    ipv4: "1.1.1.1",
    ipv6: "::1",
    protocol: "WireGuard",
    provider: "M247",
    ownership: "rented",
    socks5Hostname: "se-sto-wg-001.socks5.relays.mullvad.net",
    socks5Port: 1080,
    ...overrides,
  };
}
