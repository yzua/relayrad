import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import { createNoopProxyRequestLogger } from "../src/logging/proxy-request-logger";
import type { RelayRecord } from "../src/relay/relay-types";
import { createServer } from "../src/server/server";
import { makeRelayRecord } from "./test-fixtures";

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
  makeRelayRecord(),
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

describe("createServer", () => {
  let refreshCalls = 0;
  const server = createServer({
    initialRelays: relays,
    refreshRelays: async () => {
      refreshCalls += 1;
      return relays;
    },
    requestLogger: createNoopProxyRequestLogger(),
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
    const response = await fetch(`${baseUrl}/relays?country=usa`);
    const payload = (await response.json()) as RelaysResponse;

    expect(response.status).toBe(200);
    expect(payload.relays).toHaveLength(1);
    expect(payload.relays[0]?.hostname).toBe("usa-sto-wg-001");
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

  test("returns 400 for invalid JSON in /rotate body", async () => {
    const response = await fetch(`${baseUrl}/rotate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });

    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Request body must be valid JSON");
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
