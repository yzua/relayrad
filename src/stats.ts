export interface RelayStats {
  requests: number;
  failures: number;
}

export interface StatsSnapshot {
  requestsTotal: number;
  failuresTotal: number;
  activeConnections: number;
  startTime: string;
  relayStats: Record<string, RelayStats>;
}

export interface StatsTracker {
  recordRequest(hostname: string): void;
  recordRelayFailure(hostname: string): void;
  recordRequestFailed(): void;
  connectionStart(): void;
  connectionEnd(): void;
  snapshot(): StatsSnapshot;
}

export function createStatsTracker(): StatsTracker {
  const relayStats = new Map<string, RelayStats>();
  const startTime = new Date().toISOString();
  let requestsTotal = 0;
  let failuresTotal = 0;
  let activeConnections = 0;

  function getOrCreate(hostname: string): RelayStats {
    let entry = relayStats.get(hostname);
    if (!entry) {
      entry = { requests: 0, failures: 0 };
      relayStats.set(hostname, entry);
    }
    return entry;
  }

  return {
    recordRequest(hostname: string) {
      getOrCreate(hostname).requests++;
      requestsTotal++;
    },
    recordRelayFailure(hostname: string) {
      getOrCreate(hostname).failures++;
    },
    recordRequestFailed() {
      failuresTotal++;
    },
    connectionStart() {
      activeConnections++;
    },
    connectionEnd() {
      activeConnections--;
    },
    snapshot() {
      const relayStatsObj: Record<string, RelayStats> = {};
      for (const [hostname, stats] of relayStats) {
        relayStatsObj[hostname] = { ...stats };
      }
      return {
        requestsTotal,
        failuresTotal,
        activeConnections,
        startTime,
        relayStats: relayStatsObj,
      };
    },
  };
}
