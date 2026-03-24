import type { RelayRecord } from "../relay-types";

const NORDVPN_API_URL = "https://api.nordvpn.com/v1/servers?limit=10000";
const NORDVPN_HTTP_PROXY_PORT = 89;
const NORDVPN_FETCH_TIMEOUT_MS = 15_000;

interface NordVpnServer {
  hostname: string;
  station: string;
  name: string;
  status: string;
  load: number;
  locations: Array<{
    country: {
      name: string;
      code: string;
      city: {
        name: string;
        dns_name: string;
      };
    };
  }>;
}

export async function loadNordvpnRelays(
  env: Record<string, string | undefined>,
): Promise<{ relays: RelayRecord[]; warnings: string[] }> {
  const warnings: string[] = [];
  const username = env["NORDVPN_USERNAME"]?.trim();
  const password = env["NORDVPN_PASSWORD"]?.trim();

  if (!username || !password) {
    warnings.push(
      "NordVPN credentials not set — connections will fail. " +
        "Set NORDVPN_USERNAME and NORDVPN_PASSWORD env vars. " +
        "Get credentials at: https://my.nordaccount.com/dashboard/nordvpn/manual-configuration/service-credentials/",
    );
  }

  const apiUrl = env["NORDVPN_API_URL"]?.trim() || NORDVPN_API_URL;

  let servers: NordVpnServer[];
  try {
    const response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(NORDVPN_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`${response.status}: ${response.statusText}`);
    }

    servers = (await response.json()) as NordVpnServer[];
  } catch (error) {
    throw new Error(
      `NordVPN API failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(servers) || servers.length === 0) {
    throw new Error("NordVPN API returned empty or malformed server list");
  }

  const relays = parseNordvpnServers(servers, username, password);
  if (relays.length === 0) {
    throw new Error("NordVPN API: no online servers found");
  }

  return { relays, warnings };
}

function parseNordvpnServers(
  servers: NordVpnServer[],
  socks5Username: string | undefined,
  socks5Password: string | undefined,
): RelayRecord[] {
  const relays: RelayRecord[] = [];

  for (const server of servers) {
    if (server.status !== "online") continue;

    const location = server.locations?.[0];
    if (!location) continue;

    const { country } = location;

    relays.push({
      source: "nordvpn",
      countryName: country.name,
      countryCode: country.code.toLowerCase(),
      cityName: country.city.name,
      cityCode: country.city.dns_name,
      hostname: server.hostname,
      ipv4: server.station,
      ipv6: "",
      protocol: "http",
      provider: "nordvpn",
      ownership: "rented",
      socks5Hostname: buildHttpProxyHostname(server.hostname),
      socks5Port: NORDVPN_HTTP_PROXY_PORT,
      socks5Username: socks5Username || undefined,
      socks5Password: socks5Password || undefined,
    });
  }

  return relays;
}

function buildHttpProxyHostname(hostname: string): string {
  return hostname.replace(/\.nordvpn\.com$/, ".proxy.nordvpn.com");
}
