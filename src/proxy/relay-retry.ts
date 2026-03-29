import type { RelayRecord } from "../relay/relay-types";
import type { StatsTracker } from "../stats";

export interface RelayRetryDeps {
  pickRelay: () => RelayRecord | undefined;
  markRelayUnhealthy: (hostname: string) => void;
  statsTracker: StatsTracker;
  onRelaySuccess?: (relay: RelayRecord) => void;
  onRelayFailure?: (relay: RelayRecord) => void;
}

export async function tryRelays(
  deps: RelayRetryDeps,
  action: (relay: RelayRecord) => Promise<void>,
): Promise<Error | undefined> {
  const attempted = new Set<string>();
  let lastError: Error | undefined;

  while (true) {
    const relay = deps.pickRelay();
    if (!relay || attempted.has(relay.hostname)) {
      if (lastError) {
        deps.statsTracker.recordRequestFailed();
      }
      return lastError;
    }

    attempted.add(relay.hostname);

    try {
      await action(relay);
      deps.statsTracker.recordRequest(relay.hostname);
      deps.onRelaySuccess?.(relay);
      return undefined;
    } catch (error) {
      deps.markRelayUnhealthy(relay.hostname);
      deps.statsTracker.recordRelayFailure(relay.hostname);
      deps.onRelayFailure?.(relay);
      lastError =
        error instanceof Error
          ? error
          : new Error("Failed to use upstream relay");
    }
  }
}
