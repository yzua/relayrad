import { createProxyRequestLogger } from "./src/logging/proxy-request-logger";
import type { ProxyRuntime } from "./src/proxy/http-proxy";
import { createSocks5Server } from "./src/proxy/socks5-server";
import { createRelaySelector } from "./src/relay/relay-selector";
import type { RelayRecord } from "./src/relay/relay-types";
import { parseRuntimeOptions } from "./src/runtime/runtime-options";
import {
  formatLoadedSources,
  loadRelaySources,
  resolveStartupConfig,
} from "./src/runtime/startup";
import { createServer } from "./src/server/server";
import { createStatsTracker } from "./src/stats";
import { runTui, shouldShowTui, type TuiConfig } from "./src/tui/tui";

const rawOptions = parseRuntimeOptions({
  argv: process.argv,
  env: process.env,
});

let tuiConfig: TuiConfig | undefined;

if (shouldShowTui(process.argv)) {
  tuiConfig = await runTui();
}

const startupConfig = resolveStartupConfig(rawOptions, {
  port: tuiConfig?.port,
  logProxyConsole: tuiConfig?.logProxyConsole,
  logProxySqlitePath: tuiConfig?.logProxySqlitePath,
  socks5Port: tuiConfig?.socks5Port,
  proxyAuth: tuiConfig?.proxyAuth,
  useMullvad: tuiConfig?.sources.includes("mullvad"),
  useTor: tuiConfig?.sources.includes("tor"),
});

const requestLogger = createProxyRequestLogger({
  logProxyConsole: startupConfig.logProxyConsole,
  logProxySqlitePath: startupConfig.logProxySqlitePath,
});

const statsTracker = createStatsTracker();

let initialRelays: RelayRecord[];
try {
  initialRelays = await loadRelaySources(startupConfig, process.env);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`relayrad: ${message}`);
  process.exit(1);
}

if (initialRelays.length === 0) {
  console.error("relayrad: loaded 0 relays from all sources");
  process.exit(1);
}

const server = createServer({
  initialRelays,
  refreshRelays: () => loadRelaySources(startupConfig, process.env),
  requestLogger,
  statsTracker,
  proxyAuth: startupConfig.proxyAuth,
});

await server.listen(startupConfig.port, startupConfig.host);

console.log(
  `relayrad listening on http://${startupConfig.host}:${startupConfig.port}`,
);
console.log(
  `loaded ${initialRelays.length} relay endpoint${initialRelays.length === 1 ? "" : "s"} from ${formatLoadedSources(initialRelays)}`,
);

let socks5: ReturnType<typeof createSocks5Server> | undefined;
if (startupConfig.socks5Port) {
  const selector = createRelaySelector(initialRelays, {
    sort: "random",
    unhealthyBackoffMs: 30_000,
  });

  const socks5Runtime: ProxyRuntime = {
    pickRelay: () => selector.next(),
    markRelayUnhealthy: (hostname: string) => selector.markUnhealthy(hostname),
    requestLogger,
    statsTracker,
  };

  socks5 = createSocks5Server(socks5Runtime);
  await socks5.listen(startupConfig.socks5Port, startupConfig.host);
  console.log(
    `relayrad SOCKS5 listening on socks5://${startupConfig.host}:${startupConfig.socks5Port}`,
  );
}

const SHUTDOWN_TIMEOUT_MS = 10_000;
let shutdownPromise: Promise<void> | undefined;

function shutdown(): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    console.log("relayrad shutting down...");

    const timeout = setTimeout(() => {
      console.error(
        `relayrad shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`,
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      requestLogger.close();

      if (socks5) {
        await socks5.close();
      }

      await server.close();
      console.log("relayrad shut down cleanly");
    } catch (error) {
      console.error("relayrad shutdown error:", error);
    } finally {
      clearTimeout(timeout);
      process.exit(0);
    }
  })();

  return shutdownPromise;
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
