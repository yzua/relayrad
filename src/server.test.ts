import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import { createServer } from "./server";
import type { RelayRecord } from "./relay-types";

interface RelaysResponse {
  relays: RelayRecord[];
  total: number;
}

interface RotateResponse {
  config: {
    country?: string;
  };
  preview: RelayRecord[];
}

interface RefreshResponse {
  total: number;
}

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

describe("createServer", () => {
  let refreshCalls = 0;
  const server = createServer({
    initialRelays: relays,
    refreshRelays: async () => {
      refreshCalls += 1;
      return relays;
    },
  });

  let baseUrl = "";

  beforeAll(async () => {
    await server.listen(0, "127.0.0.1");
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  test("returns relay inventory with query filters", async () => {
    const response = await fetch(`${baseUrl}/relays?country=se`);
    const payload = (await response.json()) as RelaysResponse;

    expect(response.status).toBe(200);
    expect(payload.relays).toHaveLength(1);
    expect(payload.relays[0]?.hostname).toBe("se-sto-wg-001");
  });

  test("updates the active rotation config", async () => {
    const response = await fetch(`${baseUrl}/rotate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ country: "de", sort: "hostname" }),
    });

    const payload = (await response.json()) as RotateResponse;

    expect(response.status).toBe(200);
    expect(payload.config.country).toBe("de");
    expect(payload.preview[0]?.hostname).toBe("de-ber-wg-001");
  });

  test("refreshes relay inventory through the cli adapter", async () => {
    const response = await fetch(`${baseUrl}/relays/refresh`, {
      method: "POST",
    });

    const payload = (await response.json()) as RefreshResponse;

    expect(response.status).toBe(200);
    expect(refreshCalls).toBe(1);
    expect(payload.total).toBe(2);
  });
});
