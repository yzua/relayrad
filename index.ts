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

  let relays: RelayRecord[];

  if (relayListFile) {
    const file = Bun.file(relayListFile);
    if (!(await file.exists())) {
      throw new Error(`file not found: ${relayListFile}`);
    }
    const text = await file.text();
    if (text.trim().length === 0) {
      throw new Error(`file is empty: ${relayListFile}`);
    }
    relays = parseRelayList(text);
  } else {
    relays = await loadRelaysFromMullvadCli();
  }

  return relays.map((relay) => ({
    ...relay,
    socks5Hostname: socksHostOverride || relay.socks5Hostname,
    socks5Port: socksPortOverride
      ? Number(socksPortOverride)
      : relay.socks5Port,
  }));
}

let initialRelays: RelayRecord[];
try {
  initialRelays = await loadRelays();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const source = process.env["RELAYRAD_RELAY_LIST_FILE"]
    ? `file ${process.env["RELAYRAD_RELAY_LIST_FILE"]}`
    : "mullvad CLI";

  console.error(`relayrad: failed to load relays from ${source}`);
  console.error(`  ${message}`);

  if (!process.env["RELAYRAD_RELAY_LIST_FILE"]) {
    console.error("");
    console.error("To fix:");
    console.error(
      "  - Install Mullvad CLI: https://mullvad.net/download/vpn/linux",
    );
    console.error("  - Or provide a relay list file:");
    console.error("      RELAYRAD_RELAY_LIST_FILE=relays.txt bun run start");
    console.error(
      "  - Relay list format: run `mullvad relay list > relays.txt` on a machine with Mullvad CLI",
    );
  }

  process.exit(1);
}

if (initialRelays.length === 0) {
  const source = process.env["RELAYRAD_RELAY_LIST_FILE"]
    ? `file ${process.env["RELAYRAD_RELAY_LIST_FILE"]}`
    : "mullvad CLI output";

  console.error(`relayrad: loaded 0 relays from ${source}`);
  console.error(
    "  The relay source is empty or contains no parseable entries.",
  );
  process.exit(1);
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
