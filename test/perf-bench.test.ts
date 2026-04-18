import { describe, test } from "bun:test";
import { createLogEvent } from "../src/logging/proxy-request-logger";
import { formatHttpHeaders } from "../src/proxy/http-upstream";
import { createRelaySelector } from "../src/relay/relay-selector";
import type { RelayRecord } from "../src/relay/relay-types";
import { checkProxyAuthRaw } from "../src/server/proxy-auth";
import { createStickySessionManager } from "../src/server/sticky-session-manager";
import { createStatsTracker } from "../src/stats";

// Helpers to generate relay data at realistic scale
function makeRelay(
  i: number,
  source: "mullvad" | "tor" | "nordvpn",
): RelayRecord {
  return {
    hostname: `${source}-${i}`,
    countryCode: "se",
    countryName: "Sweden",
    cityName: "Stockholm",
    cityCode: "sto",
    ipv4: `1.2.3.${i % 256}`,
    ipv6: `::${i}`,
    socks5Hostname: `${source}-${i}.example.net`,
    socks5Port: 1080,
    socks5Username: source === "nordvpn" ? "user" : undefined,
    socks5Password: source === "nordvpn" ? "pass" : undefined,
    provider: "provider",
    ownership: "owned",
    source,
    protocol: source === "nordvpn" ? "http" : "socks5",
    socks5UniqueAuth: false,
  };
}

function makeRelaySet(
  mullvadCount: number,
  torCount: number,
  nordvpnCount: number,
): RelayRecord[] {
  const relays: RelayRecord[] = [];
  for (let i = 0; i < mullvadCount; i++) relays.push(makeRelay(i, "mullvad"));
  for (let i = 0; i < torCount; i++) relays.push(makeRelay(i, "tor"));
  for (let i = 0; i < nordvpnCount; i++) relays.push(makeRelay(i, "nordvpn"));
  return relays;
}

// ~580 mullvad + 1 tor + ~9000 nordvpn ≈ 9581 relays (realistic scale)
const REALISTIC_RELAYS = makeRelaySet(580, 1, 9000);

describe("Performance benchmarks", () => {
  test("relay-selector: next() throughput — round-robin, 580 Mullvad relays", () => {
    const selector = createRelaySelector(
      REALISTIC_RELAYS.filter((r) => r.source === "mullvad"),
      { sort: "hostname" },
    );

    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      selector.next();
    }
    const elapsed = performance.now() - start;
    const perOp = elapsed / iterations;
    console.log(
      `[bench] relay next() round-robin 580 relays: ${perOp.toFixed(3)} µs/op (${iterations} ops in ${elapsed.toFixed(1)} ms)`,
    );
  });

  test("relay-selector: next() throughput — random, multi-source, 9581 relays", () => {
    const selector = createRelaySelector(REALISTIC_RELAYS, { sort: "random" });

    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      selector.next();
    }
    const elapsed = performance.now() - start;
    const perOp = elapsed / iterations;
    console.log(
      `[bench] relay next() random 9581 relays: ${perOp.toFixed(3)} µs/op (${iterations} ops in ${elapsed.toFixed(1)} ms)`,
    );
  });

  test("relay-selector: list() throughput — round-robin, 9581 relays", () => {
    const selector = createRelaySelector(REALISTIC_RELAYS, {
      sort: "hostname",
    });

    const iterations = 1_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      selector.list();
    }
    const elapsed = performance.now() - start;
    const perOp = elapsed / iterations;
    console.log(
      `[bench] relay list() 9581 relays: ${perOp.toFixed(3)} µs/op (${iterations} ops in ${elapsed.toFixed(1)} ms)`,
    );
  });

  test("relay-selector: update() with 9581 relays — full reinit", () => {
    const selector = createRelaySelector(REALISTIC_RELAYS, {
      sort: "hostname",
    });

    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      selector.update(REALISTIC_RELAYS);
    }
    const elapsed = performance.now() - start;
    const perOp = elapsed / iterations;
    console.log(
      `[bench] relay update() 9581 relays: ${perOp.toFixed(3)} µs/op (${iterations} ops in ${elapsed.toFixed(1)} ms)`,
    );
  });

  test("relay-selector: normalizeRelay — 9581 relays", () => {
    const start = performance.now();
    for (let round = 0; round < 100; round++) {
      const selector = createRelaySelector(REALISTIC_RELAYS, {
        sort: "hostname",
      });
      selector.list();
    }
    const elapsed = performance.now() - start;
    console.log(
      `[bench] createRelaySelector+list 9581 relays x100: ${elapsed.toFixed(1)} ms (${(elapsed / 100).toFixed(2)} ms/op)`,
    );
  });

  test("sticky-session-manager: get+set at scale", () => {
    const mgr = createStickySessionManager(300_000);
    const relayMap = new Map(
      REALISTIC_RELAYS.slice(0, 100).map((r) => [r.hostname, r]),
    );
    const sessions = Array.from({ length: 1000 }, (_, i) => `session-${i}`);

    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      mgr.set(sessions[i % sessions.length]!, relayMap.keys().next().value!);
      mgr.get(sessions[i % sessions.length]!, relayMap);
    }
    const elapsed = performance.now() - start;
    const perOp = elapsed / iterations;
    console.log(
      `[bench] sticky-session get+set: ${perOp.toFixed(3)} µs/op (${iterations} ops in ${elapsed.toFixed(1)} ms)`,
    );
  });

  test("stats-tracker: recordRequest throughput", () => {
    const tracker = createStatsTracker();
    const hostnames = REALISTIC_RELAYS.slice(0, 100).map((r) => r.hostname);

    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      tracker.recordRequest(hostnames[i % hostnames.length]!);
    }
    const elapsed = performance.now() - start;
    const perOp = elapsed / iterations;
    console.log(
      `[bench] stats recordRequest: ${perOp.toFixed(3)} µs/op (${iterations} ops in ${elapsed.toFixed(1)} ms)`,
    );
  });

  test("proxy-request-logger: createLogEvent throughput", () => {
    const relay = REALISTIC_RELAYS[0]!;
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      createLogEvent("http", "example.com", 443, relay);
    }
    const elapsed = performance.now() - start;
    const perOp = elapsed / iterations;
    console.log(
      `[bench] createLogEvent: ${perOp.toFixed(3)} µs/op (${iterations} ops in ${elapsed.toFixed(1)} ms)`,
    );
  });

  test("relay-selector: markUnhealthy + next with backoff", () => {
    const selector = createRelaySelector(REALISTIC_RELAYS, {
      sort: "random",
    });
    const unhealthyHostnames = REALISTIC_RELAYS.slice(0, 100).map(
      (r) => r.hostname,
    );

    const iterations = 1_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      selector.markUnhealthy(
        unhealthyHostnames[i % unhealthyHostnames.length]!,
      );
      selector.next();
    }
    const elapsed = performance.now() - start;
    const perOp = elapsed / iterations;
    console.log(
      `[bench] markUnhealthy+next random 9581 relays: ${perOp.toFixed(3)} µs/op (${iterations} ops in ${elapsed.toFixed(1)} ms)`,
    );
  });

  test("relay-selector: matches() — filtering 9581 relays by country", () => {
    // Measure by creating a new selector each time (forces re-filter)
    const iterations = 1_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const selector = createRelaySelector(REALISTIC_RELAYS, {
        country: "se",
        sort: "hostname",
      });
      selector.list();
    }
    const elapsed = performance.now() - start;
    const perOp = elapsed / iterations;
    console.log(
      `[bench] create+filter+list 9581 relays by country: ${perOp.toFixed(3)} µs/op (${iterations} ops in ${elapsed.toFixed(1)} ms)`,
    );
  });

  // --- Targeted benchmarks for optimization targets ---

  const TYPICAL_HEADERS: Record<string, string | string[] | undefined> = {
    host: "example.com",
    "user-agent": "Mozilla/5.0 relayrad/1.0",
    accept: "text/html,application/xhtml+xml",
    "accept-language": "en-US,en;q=0.9",
    "accept-encoding": "gzip, deflate, br",
    connection: "close",
    cookie: "session=abc123def456",
    "cache-control": "no-cache",
    referer: "https://example.com/page",
    "x-forwarded-for": "10.0.0.1",
    "x-request-id": "req-12345",
    authorization: "Bearer tokenvalue",
    "content-type": "application/json",
    dnt: "1",
    "sec-fetch-mode": "navigate",
  };

  test("formatHttpHeaders: realistic 14-header request", () => {
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      formatHttpHeaders("GET /path HTTP/1.1", TYPICAL_HEADERS);
    }
    const elapsed = performance.now() - start;
    const perOp = elapsed / iterations;
    console.log(
      `[bench] formatHttpHeaders 14 headers: ${perOp.toFixed(3)} µs/op (${iterations} ops in ${elapsed.toFixed(1)} ms)`,
    );
  });

  const AUTH_CREDENTIALS = { username: "proxyuser", password: "secretpass123" };
  const VALID_AUTH_HEADER = `Basic ${Buffer.from("proxyuser:secretpass123").toString("base64")}`;

  test("checkProxyAuthRaw: valid auth header", () => {
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      checkProxyAuthRaw(VALID_AUTH_HEADER, AUTH_CREDENTIALS);
    }
    const elapsed = performance.now() - start;
    const perOp = elapsed / iterations;
    console.log(
      `[bench] checkProxyAuthRaw valid: ${perOp.toFixed(3)} µs/op (${iterations} ops in ${elapsed.toFixed(1)} ms)`,
    );
  });

  test("checkProxyAuthRaw: missing header (fast reject)", () => {
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      checkProxyAuthRaw(undefined, AUTH_CREDENTIALS);
    }
    const elapsed = performance.now() - start;
    const perOp = elapsed / iterations;
    console.log(
      `[bench] checkProxyAuthRaw missing: ${perOp.toFixed(3)} µs/op (${iterations} ops in ${elapsed.toFixed(1)} ms)`,
    );
  });

  test("checkProxyAuthRaw: wrong credentials", () => {
    const wrongHeader = `Basic ${Buffer.from("wrong:creds").toString("base64")}`;
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      checkProxyAuthRaw(wrongHeader, AUTH_CREDENTIALS);
    }
    const elapsed = performance.now() - start;
    const perOp = elapsed / iterations;
    console.log(
      `[bench] checkProxyAuthRaw wrong: ${perOp.toFixed(3)} µs/op (${iterations} ops in ${elapsed.toFixed(1)} ms)`,
    );
  });
});
