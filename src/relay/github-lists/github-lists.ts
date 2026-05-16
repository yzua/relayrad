import type { RelayRecord } from "../relay-types";

const GITHUB_LISTS_FETCH_TIMEOUT_MS = 30_000;

const SOCKS5_URL =
  "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt";
const SOCKS4_URL =
  "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks4.txt";
const HTTP_URL =
  "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt";

export async function loadGithubListRelays(): Promise<{
  relays: RelayRecord[];
  warnings: string[];
}> {
  const warnings: string[] = [];

  const [socks5, socks4, http] = await Promise.all([
    fetchList("socks5", SOCKS5_URL, warnings),
    fetchList("socks4", SOCKS4_URL, warnings),
    fetchList("http", HTTP_URL, warnings),
  ]);

  const relays: RelayRecord[] = [
    ...socks5.map((entry) => toRelay(entry, "socks5")),
    ...socks4.map((entry) => toRelay(entry, "socks5")),
    ...http.map((entry) => toRelay(entry, "http-plain")),
  ];

  return { relays, warnings };
}

async function fetchList(
  label: string,
  url: string,
  warnings: string[],
): Promise<Array<{ host: string; port: number }>> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(GITHUB_LISTS_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      warnings.push(
        `github-lists ${label}: HTTP ${response.status} from ${url}`,
      );
      return [];
    }

    const text = await response.text();
    const entries: Array<{ host: string; port: number }> = [];

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const colonIndex = trimmed.lastIndexOf(":");
      if (colonIndex <= 0) continue;

      const host = trimmed.slice(0, colonIndex);
      const port = Number(trimmed.slice(colonIndex + 1));

      if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
        continue;
      }

      entries.push({ host, port });
    }

    return entries;
  } catch (error) {
    warnings.push(
      `github-lists ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

let relayCounter = 0;

function toRelay(
  entry: { host: string; port: number },
  protocol: string,
): RelayRecord {
  relayCounter += 1;
  const id = String(relayCounter).padStart(6, "0");
  return {
    source: "github-lists",
    countryName: "",
    countryCode: "",
    cityName: "",
    cityCode: "",
    hostname: `ghl-${protocol}-${id}`,
    ipv4: entry.host,
    ipv6: "",
    protocol,
    provider: "github-lists",
    ownership: "rented",
    socks5Hostname: entry.host,
    socks5Port: entry.port,
    connectTimeoutMs: 10_000,
  };
}
