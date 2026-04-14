import type { IncomingMessage, ServerResponse } from "node:http";
import { handleHttpProxyRequest, type ProxyRuntime } from "../proxy/http-proxy";
import type { ResolvedRelaySelectionConfig } from "../relay/relay-selector";
import type { RelayRecord, RelaySelectionConfig } from "../relay/relay-types";
import type { StatsTracker } from "../stats";
import {
  readJsonBody,
  sanitizeSelectionConfig,
  selectionConfigFromUrl,
  unknownFields,
} from "./selection-config";

export interface RouteDeps {
  listRelays: (filters: RelaySelectionConfig) => RelayRecord[];
  updateConfig: (config: RelaySelectionConfig) => ResolvedRelaySelectionConfig;
  refresh: () => Promise<RelayRecord[]>;
  statsTracker: StatsTracker;
}

export async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: ProxyRuntime,
  deps: RouteDeps,
  proxyAuth?: { username: string; password: string },
): Promise<void> {
  const requestUrl = req.url ?? "/";
  if (isProxyRequest(requestUrl)) {
    if (
      proxyAuth &&
      !checkProxyAuthRaw(req.headers["proxy-authorization"], proxyAuth)
    ) {
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
    const warnings = unknownFields(body);
    const config = deps.updateConfig(sanitizeSelectionConfig(body));
    const response: Record<string, unknown> = {
      config,
      preview: deps.listRelays(config).slice(0, 10),
    };
    if (warnings.length > 0) {
      response["warnings"] = warnings.map(
        (field) => `Unknown field "${field}" ignored`,
      );
    }
    sendJson(res, 200, response);
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

export function sendJson(
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

export function checkProxyAuthRaw(
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

export function sendProxyAuthRequired(res: ServerResponse): void {
  res.writeHead(407, {
    "proxy-authenticate": 'Basic realm="relayrad"',
    "content-type": "application/json",
  });
  res.end(JSON.stringify({ error: "Proxy authentication required" }));
}

function isProxyRequest(url: string): boolean {
  return /^(http|ws):\/\//i.test(url);
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
