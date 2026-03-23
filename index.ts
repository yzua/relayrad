import { createProxyRequestLogger } from "./src/logging/proxy-request-logger";
import type { ProxyRuntime } from "./src/proxy/http-proxy";
import { createSocks5Server } from "./src/proxy/socks5-server";
import { loadRelaysFromMullvadCli } from "./src/relay/mullvad-cli";
import { parseRelayList } from "./src/relay/relay-parser";
import { createRelaySelector } from "./src/relay/relay-selector";
import type { RelayRecord } from "./src/relay/relay-types";
import { parseRuntimeOptions } from "./src/runtime/runtime-options";
import { createServer } from "./src/server/server";
import { createStatsTracker } from "./src/stats";

const {
  host,
  port,
  logProxyConsole,
  logProxySqlitePath,
  socks5Port,
  proxyAuth,
} = parseRuntimeOptions({
  argv: process.argv,
  env: process.env,
});

const requestLogger = createProxyRequestLogger({
  logProxyConsole,
  logProxySqlitePath,
});

const statsTracker = createStatsTracker();

async function loadRelays(): Promise<RelayRecord[]> {
  const relayListFile = process.env["RELAYRAD_RELAY_LIST_FILE"];
  const socksHostOverride = process.env["RELAYRAD_SOCKS_HOST_OVERRIDE"];
  const socksPortOverride = process.env["RELAYRAD_SOCKS_PORT_OVERRIDE"];

  const relays = relayListFile
    ? parseRelayList(await Bun.file(relayListFile).text())
    : await loadRelaysFromMullvadCli();

  return relays.map((relay) => ({
    ...relay,
    socks5Hostname: socksHostOverride || relay.socks5Hostname,
    socks5Port: socksPortOverride
      ? Number(socksPortOverride)
      : relay.socks5Port,
  }));
}

const initialRelays = await loadRelays();
if (initialRelays.length === 0) {
  throw new Error("No Mullvad relays were loaded from the configured source");
}

const server = createServer({
  initialRelays,
  refreshRelays: loadRelays,
  requestLogger,
  statsTracker,
  proxyAuth,
});

await server.listen(port, host);
console.log(`relayrad listening on http://${host}:${port}`);
console.log(`loaded ${initialRelays.length} relays`);

let socks5: ReturnType<typeof createSocks5Server> | undefined;
if (socks5Port) {
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
  await socks5.listen(socks5Port, host);
  console.log(`relayrad SOCKS5 listening on socks5://${host}:${socks5Port}`);
}

const shutdown = async () => {
  requestLogger.close();
  if (socks5) {
    await socks5.close();
  }
  await server.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
