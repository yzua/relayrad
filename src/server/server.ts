import {
  createServer as createNodeServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { ProxyRequestLogger } from "../logging/proxy-request-logger";
import {
  handleConnectTunnel,
  handleHttpProxyRequest,
  type ProxyRuntime,
} from "../proxy/http-proxy";
import { createRelaySelector } from "../relay/relay-selector";
import type { RelayRecord, RelaySelectionConfig } from "../relay/relay-types";
import type { StatsTracker } from "../stats";
import { defaultSelectionConfig } from "./config";
import {
  InvalidJsonBodyError,
  readJsonBody,
  sanitizeSelectionConfig,
  selectionConfigFromUrl,
} from "./selection-config";

export interface ProxyServerDeps {
  initialRelays: RelayRecord[];
  refreshRelays: () => Promise<RelayRecord[]>;
  requestLogger: ProxyRequestLogger;
  statsTracker: StatsTracker;
  proxyAuth?: { username: string; password: string };
}

export interface ProxyServer {
  listen(port: number, hostname?: string): Promise<void>;
  close(): Promise<void>;
  address(): AddressInfo | string | null;
}

export function createServer(deps: ProxyServerDeps): ProxyServer {
  let relays = [...deps.initialRelays];
  const selector = createRelaySelector(relays, defaultSelectionConfig);
  const relayListCache = new Map<string, RelayRecord[]>();

  const runtime: ProxyRuntime = {
    pickRelay: () => selector.next(),
    markRelayUnhealthy: (hostname: string) => selector.markUnhealthy(hostname),
    requestLogger: deps.requestLogger,
    statsTracker: deps.statsTracker,
  };

  const routeDeps: RouteDeps = {
    listRelays: (filters) => {
      const cacheKey = relayFilterCacheKey(filters);
      const cached = relayListCache.get(cacheKey);
      if (cached) {
        return [...cached];
      }

      const next = createRelaySelector(relays, filters).list();
      relayListCache.set(cacheKey, next);

      if (relayListCache.size > 64) {
        const oldestKey = relayListCache.keys().next().value;
        if (oldestKey !== undefined) {
          relayListCache.delete(oldestKey);
        }
      }

      return [...next];
    },
    updateConfig: (nextConfig) => {
      selector.update(relays, nextConfig);
      relayListCache.clear();
      return selector.getConfig();
    },
    refresh: async () => {
      relays = await deps.refreshRelays();
      selector.update(relays);
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

  server.on("connect", (req, clientSocket, head) => {
    if (
      deps.proxyAuth &&
      !checkProxyAuthRaw(req.headers["proxy-authorization"], deps.proxyAuth)
    ) {
      clientSocket.write(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="relayrad"\r\n\r\n',
      );
      clientSocket.destroy();
      return;
    }

    void handleConnectTunnel(
      req.url,
      clientSocket as Socket,
      head,
      runtime,
    ).catch((error) => {
      const body =
        error instanceof Error ? error.message : "CONNECT tunnel failed";
      clientSocket.write(
        `HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
      );
      clientSocket.destroy();
    });
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
  };
}

interface RouteDeps {
  listRelays: (filters: RelaySelectionConfig) => RelayRecord[];
  updateConfig: (
    config: RelaySelectionConfig,
  ) => Required<RelaySelectionConfig>;
  refresh: () => Promise<RelayRecord[]>;
  statsTracker: StatsTracker;
}

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: ProxyRuntime,
  deps: RouteDeps,
  proxyAuth?: { username: string; password: string },
): Promise<void> {
  const requestUrl = req.url ?? "/";
  if (isProxyRequest(requestUrl)) {
    if (proxyAuth && !checkProxyAuth(req, proxyAuth)) {
      sendProxyAuthRequired(res);
      return;
    }
    await handleHttpProxyRequest(req, res, runtime);
    return;
  }

  const url = parseRequestUrl(requestUrl, req.headers.host);
  if (!url) {
    sendJson(res, 400, { error: "Invalid request URL" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/relays") {
    const filters = selectionConfigFromUrl(url);
    const relayList = deps.listRelays(filters);
    sendJson(res, 200, { relays: relayList, total: relayList.length });
    return;
  }

  if (req.method === "POST" && url.pathname === "/rotate") {
    const body = await readJsonBody(req);
    const config = deps.updateConfig(sanitizeSelectionConfig(body));
    sendJson(res, 200, {
      config,
      preview: deps.listRelays(config).slice(0, 10),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/relays/refresh") {
    const nextRelays = await deps.refresh();
    sendJson(res, 200, { total: nextRelays.length });
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/stats") {
    const stats = deps.statsTracker.snapshot();
    const topRelays = Object.entries(stats.relayStats)
      .map(([hostname, s]) => ({
        hostname,
        requests: s.requests,
        failures: s.failures,
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 10);
    sendJson(res, 200, {
      requestsTotal: stats.requestsTotal,
      failuresTotal: stats.failuresTotal,
      activeConnections: stats.activeConnections,
      startTime: stats.startTime,
      topRelays,
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function isProxyRequest(url: string): boolean {
  return /^http:\/\//i.test(url);
}

function parseRequestUrl(
  requestUrl: string,
  host: string | undefined,
): URL | undefined {
  try {
    return new URL(requestUrl, `http://${host ?? "127.0.0.1"}`);
  } catch {
    return undefined;
  }
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function relayFilterCacheKey(filters: RelaySelectionConfig): string {
  return JSON.stringify({
    country: filters.country ?? "",
    city: filters.city ?? "",
    hostname: filters.hostname ?? "",
    provider: filters.provider ?? "",
    ownership: filters.ownership ?? "",
    excludeCountry: filters.excludeCountry ?? "",
    sort: filters.sort ?? "",
  });
}

function checkProxyAuth(
  req: IncomingMessage,
  expected: { username: string; password: string },
): boolean {
  const header = req.headers["proxy-authorization"];
  if (!header || !header.startsWith("Basic ")) {
    return false;
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return false;
  }

  return (
    decoded.slice(0, separator) === expected.username &&
    decoded.slice(separator + 1) === expected.password
  );
}

function sendProxyAuthRequired(res: ServerResponse): void {
  res.writeHead(407, {
    "proxy-authenticate": 'Basic realm="relayrad"',
    "content-type": "application/json",
  });
  res.end(JSON.stringify({ error: "Proxy authentication required" }));
}

function checkProxyAuthRaw(
  header: string | undefined,
  expected: { username: string; password: string },
): boolean {
  if (!header || !header.startsWith("Basic ")) {
    return false;
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return false;
  }

  return (
    decoded.slice(0, separator) === expected.username &&
    decoded.slice(separator + 1) === expected.password
  );
}
