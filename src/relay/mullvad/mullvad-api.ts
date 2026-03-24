import type { RelayRecord } from "../relay-types";

const MULLVAD_API_URL = "https://api.mullvad.net/www/relays/all/";
const MULLVAD_FETCH_TIMEOUT_MS = 15_000;

interface MullvadApiRelay {
  hostname: string;
  country_code: string;
  country_name: string;
  city_code: string;
  city_name: string;
  active: boolean;
  owned: boolean;
  provider: string;
  ipv4_addr_in: string;
  ipv6_addr_in: string;
  type: string;
  socks_name: string;
  socks_port: number;
}

export async function loadRelaysFromMullvadApi(): Promise<RelayRecord[]> {
  let response: Response;
  try {
    response = await fetch(MULLVAD_API_URL, {
      signal: AbortSignal.timeout(MULLVAD_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Mullvad API request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Mullvad API returned ${response.status}: ${response.statusText}`,
    );
  }

  let relays: MullvadApiRelay[];
  try {
    relays = (await response.json()) as MullvadApiRelay[];
  } catch {
    throw new Error("Mullvad API returned invalid JSON");
  }

  if (!Array.isArray(relays) || relays.length === 0) {
    throw new Error("Mullvad API returned empty or malformed relay list");
  }

  const parsed = relays
    .filter((relay) => relay.active)
    .map(
      (relay): RelayRecord => ({
        source: "mullvad",
        countryName: relay.country_name,
        countryCode: relay.country_code.toLowerCase(),
        cityName: relay.city_name,
        cityCode: relay.city_code.toLowerCase(),
        hostname: relay.hostname,
        ipv4: relay.ipv4_addr_in,
        ipv6: relay.ipv6_addr_in,
        protocol: "socks5",
        provider: relay.provider,
        ownership: relay.owned ? "owned" : "rented",
        socks5Hostname: relay.socks_name,
        socks5Port: relay.socks_port,
      }),
    );

  if (parsed.length === 0) {
    throw new Error("Mullvad API: no active relays found");
  }

  return parsed;
}
