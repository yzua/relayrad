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

const mixedSourceRelays: RelayRecord[] = [
  makeRelayRecord({ hostname: "mullvad-a", source: "mullvad" }),
  makeRelayRecord({ hostname: "mullvad-b", source: "mullvad" }),
  makeRelayRecord({ hostname: "mullvad-c", source: "mullvad" }),
  makeRelayRecord({
    hostname: "tor-relay",
    source: "tor",
    countryName: "Tor",
    countryCode: "tor",
    cityName: "Tor Network",
    cityCode: "tor",
    provider: "tor-project",
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

  test("uses random cycle selection without duplicates in a cycle", () => {
    const selector = createRelaySelector(relays, {
      country: "usa",
      sort: "random",
    });

    const originalRandom = Math.random;
    Math.random = () => 0.99;

    try {
      const first = selector.next()?.hostname;
      const second = selector.next()?.hostname;
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(first).not.toBe(second);
    } finally {
      Math.random = originalRandom;
    }
  });

  test("balances random selection across sources before reusing same source", () => {
    const selector = createRelaySelector(mixedSourceRelays, {
      sort: "random",
    });

    const originalRandom = Math.random;
    Math.random = () => 0.99;

    try {
      const first = selector.next();
      const second = selector.next();

      expect(first?.source).toBeDefined();
      expect(second?.source).toBeDefined();
      expect(first?.source).not.toBe(second?.source);
    } finally {
      Math.random = originalRandom;
    }
  });

  test("keeps selecting tor regularly in mixed-source random mode", () => {
    const selector = createRelaySelector(mixedSourceRelays, {
      sort: "random",
    });

    const originalRandom = Math.random;
    Math.random = () => 0.99;

    try {
      const pickedSources: string[] = [];

      for (let index = 0; index < 10; index += 1) {
        const relay = selector.next();
        expect(relay).toBeDefined();
        if (relay) {
          pickedSources.push(relay.source);
        }
      }

      expect(new Set(pickedSources)).toEqual(new Set(["mullvad", "tor"]));
      expect(pickedSources.filter((source) => source === "tor")).toHaveLength(
        5,
      );
      expect(
        pickedSources.filter((source) => source === "mullvad"),
      ).toHaveLength(5);

      for (let index = 1; index < pickedSources.length; index += 1) {
        expect(pickedSources[index]).not.toBe(pickedSources[index - 1]);
      }
    } finally {
      Math.random = originalRandom;
    }
  });

  test("continues rotating inside the mullvad source while balancing sources", () => {
    const selector = createRelaySelector(mixedSourceRelays, {
      sort: "random",
    });

    const originalRandom = Math.random;
    Math.random = () => 0.99;

    try {
      const seenMullvad = new Set<string>();
      for (let index = 0; index < 8; index += 1) {
        const relay = selector.next();
        expect(relay).toBeDefined();
        if (relay?.source === "mullvad") {
          seenMullvad.add(relay.hostname);
        }
      }

      expect(seenMullvad.size).toBe(3);
    } finally {
      Math.random = originalRandom;
    }
  });
});
