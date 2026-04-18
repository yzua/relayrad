import type {
  RelayOwnership,
  RelayRecord,
  RelaySelectionConfig,
  RelaySort,
} from "./relay-types";

export interface ResolvedRelaySelectionConfig
  extends Required<Omit<RelaySelectionConfig, "ownership">> {
  ownership?: RelayOwnership | undefined;
  unhealthyBackoffMs: number;
  excludeCountry: string[];
  excludeCountrySet: Set<string> | null;
  sort: RelaySort;
}

export interface NormalizedRelay extends RelayRecord {
  _countryCodeLower: string;
  _countryNameLower: string;
  _cityCodeLower: string;
  _cityNameLower: string;
  _hostnameLower: string;
  _providerLower: string;
}

const normalizeCache = new WeakMap<RelayRecord, NormalizedRelay>();

export function normalizeRelay(relay: RelayRecord): NormalizedRelay {
  const cached = normalizeCache.get(relay);
  if (cached) return cached;

  const normalized: NormalizedRelay = {
    ...relay,
    _countryCodeLower: relay.countryCode.toLowerCase(),
    _countryNameLower: relay.countryName.toLowerCase(),
    _cityCodeLower: relay.cityCode.toLowerCase(),
    _cityNameLower: relay.cityName.toLowerCase(),
    _hostnameLower: relay.hostname.toLowerCase(),
    _providerLower: relay.provider.toLowerCase(),
  };
  normalizeCache.set(relay, normalized);
  return normalized;
}

export function normalizeConfig(
  config: RelaySelectionConfig,
): ResolvedRelaySelectionConfig {
  const excludeCountry = config.excludeCountry ?? [];
  const result: ResolvedRelaySelectionConfig = {
    country: config.country?.trim().toLowerCase() ?? "",
    city: config.city?.trim().toLowerCase() ?? "",
    hostname: config.hostname?.trim().toLowerCase() ?? "",
    provider: config.provider?.trim().toLowerCase() ?? "",
    ownership: config.ownership,
    excludeCountry,
    excludeCountrySet:
      excludeCountry.length > 0 ? new Set(excludeCountry) : null,
    sort: config.sort ?? "hostname",
    unhealthyBackoffMs: config.unhealthyBackoffMs ?? 30_000,
  };
  // Make excludeCountrySet non-enumerable so JSON.stringify skips it
  Object.defineProperty(result, "excludeCountrySet", { enumerable: false });
  return result;
}

export function matches(
  relay: RelayRecord,
  config: ResolvedRelaySelectionConfig,
): boolean {
  const nr = relay as NormalizedRelay;

  if (
    config.country &&
    nr._countryCodeLower !== config.country &&
    nr._countryNameLower !== config.country
  ) {
    return false;
  }

  if (
    config.excludeCountrySet &&
    (config.excludeCountrySet.has(nr._countryCodeLower) ||
      config.excludeCountrySet.has(nr._countryNameLower))
  ) {
    return false;
  }

  if (
    config.city &&
    nr._cityCodeLower !== config.city &&
    nr._cityNameLower !== config.city
  ) {
    return false;
  }

  if (config.hostname && !nr._hostnameLower.includes(config.hostname)) {
    return false;
  }

  if (config.provider && nr._providerLower !== config.provider) {
    return false;
  }

  if (config.ownership && relay.ownership !== config.ownership) {
    return false;
  }

  return true;
}

export function sortRelays(
  relays: RelayRecord[],
  sort: ResolvedRelaySelectionConfig["sort"],
): RelayRecord[] {
  const next = [...relays];
  switch (sort) {
    case "country":
      next.sort(
        (a, b) =>
          a.countryName.localeCompare(b.countryName) ||
          a.cityName.localeCompare(b.cityName) ||
          a.hostname.localeCompare(b.hostname),
      );
      return next;
    case "city":
      next.sort(
        (a, b) =>
          a.cityName.localeCompare(b.cityName) ||
          a.hostname.localeCompare(b.hostname),
      );
      return next;
    case "random":
      return shuffleValues(next);
    case "hostname":
      next.sort((a, b) =>
        a.hostname < b.hostname ? -1 : a.hostname > b.hostname ? 1 : 0,
      );
      return next;
    default:
      return next;
  }
}

export function groupRelaysBySource(
  relays: RelayRecord[],
): Map<string, RelayRecord[]> {
  const bySource = new Map<string, RelayRecord[]>();

  for (const relay of relays) {
    let sourceRelays = bySource.get(relay.source);
    if (!sourceRelays) {
      sourceRelays = [];
      bySource.set(relay.source, sourceRelays);
    }
    sourceRelays.push(relay);
  }

  return bySource;
}

export function shuffleValues<T>(values: T[]): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = values[index] as T;
    values[index] = values[swapIndex] as T;
    values[swapIndex] = current;
  }
  return values;
}

export function isUnhealthy(
  hostname: string,
  now: number,
  unhealthyUntil: Map<string, number>,
): boolean {
  const until = unhealthyUntil.get(hostname);
  if (until === undefined) {
    return false;
  }

  if (until <= now) {
    unhealthyUntil.delete(hostname);
    return false;
  }

  return true;
}
