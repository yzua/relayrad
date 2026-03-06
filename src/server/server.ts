import {
  createServer as createNodeServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo, Socket } from "node:net";
import {
  handleConnectTunnel,
  handleHttpProxyRequest,
  type ProxyRuntime,
} from "../proxy/http-proxy";
import { createRelaySelector } from "../relay/relay-selector";
import type { RelayRecord, RelaySelectionConfig } from "../relay/relay-types";
import { defaultSelectionConfig } from "./config";
import {
  readJsonBody,
  sanitizeSelectionConfig,
  selectionConfigFromUrl,
} from "./selection-config";

export interface ProxyServerDeps {
  initialRelays: RelayRecord[];
  refreshRelays: () => Promise<RelayRecord[]>;
}

export interface ProxyServer {
  listen(port: number, hostname?: string): Promise<void>;
  close(): Promise<void>;
  address(): AddressInfo | string | null;
}

export function createServer(deps: ProxyServerDeps): ProxyServer {
  let relays = [...deps.initialRelays];
  const selector = createRelaySelector(relays, defaultSelectionConfig);

  const runtime: ProxyRuntime = {
    pickRelay: () => selector.next(),
    markRelayUnhealthy: (hostname: string) => selector.markUnhealthy(hostname),
  };

  const routeDeps: RouteDeps = {
    listRelays: (filters) => createRelaySelector(relays, filters).list(),
    updateConfig: (nextConfig) => {
      selector.update(relays, nextConfig);
      return selector.getConfig();
    },
    refresh: async () => {
      relays = await deps.refreshRelays();
      selector.update(relays);
      return relays;
    },
  };

  const server = createNodeServer(async (req, res) => {
    try {
      await routeRequest(req, res, runtime, routeDeps);
    } catch (error) {
      sendJson(res, 500, {
        error:
          error instanceof Error ? error.message : "Unexpected server error",
      });
    }
  });

  server.on("connect", (req, clientSocket, head) => {
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
}

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: ProxyRuntime,
  deps: RouteDeps,
): Promise<void> {
  const requestUrl = req.url ?? "/";
  if (isProxyRequest(requestUrl)) {
    await handleHttpProxyRequest(req, res, runtime);
    return;
  }

  const url = new URL(requestUrl, `http://${req.headers.host ?? "127.0.0.1"}`);

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

  sendJson(res, 404, { error: "Not found" });
}

function isProxyRequest(url: string): boolean {
  return /^http:\/\//i.test(url);
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
