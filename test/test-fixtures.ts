import type { RelayRecord } from "../src/relay/relay-types";

export function makeRelayRecord(
  overrides: Partial<RelayRecord> = {},
): RelayRecord {
  return {
    source: "mullvad",
    countryName: "Sweden",
    countryCode: "usa",
    cityName: "Stockholm",
    cityCode: "sto",
    hostname: "usa-sto-wg-001",
    ipv4: "1.1.1.1",
    ipv6: "::1",
    protocol: "WireGuard",
    provider: "M247",
    ownership: "rented",
    socks5Hostname: "usa-sto-wg-001.socks5.relays.mullvad.net",
    socks5Port: 1080,
    ...overrides,
  };
}
