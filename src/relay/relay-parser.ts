import type { RelayOwnership, RelayRecord } from "./relay-types";

const countryPattern = /^(.+?) \(([a-z]{2})\)$/i;
const cityPattern = /^\s+(.+?) \(([a-z]{3})\) @ /i;
const relayPattern =
  /^\s+([a-z0-9-]+) \(([^,]+),\s*([^)]*)\) - ([^,]+), hosted by (.+) \((owned|rented)\)$/i;

export function parseRelayList(output: string): RelayRecord[] {
  const relays: RelayRecord[] = [];
  let currentCountryName: string | undefined;
  let currentCountryCode: string | undefined;
  let currentCityName: string | undefined;
  let currentCityCode: string | undefined;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim().length === 0) {
      continue;
    }

    const countryMatch = line.match(countryPattern);
    if (countryMatch) {
      currentCountryName = countryMatch[1]?.trim();
      currentCountryCode = countryMatch[2]?.trim().toLowerCase();
      currentCityName = undefined;
      currentCityCode = undefined;
      continue;
    }

    const cityMatch = line.match(cityPattern);
    if (cityMatch) {
      currentCityName = cityMatch[1]?.trim();
      currentCityCode = cityMatch[2]?.trim().toLowerCase();
      continue;
    }

    const relayMatch = line.match(relayPattern);
    if (
      !relayMatch ||
      !currentCountryName ||
      !currentCountryCode ||
      !currentCityName ||
      !currentCityCode
    ) {
      continue;
    }

    const hostname = relayMatch[1]?.trim();
    const ipv4 = relayMatch[2]?.trim();
    const ipv6 = relayMatch[3]?.trim();
    const protocol = relayMatch[4]?.trim();
    const provider = relayMatch[5]?.trim();
    const ownership = relayMatch[6]?.trim().toLowerCase() as RelayOwnership;

    if (!hostname || !ipv4 || !ipv6 || !protocol || !provider) {
      continue;
    }

    relays.push({
      source: "mullvad",
      countryName: currentCountryName,
      countryCode: currentCountryCode,
      cityName: currentCityName,
      cityCode: currentCityCode,
      hostname,
      ipv4,
      ipv6,
      protocol,
      provider,
      ownership,
      socks5Hostname: buildSocks5Hostname(hostname),
      socks5Port: 1080,
    });
  }

  return relays;
}

function buildSocks5Hostname(hostname: string): string {
  return `${hostname.replace(/-wg-/, "-wg-socks5-")}.relays.mullvad.net`;
}
