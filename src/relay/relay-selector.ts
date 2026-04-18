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

  // Generation counter — bumped on update() only. Relay membership doesn't
  // change when a relay is marked unhealthy, so random cycles stay valid.
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
        const grouped = getGroupedBySource();
        if (grouped.size === 0) return undefined;
        if (grouped.size === 1) return nextSingleSourceRandomRelay(now);
        return nextRandomRelay(now, grouped);
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
    now: number,
    candidatesBySource: Map<string, RelayRecord[]>,
  ): RelayRecord | undefined {
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

    let cycle = randomSourceRelayCycles.get(source);
    let cycleCursor = randomSourceRelayCursors.get(source) ?? 0;

    if (!cycle || cycleCursor >= cycle.length) {
      cycle = shuffleValues([...sourceRelays]);
      randomSourceRelayCycles.set(source, cycle);
      cycleCursor = 0;
    }

    // Skip unhealthy relays in the pre-built cycle
    while (cycleCursor < cycle.length) {
      const relay = cycle[cycleCursor];
      cycleCursor++;
      if (relay && !isUnhealthy(relay.hostname, now, unhealthyUntil)) {
        randomSourceRelayCursors.set(source, cycleCursor);
        return relay;
      }
    }

    // Cycle exhausted (all remaining were unhealthy)
    randomSourceRelayCursors.set(source, cycleCursor);
    return undefined;
  }

  function scanCycleForHealthy(
    cycle: RelayRecord[] | undefined,
    source: string,
    startAt: number,
    now: number,
  ): RelayRecord | undefined {
    if (!cycle) return undefined;
    for (let i = startAt; i < cycle.length; i++) {
      randomSourceRelayCursors.set(source, i + 1);
      const relay = cycle[i];
      if (relay && !isUnhealthy(relay.hostname, now, unhealthyUntil)) {
        return relay;
      }
    }
    return undefined;
  }

  function nextSingleSourceRandomRelay(now: number): RelayRecord | undefined {
    const matched = getMatched();
    if (matched.length === 0) return undefined;

    const first = matched[0];
    if (!first) return undefined;
    const source = first.source;

    const existingCycle = randomSourceRelayCycles.get(source);
    const existingCursor = randomSourceRelayCursors.get(source) ?? 0;

    if (
      randomGeneration !== generation ||
      !existingCycle ||
      existingCursor >= existingCycle.length
    ) {
      randomGeneration = generation;
      randomSourceRelayCycles = new Map([
        [source, shuffleValues([...matched])],
      ]);
      randomSourceRelayCursors = new Map([[source, 0]]);
    }

    const cycle = randomSourceRelayCycles.get(source);
    const cursor = randomSourceRelayCursors.get(source) ?? 0;

    const found = scanCycleForHealthy(cycle, source, cursor, now);
    if (found) return found;

    // All remaining in cycle were unhealthy — rebuild and retry once
    randomSourceRelayCycles = new Map([[source, shuffleValues([...matched])]]);
    randomSourceRelayCursors = new Map([[source, 0]]);

    return scanCycleForHealthy(
      randomSourceRelayCycles.get(source),
      source,
      0,
      now,
    );
  }
}
