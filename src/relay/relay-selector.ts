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
  sort: RelaySort;
}

export function createRelaySelector(
  initialRelays: RelayRecord[],
  initialConfig: RelaySelectionConfig = {},
): RelaySelector {
  let relays = [...initialRelays];
  let config = normalizeConfig(initialConfig);
  let cursor = 0;
  let randomSourceOrder: string[] = [];
  let randomSourceCursor = 0;
  let randomSourceKey = "";
  let randomSourceRelayCycles = new Map<string, RelayRecord[]>();
  let randomSourceRelayCursors = new Map<string, number>();
  const unhealthyUntil = new Map<string, number>();

  const filterRelays = (now: number): RelayRecord[] =>
    relays.filter(
      (relay) =>
        matches(relay, config) &&
        !isUnhealthy(relay.hostname, now, unhealthyUntil),
    );

  const list = (now = Date.now()): RelayRecord[] =>
    sortRelays(filterRelays(now), config.sort);

  return {
    list,
    next(now = Date.now()) {
      const candidates = filterRelays(now);
      if (candidates.length === 0) {
        return undefined;
      }

      if (config.sort === "random") {
        return nextRandomRelay(candidates);
      }

      const ordered = sortRelays(candidates, config.sort);

      const relay = ordered[cursor % ordered.length];
      cursor = (cursor + 1) % ordered.length;
      return relay;
    },
    markUnhealthy(hostname: string, now = Date.now()) {
      unhealthyUntil.set(hostname, now + config.unhealthyBackoffMs);
    },
    update(nextRelays: RelayRecord[], nextConfig: RelaySelectionConfig = {}) {
      relays = [...nextRelays];
      config = normalizeConfig({ ...config, ...nextConfig });
      cursor = 0;
      randomSourceOrder = [];
      randomSourceCursor = 0;
      randomSourceKey = "";
      randomSourceRelayCycles = new Map();
      randomSourceRelayCursors = new Map();
    },
    getConfig() {
      return config;
    },
  };

  function nextRandomRelay(candidates: RelayRecord[]): RelayRecord | undefined {
    const candidatesBySource = groupRelaysBySource(candidates);
    if (candidatesBySource.size === 1) {
      return nextSingleSourceRandomRelay(candidates);
    }

    const sourceKey = Array.from(candidatesBySource.entries())
      .map(
        ([source, sourceRelays]) =>
          `${source}:${sourceRelays.map((relay) => relay.hostname).join(",")}`,
      )
      .join("|");

    if (
      randomSourceKey !== sourceKey ||
      randomSourceCursor >= randomSourceOrder.length
    ) {
      randomSourceOrder = shuffleValues(Array.from(candidatesBySource.keys()));
      randomSourceCursor = 0;
      randomSourceKey = sourceKey;
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
    const sourceRelayKey = sourceRelays
      .map((relay) => relay.hostname)
      .join("|");
    const existingKey = existingCycle
      ?.map((relay) => relay.hostname)
      .sort()
      .join("|");

    if (
      !existingCycle ||
      existingKey !== sourceRelayKey ||
      existingCursor >= existingCycle.length
    ) {
      randomSourceRelayCycles.set(source, shuffleRelays([...sourceRelays]));
      randomSourceRelayCursors.set(source, 0);
    }

    const cycle = randomSourceRelayCycles.get(source);
    const cursor = randomSourceRelayCursors.get(source) ?? 0;
    const relay = cycle?.[cursor];
    randomSourceRelayCursors.set(source, cursor + 1);
    return relay;
  }

  function nextSingleSourceRandomRelay(
    candidates: RelayRecord[],
  ): RelayRecord | undefined {
    const cycleKey = candidates.map((relay) => relay.hostname).join("|");
    const source = candidates[0]?.source;
    if (!source) {
      return undefined;
    }

    const existingCycle = randomSourceRelayCycles.get(source);
    const existingCursor = randomSourceRelayCursors.get(source) ?? 0;

    if (
      randomSourceKey !== cycleKey ||
      !existingCycle ||
      existingCursor >= existingCycle.length
    ) {
      randomSourceKey = cycleKey;
      randomSourceRelayCycles = new Map([
        [source, shuffleRelays([...candidates])],
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
  return {
    country: config.country?.trim().toLowerCase() ?? "",
    city: config.city?.trim().toLowerCase() ?? "",
    hostname: config.hostname?.trim().toLowerCase() ?? "",
    provider: config.provider?.trim().toLowerCase() ?? "",
    ownership: config.ownership,
    excludeCountry: config.excludeCountry ?? [],
    sort: config.sort ?? "hostname",
    unhealthyBackoffMs: config.unhealthyBackoffMs ?? 30_000,
  };
}

function matches(
  relay: RelayRecord,
  config: ResolvedRelaySelectionConfig,
): boolean {
  if (
    config.country &&
    relay.countryCode.toLowerCase() !== config.country &&
    relay.countryName.toLowerCase() !== config.country
  ) {
    return false;
  }

  if (
    config.excludeCountry &&
    config.excludeCountry.length > 0 &&
    config.excludeCountry.some(
      (excluded) =>
        relay.countryCode.toLowerCase() === excluded ||
        relay.countryName.toLowerCase() === excluded,
    )
  ) {
    return false;
  }

  if (
    config.city &&
    relay.cityCode.toLowerCase() !== config.city &&
    relay.cityName.toLowerCase() !== config.city
  ) {
    return false;
  }

  if (
    config.hostname &&
    !relay.hostname.toLowerCase().includes(config.hostname)
  ) {
    return false;
  }

  if (config.provider && relay.provider.toLowerCase() !== config.provider) {
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
      return shuffleRelays(next);
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

function shuffleRelays(relays: RelayRecord[]): RelayRecord[] {
  return shuffleValues(relays);
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
