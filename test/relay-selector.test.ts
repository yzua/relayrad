import { describe, expect, test } from "bun:test";
import { createRelaySelector } from "../src/relay/relay-selector";
import type { RelayRecord } from "../src/relay/relay-types";
import { makeRelayRecord } from "./test-fixtures";

const relays: RelayRecord[] = [
  makeRelayRecord(),
  makeRelayRecord({
    cityName: "Gothenburg",
    cityCode: "got",
    hostname: "usa-got-wg-001",
    ipv4: "1.1.1.2",
    ipv6: "::2",
    provider: "DataPacket",
    ownership: "owned",
    socks5Hostname: "usa-got-wg-001.socks5.relays.mullvad.net",
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
      country: "usa",
      sort: "hostname",
    });

    expect(selector.list().map((relay) => relay.hostname)).toEqual([
      "usa-got-wg-001",
      "usa-sto-wg-001",
    ]);
  });

  test("rotates matching relays in round-robin order", () => {
    const selector = createRelaySelector(relays, {
      country: "usa",
      sort: "hostname",
    });

    expect(selector.next()?.hostname).toBe("usa-got-wg-001");
    expect(selector.next()?.hostname).toBe("usa-sto-wg-001");
    expect(selector.next()?.hostname).toBe("usa-got-wg-001");
  });

  test("skips unhealthy relays until backoff expires", () => {
    const selector = createRelaySelector(relays, {
      country: "usa",
      sort: "hostname",
      unhealthyBackoffMs: 10_000,
    });

    selector.markUnhealthy("usa-got-wg-001", 1_000);

    expect(selector.next(2_000)?.hostname).toBe("usa-sto-wg-001");
    expect(selector.next(12_000)?.hostname).toBe("usa-got-wg-001");
  });
});
