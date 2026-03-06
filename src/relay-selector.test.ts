import { describe, expect, test } from "bun:test";
import { createRelaySelector } from "./relay-selector";
import type { RelayRecord } from "./relay-types";

const relays: RelayRecord[] = [
  {
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
  },
  {
    countryName: "Sweden",
    countryCode: "se",
    cityName: "Gothenburg",
    cityCode: "got",
    hostname: "se-got-wg-001",
    ipv4: "1.1.1.2",
    ipv6: "::2",
    protocol: "WireGuard",
    provider: "DataPacket",
    ownership: "owned",
    socks5Hostname: "se-got-wg-001.socks5.relays.mullvad.net",
    socks5Port: 1080,
  },
  {
    countryName: "Germany",
    countryCode: "de",
    cityName: "Berlin",
    cityCode: "ber",
    hostname: "de-ber-wg-001",
    ipv4: "1.1.1.3",
    ipv6: "::3",
    protocol: "WireGuard",
    provider: "M247",
    ownership: "rented",
    socks5Hostname: "de-ber-wg-001.socks5.relays.mullvad.net",
    socks5Port: 1080,
  },
];

describe("createRelaySelector", () => {
  test("filters relays and sorts by hostname", () => {
    const selector = createRelaySelector(relays, {
      country: "se",
      sort: "hostname",
    });

    expect(selector.list().map((relay) => relay.hostname)).toEqual([
      "se-got-wg-001",
      "se-sto-wg-001",
    ]);
  });

  test("rotates matching relays in round-robin order", () => {
    const selector = createRelaySelector(relays, {
      country: "se",
      sort: "hostname",
    });

    expect(selector.next()?.hostname).toBe("se-got-wg-001");
    expect(selector.next()?.hostname).toBe("se-sto-wg-001");
    expect(selector.next()?.hostname).toBe("se-got-wg-001");
  });

  test("skips unhealthy relays until backoff expires", () => {
    const selector = createRelaySelector(relays, {
      country: "se",
      sort: "hostname",
      unhealthyBackoffMs: 10_000,
    });

    selector.markUnhealthy("se-got-wg-001", 1_000);

    expect(selector.next(2_000)?.hostname).toBe("se-sto-wg-001");
    expect(selector.next(12_000)?.hostname).toBe("se-got-wg-001");
  });
});
