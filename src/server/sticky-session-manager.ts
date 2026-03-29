import type { RelayRecord } from "../relay/relay-types";

interface StickySessionEntry {
  relayHostname: string;
  expiresAt: number;
}

export interface StickySessionManager {
  get(
    sessionKey: string,
    relays: RelayRecord[],
    now?: number,
  ): RelayRecord | undefined;
  set(sessionKey: string, relayHostname: string, now?: number): void;
  delete(sessionKey: string): void;
}

export function createStickySessionManager(
  ttlMs: number,
): StickySessionManager {
  const sessions = new Map<string, StickySessionEntry>();

  return {
    get(sessionKey, relays, now = Date.now()) {
      const entry = sessions.get(sessionKey);
      if (!entry) {
        return undefined;
      }

      if (entry.expiresAt <= now) {
        sessions.delete(sessionKey);
        return undefined;
      }

      const relay = relays.find(
        (candidate) => candidate.hostname === entry.relayHostname,
      );
      if (!relay) {
        sessions.delete(sessionKey);
        return undefined;
      }

      entry.expiresAt = now + ttlMs;
      return relay;
    },
    set(sessionKey, relayHostname, now = Date.now()) {
      sessions.set(sessionKey, {
        relayHostname,
        expiresAt: now + ttlMs,
      });
    },
    delete(sessionKey) {
      sessions.delete(sessionKey);
    },
  };
}
