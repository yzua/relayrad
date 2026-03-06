import { describe, expect, test } from "bun:test";
import { createRelaySelector } from "../src/relay/relay-selector";
import type { RelayRecord } from "../src/relay/relay-types";
import { makeRelayRecord } from "./test-fixtures";

const relays: RelayRecord[] = [
  makeRelayRecord(),
  makeRelayRecord({
    cityName: "Gothenburg",
    cityCode: "got",
    hostname: "se-got-wg-001",
    ipv4: "1.1.1.2",
    ipv6: "::2",
    provider: "DataPacket",
    ownership: "owned",
    socks5Hostname: "se-got-wg-001.socks5.relays.mullvad.net",
  }),
  makeRelayRecord({
    countryName: "Germany",
    countryCode: "de",
    cityName: "Berlin",
    cityCode: "ber",
    hostname: "de-ber-wg-001",
    ipv4: "1.1.1.3",
    ipv6: "::3",
    socks5Hostname: "de-ber-wg-001.socks5.relays.mullvad.net",
  }),
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
