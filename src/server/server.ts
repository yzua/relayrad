import {
  createServer as createNodeServer,
  type IncomingMessage,
} from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { ProxyRequestLogger } from "../logging/proxy-request-logger";
import { createProxyRuntimeHandle } from "../proxy/proxy-runtime";
import {
  type ProxyRuntime,
  parseStickySessionHeader,
} from "../proxy/relay-retry";
import { sendSocketError } from "../proxy/socket-utils";
import {
  handleConnectTunnel,
  handleWebSocketUpgrade,
} from "../proxy/tunnel-handlers";
import { createRelaySelector } from "../relay/relay-selector";
import type { RelayRecord, RelaySelectionConfig } from "../relay/relay-types";
import type { StatsTracker } from "../stats";
import { checkProxyAuthRaw } from "./proxy-auth";
import { type RouteDeps, routeRequest, sendJson } from "./routes";
import { InvalidJsonBodyError } from "./selection-config";

export interface ProxyServerDeps {
  initialRelays: RelayRecord[];
  refreshRelays: () => Promise<RelayRecord[]>;
  requestLogger: ProxyRequestLogger;
  statsTracker: StatsTracker;
  proxyAuth?: { username: string; password: string } | undefined;
}

export interface ProxyServer {
  listen(port: number, hostname?: string): Promise<void>;
  close(): Promise<void>;
  address(): AddressInfo | string | null;
  refresh(): Promise<RelayRecord[]>;
}

export function createServer(deps: ProxyServerDeps): ProxyServer {
  let relays = [...deps.initialRelays];
  const handle = createProxyRuntimeHandle({
    relays,
    requestLogger: deps.requestLogger,
    statsTracker: deps.statsTracker,
  });
  const relayListCache = new Map<string, RelayRecord[]>();

  const runtime: ProxyRuntime = handle.runtime;

  const routeDeps: RouteDeps = {
    listRelays: (filters) => {
      const cacheKey = relayFilterCacheKey(filters);
      const cached = relayListCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const result = createRelaySelector(relays, filters).list();
      relayListCache.set(cacheKey, result);

      if (relayListCache.size > 64) {
        const oldestKey = relayListCache.keys().next().value;
        if (oldestKey !== undefined) {
          relayListCache.delete(oldestKey);
        }
      }

      return result;
    },
    updateConfig: (nextConfig) => {
      handle.selector.update(relays, nextConfig);
      relayListCache.clear();
      return handle.selector.getConfig();
    },
    refresh: async () => {
      relays = await deps.refreshRelays();
      handle.setRelays(relays);
      handle.selector.update(relays);
      relayListCache.clear();
      return relays;
    },
    statsTracker: deps.statsTracker,
  };

  const server = createNodeServer(async (req, res) => {
    try {
      await routeRequest(req, res, runtime, routeDeps, deps.proxyAuth);
    } catch (error) {
      if (error instanceof InvalidJsonBodyError) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 500, {
        error:
          error instanceof Error ? error.message : "Unexpected server error",
      });
    }
  });

  function handleSocketEvent(
    req: IncomingMessage,
    socket: Socket,
    action: () => Promise<void>,
    errorLabel: string,
  ): void {
    if (
      deps.proxyAuth &&
      !checkProxyAuthRaw(req.headers["proxy-authorization"], deps.proxyAuth)
    ) {
      sendSocketError(
        socket,
        407,
        "Proxy Authentication Required",
        "Proxy authentication required",
      );
      return;
    }

    void action().catch((error) => {
      const body =
        error instanceof Error ? error.message : `${errorLabel} failed`;
      sendSocketError(socket, 502, "Bad Gateway", body);
    });
  }

  server.on("connect", (req, clientSocket, head) => {
    handleSocketEvent(
      req,
      clientSocket as Socket,
      () =>
        handleConnectTunnel(
          req.url,
          clientSocket as Socket,
          head,
          runtime,
          parseStickySessionHeader(req.headers["x-proxy-session"]),
        ),
      "CONNECT tunnel",
    );
  });

  server.on("upgrade", (req, clientSocket, head) => {
    handleSocketEvent(
      req,
      clientSocket as Socket,
      () =>
        handleWebSocketUpgrade(
          req,
          clientSocket as Socket,
          head,
          runtime,
          parseStickySessionHeader(req.headers["x-proxy-session"]),
        ),
      "WebSocket upgrade",
    );
  });

  return {
    listen(port: number, hostname = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, hostname, () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    address() {
      return server.address();
    },
    refresh: routeDeps.refresh,
  };
}

function relayFilterCacheKey(filters: RelaySelectionConfig): string {
  const ec = filters.excludeCountry;
  return `${filters.country ?? ""}\0${filters.city ?? ""}\0${filters.hostname ?? ""}\0${filters.provider ?? ""}\0${filters.ownership ?? ""}\0${ec ? ec.join(",") : ""}\0${filters.sort ?? ""}`;
}
