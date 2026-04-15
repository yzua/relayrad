import type {
  RelayOwnership,
  RelayRecord,
  RelaySelectionConfig,
  RelaySort,
} from "./relay-types";

export interface RelaySelector {
  list(now?: number): RelayRecord[];
  next(now?: number): RelayRecord | undefined;
  markUnhealthy(hostname: string, now?: number): void;
  update(relays: RelayRecord[], config?: RelaySelectionConfig): void;
  getConfig(): ResolvedRelaySelectionConfig;
}

export interface ResolvedRelaySelectionConfig
  extends Required<Omit<RelaySelectionConfig, "ownership">> {
  ownership?: RelayOwnership | undefined;
  unhealthyBackoffMs: number;
  excludeCountry: string[];
  excludeCountrySet: Set<string> | null;
  sort: RelaySort;
}

interface NormalizedRelay extends RelayRecord {
  _countryCodeLower: string;
  _countryNameLower: string;
  _cityCodeLower: string;
  _cityNameLower: string;
  _hostnameLower: string;
  _providerLower: string;
}

function normalizeRelay(relay: RelayRecord): NormalizedRelay {
  return {
    ...relay,
    _countryCodeLower: relay.countryCode.toLowerCase(),
    _countryNameLower: relay.countryName.toLowerCase(),
    _cityCodeLower: relay.cityCode.toLowerCase(),
    _cityNameLower: relay.cityName.toLowerCase(),
    _hostnameLower: relay.hostname.toLowerCase(),
    _providerLower: relay.provider.toLowerCase(),
  };
}

export function createRelaySelector(
  initialRelays: RelayRecord[],
  initialConfig: RelaySelectionConfig = {},
): RelaySelector {
  let relays = initialRelays.map(normalizeRelay);
  let config = normalizeConfig(initialConfig);
  let cursor = 0;
  let randomSourceOrder: string[] = [];
  let randomSourceCursor = 0;
  let randomSourceRelayCycles = new Map<string, RelayRecord[]>();
  let randomSourceRelayCursors = new Map<string, number>();
  const unhealthyUntil = new Map<string, number>();

  // Generation counter — bumped on update()/markUnhealthy(). Replaces the
  // previous O(n) hostname-join key for detecting stale random-cycle state.
  // randomGeneration tracks which generation the random cycles were built for.
  let generation = 0;
  let randomGeneration = -1;

  // Structural caches — invalidated only on update() since relay membership doesn't
  // change when a relay is marked unhealthy.
  let matchedCache: RelayRecord[] | null = null;
  let sortedCache: RelayRecord[] | null = null;
  let groupedBySourceCache: Map<string, RelayRecord[]> | null = null;

  function invalidateStructuralCache(): void {
    matchedCache = null;
    sortedCache = null;
    groupedBySourceCache = null;
  }

  function getMatched(): RelayRecord[] {
    if (matchedCache) return matchedCache;
    matchedCache = relays.filter((relay) => matches(relay, config));
    return matchedCache;
  }

  function getSorted(): RelayRecord[] {
    if (sortedCache) return sortedCache;
    sortedCache = sortRelays(getMatched(), config.sort);
    return sortedCache;
  }

  function getGroupedBySource(): Map<string, RelayRecord[]> {
    if (groupedBySourceCache) return groupedBySourceCache;
    groupedBySourceCache = groupRelaysBySource(getMatched());
    return groupedBySourceCache;
  }

  // Build initial cache
  invalidateStructuralCache();

  const list = (now = Date.now()): RelayRecord[] => {
    if (config.sort === "random") {
      const healthy = healthyFromMatched(now);
      return shuffleValues(healthy);
    }
    if (unhealthyUntil.size === 0) return [...getSorted()];
    return getSorted().filter(
      (r) => !isUnhealthy(r.hostname, now, unhealthyUntil),
    );
  };

  return {
    list,
    next(now = Date.now()) {
      if (config.sort === "random") {
        const healthy = healthyFromMatched(now);
        if (healthy.length === 0) return undefined;
        return nextRandomRelay(healthy);
      }

      // Round-robin through sorted candidates, skipping unhealthy.
      const sorted = getSorted();
      if (sorted.length === 0) return undefined;

      for (let i = 0; i < sorted.length; i++) {
        const idx = (cursor + i) % sorted.length;
        const relay = sorted[idx];
        if (relay && !isUnhealthy(relay.hostname, now, unhealthyUntil)) {
          cursor = (idx + 1) % sorted.length;
          return relay;
        }
      }
      return undefined;
    },
    markUnhealthy(hostname: string, now = Date.now()) {
      unhealthyUntil.set(hostname, now + config.unhealthyBackoffMs);
      generation++;
    },
    update(nextRelays: RelayRecord[], nextConfig: RelaySelectionConfig = {}) {
      relays = nextRelays.map(normalizeRelay);
      config = normalizeConfig({ ...config, ...nextConfig });
      cursor = 0;
      randomSourceOrder = [];
      randomSourceCursor = 0;
      generation++;
      randomSourceRelayCycles = new Map();
      randomSourceRelayCursors = new Map();
      invalidateStructuralCache();
    },
    getConfig() {
      return config;
    },
  };

  function healthyFromMatched(now: number): RelayRecord[] {
    const matched = getMatched();
    if (unhealthyUntil.size === 0) return matched;
    return matched.filter((r) => !isUnhealthy(r.hostname, now, unhealthyUntil));
  }

  function nextRandomRelay(
    healthyCandidates: RelayRecord[],
  ): RelayRecord | undefined {
    let candidatesBySource = getGroupedBySource();
    // Filter out unhealthy from each source's relay list (copy to avoid mutating cache)
    if (unhealthyUntil.size > 0) {
      const now = Date.now();
      candidatesBySource = new Map();
      for (const [source, sourceRelays] of getGroupedBySource()) {
        const filtered = sourceRelays.filter(
          (r) => !isUnhealthy(r.hostname, now, unhealthyUntil),
        );
        if (filtered.length > 0) {
          candidatesBySource.set(source, filtered);
        }
      }
    }

    if (candidatesBySource.size === 1) {
      return nextSingleSourceRandomRelay(healthyCandidates);
    }

    if (
      randomGeneration !== generation ||
      randomSourceCursor >= randomSourceOrder.length
    ) {
      randomSourceOrder = shuffleValues(Array.from(candidatesBySource.keys()));
      randomSourceCursor = 0;
      randomGeneration = generation;
      randomSourceRelayCycles = new Map();
      randomSourceRelayCursors = new Map();
    }

    if (randomSourceOrder.length === 0) {
      return undefined;
    }

    const source =
      randomSourceOrder[randomSourceCursor % randomSourceOrder.length];
    if (!source) {
      return undefined;
    }
    randomSourceCursor = (randomSourceCursor + 1) % randomSourceOrder.length;

    const sourceRelays = candidatesBySource.get(source);
    if (!sourceRelays || sourceRelays.length === 0) {
      return undefined;
    }

    const existingCycle = randomSourceRelayCycles.get(source);
    const existingCursor = randomSourceRelayCursors.get(source) ?? 0;

    if (!existingCycle || existingCursor >= existingCycle.length) {
      randomSourceRelayCycles.set(source, shuffleValues([...sourceRelays]));
      randomSourceRelayCursors.set(source, 0);
    }

    const cycle = randomSourceRelayCycles.get(source);
    const cursor = randomSourceRelayCursors.get(source) ?? 0;
    const relay = cycle?.[cursor];
    randomSourceRelayCursors.set(source, cursor + 1);
    return relay;
  }

  function nextSingleSourceRandomRelay(
    healthyCandidates: RelayRecord[],
  ): RelayRecord | undefined {
    const source = healthyCandidates[0]?.source;
    if (!source) {
      return undefined;
    }

    const existingCycle = randomSourceRelayCycles.get(source);
    const existingCursor = randomSourceRelayCursors.get(source) ?? 0;

    if (
      randomGeneration !== generation ||
      !existingCycle ||
      existingCursor >= existingCycle.length
    ) {
      randomGeneration = generation;
      randomSourceRelayCycles = new Map([
        [source, shuffleValues([...healthyCandidates])],
      ]);
      randomSourceRelayCursors = new Map([[source, 0]]);
    }

    const cycle = randomSourceRelayCycles.get(source);
    const cursor = randomSourceRelayCursors.get(source) ?? 0;
    const relay = cycle?.[cursor];
    randomSourceRelayCursors.set(source, cursor + 1);
    return relay;
  }
}

function normalizeConfig(
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

function matches(
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

function sortRelays(
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
      next.sort((a, b) => a.hostname.localeCompare(b.hostname));
      return next;
    default:
      return next;
  }
}

function groupRelaysBySource(
  relays: RelayRecord[],
): Map<string, RelayRecord[]> {
  const bySource = new Map<string, RelayRecord[]>();

  for (const relay of relays) {
    const sourceRelays = bySource.get(relay.source) ?? [];
    sourceRelays.push(relay);
    bySource.set(relay.source, sourceRelays);
  }

  return bySource;
}

function shuffleValues<T>(values: T[]): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = values[index] as T;
    values[index] = values[swapIndex] as T;
    values[swapIndex] = current;
  }
  return values;
}

function isUnhealthy(
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
