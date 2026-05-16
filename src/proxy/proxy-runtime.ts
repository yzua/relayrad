import type { ProxyRequestLogger } from "../logging/proxy-request-logger";
import { createRelaySelector } from "../relay/relay-selector";
import type { RelayRecord, RelaySelectionConfig } from "../relay/relay-types";
import { createStickySessionManager } from "../server/sticky-session-manager";
import type { StatsTracker } from "../stats";
import type { ProxyRuntime } from "./relay-retry";

const STICKY_SESSION_TTL_MS = 5 * 60_000;
const RUNTIME_DEFAULT_CONFIG: RelaySelectionConfig = {
  sort: "random",
  unhealthyBackoffMs: 30_000,
};

export interface ProxyRuntimeHandle {
  runtime: ProxyRuntime;
  selector: ReturnType<typeof createRelaySelector>;
  setRelays(nextRelays: RelayRecord[]): void;
  readonly relayByHostname: Map<string, RelayRecord>;
}

export function createProxyRuntimeHandle(deps: {
  relays: RelayRecord[];
  config?: RelaySelectionConfig;
  requestLogger: ProxyRequestLogger;
  statsTracker: StatsTracker;
}): ProxyRuntimeHandle {
  const config = deps.config ?? RUNTIME_DEFAULT_CONFIG;
  const selector = createRelaySelector(deps.relays, config);
  const stickySessions = createStickySessionManager(STICKY_SESSION_TTL_MS);

  let relayByHostname = new Map<string, RelayRecord>(
    deps.relays.map((r) => [r.hostname, r]),
  );

  const runtime: ProxyRuntime = {
    pickRelay: () => selector.next(),
    pickRelayFromSource: (source) => selector.nextFromSource(source),
    pickStickyRelay: (sessionKey) =>
      stickySessions.get(sessionKey, relayByHostname),
    rememberStickyRelay: (sessionKey, relayHostname) =>
      stickySessions.set(sessionKey, relayHostname),
    clearStickyRelay: (sessionKey) => stickySessions.delete(sessionKey),
    markRelayUnhealthy: (hostname) => selector.markUnhealthy(hostname),
    requestLogger: deps.requestLogger,
    statsTracker: deps.statsTracker,
  };

  return {
    runtime,
    selector,
    setRelays(nextRelays) {
      relayByHostname = new Map(nextRelays.map((r) => [r.hostname, r]));
    },
    get relayByHostname() {
      return relayByHostname;
    },
  };
}
