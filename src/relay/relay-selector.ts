import type { RelayRecord, RelaySelectionConfig } from "./relay-types";

export interface RelaySelector {
  list(now?: number): RelayRecord[];
  next(now?: number): RelayRecord | undefined;
  markUnhealthy(hostname: string, now?: number): void;
  update(relays: RelayRecord[], config?: RelaySelectionConfig): void;
  getConfig(): Required<RelaySelectionConfig>;
}

const defaultConfig: Required<RelaySelectionConfig> = {
  country: "",
  city: "",
  hostname: "",
  provider: "",
  ownership: undefined as never,
  sort: "hostname",
  unhealthyBackoffMs: 30_000,
};

export function createRelaySelector(
  initialRelays: RelayRecord[],
  initialConfig: RelaySelectionConfig = {},
): RelaySelector {
  let relays = [...initialRelays];
  let config = normalizeConfig(initialConfig);
  let cursor = 0;
  let randomCycle: RelayRecord[] = [];
  let randomCycleCursor = 0;
  let randomCycleKey = "";
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
        const cycleKey = candidates.map((relay) => relay.hostname).join("|");
        if (
          randomCycleKey !== cycleKey ||
          randomCycleCursor >= randomCycle.length
        ) {
          randomCycle = shuffleRelays([...candidates]);
          randomCycleCursor = 0;
          randomCycleKey = cycleKey;
        }

        const relay = randomCycle[randomCycleCursor];
        randomCycleCursor += 1;
        return relay;
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
      randomCycle = [];
      randomCycleCursor = 0;
      randomCycleKey = "";
    },
    getConfig() {
      return config;
    },
  };
}

function normalizeConfig(
  config: RelaySelectionConfig,
): Required<RelaySelectionConfig> {
  return {
    country: config.country?.trim().toLowerCase() ?? "",
    city: config.city?.trim().toLowerCase() ?? "",
    hostname: config.hostname?.trim().toLowerCase() ?? "",
    provider: config.provider?.trim().toLowerCase() ?? "",
    ownership: config.ownership ?? (undefined as never),
    sort: config.sort ?? defaultConfig.sort,
    unhealthyBackoffMs:
      config.unhealthyBackoffMs ?? defaultConfig.unhealthyBackoffMs,
  };
}

function matches(
  relay: RelayRecord,
  config: Required<RelaySelectionConfig>,
): boolean {
  if (
    config.country &&
    relay.countryCode.toLowerCase() !== config.country &&
    relay.countryName.toLowerCase() !== config.country
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
  sort: Required<RelaySelectionConfig>["sort"],
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
    default:
      next.sort((a, b) => a.hostname.localeCompare(b.hostname));
      return next;
  }
}

function shuffleRelays(relays: RelayRecord[]): RelayRecord[] {
  for (let index = relays.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = relays[index] as RelayRecord;
    relays[index] = relays[swapIndex] as RelayRecord;
    relays[swapIndex] = current;
  }
  return relays;
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
