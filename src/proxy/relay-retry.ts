import type { ProxyRequestLogger } from "../logging/proxy-request-logger";
import type { RelayRecord } from "../relay/relay-types";
import type { StatsTracker } from "../stats";

export interface RelayRetryDeps {
  pickRelay: () => RelayRecord | undefined;
  pickRelayFromSource: (source: string) => RelayRecord | undefined;
  markRelayUnhealthy: (hostname: string) => void;
  statsTracker: StatsTracker;
  onRelaySuccess?: (relay: RelayRecord) => void;
  onRelayFailure?: (relay: RelayRecord) => void;
}

export interface ProxyRuntimeBase {
  pickRelay: () => RelayRecord | undefined;
  pickRelayFromSource: (source: string) => RelayRecord | undefined;
  markRelayUnhealthy: (hostname: string) => void;
  requestLogger: ProxyRequestLogger;
  statsTracker: StatsTracker;
}

export interface ProxyRuntime extends ProxyRuntimeBase {
  pickStickyRelay: (sessionKey: string) => RelayRecord | undefined;
  rememberStickyRelay: (sessionKey: string, relayHostname: string) => void;
  clearStickyRelay: (sessionKey: string) => void;
}

export function parseStickySessionHeader(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const sessionKey = value.trim();
  return sessionKey ? sessionKey : undefined;
}

export function createRetryDeps(
  runtime: ProxyRuntime,
  sessionKey?: string,
): RelayRetryDeps {
  const stickyRelay = sessionKey
    ? runtime.pickStickyRelay(sessionKey)
    : undefined;
  let stickyRelayAvailable = Boolean(stickyRelay);

  const deps: RelayRetryDeps = {
    pickRelay: () => {
      if (stickyRelayAvailable) {
        stickyRelayAvailable = false;
        return stickyRelay;
      }

      return runtime.pickRelay();
    },
    pickRelayFromSource: (source: string) => {
      return runtime.pickRelayFromSource(source);
    },
    markRelayUnhealthy: runtime.markRelayUnhealthy,
    statsTracker: runtime.statsTracker,
  };

  if (sessionKey) {
    deps.onRelaySuccess = (relay) => {
      runtime.rememberStickyRelay(sessionKey, relay.hostname);
    };
    deps.onRelayFailure = (relay) => {
      if (relay.hostname === stickyRelay?.hostname) {
        runtime.clearStickyRelay(sessionKey);
      }
    };
  }

  return deps;
}

export async function tryRelays(
  deps: RelayRetryDeps,
  action: (relay: RelayRecord) => Promise<void>,
): Promise<Error | undefined> {
  return tryRelaysSequential(deps, action);
}

async function tryRelaysSequential(
  deps: RelayRetryDeps,
  action: (relay: RelayRecord) => Promise<void>,
): Promise<Error | undefined> {
  const attempted = new Set<string>();
  let lastError: Error | undefined;
  let source: string | undefined;

  while (true) {
    let relay: RelayRecord | undefined;

    if (source) {
      relay = deps.pickRelayFromSource(source);
    } else {
      relay = deps.pickRelay();
    }

    if (!relay || attempted.has(relay.hostname)) {
      if (lastError) {
        deps.statsTracker.recordRequestFailed();
      }
      return lastError;
    }

    if (!source) {
      source = relay.source;
    }

    attempted.add(relay.hostname);

    try {
      await action(relay);
      deps.statsTracker.recordRequest(relay.hostname);
      deps.onRelaySuccess?.(relay);
      return undefined;
    } catch (error) {
      handleRelayFailure(deps, relay, error);
      lastError =
        error instanceof Error
          ? error
          : new Error("Failed to use upstream relay");
    }
  }
}

function handleRelayFailure(
  deps: RelayRetryDeps,
  relay: RelayRecord,
  error: unknown,
): void {
  deps.markRelayUnhealthy(relay.hostname);
  deps.statsTracker.recordRelayFailure(relay.hostname);
  deps.onRelayFailure?.(relay);
  const msg = error instanceof Error ? error.message : "Unknown error";
  console.warn(
    `relayrad: relay ${relay.hostname} (${relay.ipv4}:${relay.socks5Port}) failed: ${msg}`,
  );
}
