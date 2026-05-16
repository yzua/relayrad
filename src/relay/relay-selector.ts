import type { RelayRecord, RelaySelectionConfig } from "./relay-types";
import type { ResolvedRelaySelectionConfig } from "./relay-utils";
import {
  groupRelaysBySource,
  isUnhealthy,
  matches,
  normalizeConfig,
  normalizeRelay,
  shuffleValues,
  sortRelays,
} from "./relay-utils";

export type { ResolvedRelaySelectionConfig } from "./relay-utils";

export interface RelaySelector {
  list(now?: number): RelayRecord[];
  next(now?: number): RelayRecord | undefined;
  markUnhealthy(hostname: string, now?: number): void;
  update(relays: RelayRecord[], config?: RelaySelectionConfig): void;
  getConfig(): ResolvedRelaySelectionConfig;
}

export interface SourceAwareRelaySelector extends RelaySelector {
  nextFromSource(source: string, now?: number): RelayRecord | undefined;
}

export function createRelaySelector(
  initialRelays: RelayRecord[],
  initialConfig: RelaySelectionConfig = {},
): SourceAwareRelaySelector {
  let relays = initialRelays.map(normalizeRelay);
  let config = normalizeConfig(initialConfig);
  let cursor = 0;
  let randomSourceCursor = 0;
  let randomSourceOrder: string[] = [];
  let randomSourceRelayCycles = new Map<string, RelayRecord[]>();
  let randomSourceRelayCursors = new Map<string, number>();
  const unhealthyUntil = new Map<string, number>();

  let generation = 0;
  let randomGeneration = -1;

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
        const grouped = getGroupedBySource();
        if (grouped.size === 0) return undefined;
        if (grouped.size === 1) return nextSingleSourceRandomRelay(now);

        ensureSourceOrder(grouped);

        if (randomSourceOrder.length === 0) return undefined;

        const source =
          randomSourceOrder[randomSourceCursor % randomSourceOrder.length];
        if (!source) return undefined;
        randomSourceCursor =
          (randomSourceCursor + 1) % randomSourceOrder.length;

        return nextFromSourceInternal(source, now, grouped);
      }

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

    nextFromSource(source: string, now = Date.now()) {
      if (config.sort === "random") {
        const grouped = getGroupedBySource();
        return nextFromSourceInternal(source, now, grouped);
      }

      const sorted = getSorted();
      const sourceRelays = sorted.filter((r) => r.source === source);
      for (const relay of sourceRelays) {
        if (!isUnhealthy(relay.hostname, now, unhealthyUntil)) {
          return relay;
        }
      }
      return undefined;
    },

    markUnhealthy(hostname: string, now = Date.now()) {
      unhealthyUntil.set(hostname, now + config.unhealthyBackoffMs);
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

  function ensureSourceOrder(grouped: Map<string, RelayRecord[]>): void {
    if (
      randomGeneration !== generation ||
      randomSourceCursor >= randomSourceOrder.length
    ) {
      randomSourceOrder = shuffleValues(Array.from(grouped.keys()));
      randomSourceCursor = 0;
      randomGeneration = generation;
      randomSourceRelayCycles = new Map();
      randomSourceRelayCursors = new Map();
    }
  }

  function nextFromSourceInternal(
    source: string,
    now: number,
    candidatesBySource: Map<string, RelayRecord[]>,
  ): RelayRecord | undefined {
    const sourceRelays = candidatesBySource.get(source);
    if (!sourceRelays || sourceRelays.length === 0) return undefined;

    let cycle = randomSourceRelayCycles.get(source);
    let cycleCursor = randomSourceRelayCursors.get(source) ?? 0;

    if (!cycle || cycleCursor >= cycle.length) {
      cycle = shuffleValues([...sourceRelays]);
      randomSourceRelayCycles.set(source, cycle);
      cycleCursor = 0;
    }

    while (cycleCursor < cycle.length) {
      const relay = cycle[cycleCursor];
      cycleCursor++;
      if (relay && !isUnhealthy(relay.hostname, now, unhealthyUntil)) {
        randomSourceRelayCursors.set(source, cycleCursor);
        return relay;
      }
    }

    // All remaining unhealthy — reshuffle and try once more
    cycle = shuffleValues([...sourceRelays]);
    randomSourceRelayCycles.set(source, cycle);
    randomSourceRelayCursors.set(source, 0);

    for (let i = 0; i < cycle.length; i++) {
      const relay = cycle[i];
      if (relay && !isUnhealthy(relay.hostname, now, unhealthyUntil)) {
        randomSourceRelayCursors.set(source, i + 1);
        return relay;
      }
    }

    return undefined;
  }

  function healthyFromMatched(now: number): RelayRecord[] {
    const matched = getMatched();
    if (unhealthyUntil.size === 0) return matched;
    return matched.filter((r) => !isUnhealthy(r.hostname, now, unhealthyUntil));
  }

  function nextSingleSourceRandomRelay(now: number): RelayRecord | undefined {
    const matched = getMatched();
    if (matched.length === 0) return undefined;

    const first = matched[0];
    if (!first) return undefined;
    const source = first.source;

    return nextFromSourceInternal(source, now, getGroupedBySource());
  }
}
