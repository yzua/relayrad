import { loadRelaysFromMullvadCli } from "./src/mullvad-cli";
import { parseRelayList } from "./src/relay-parser";
import { parseRuntimeOptions } from "./src/runtime-options";
import { createServer } from "./src/server";
import type { RelayRecord } from "./src/relay-types";

const { host, port } = parseRuntimeOptions({
  argv: process.argv,
  env: process.env,
});

async function loadRelays(): Promise<RelayRecord[]> {
  const relayListFile = process.env.RELAYRAD_RELAY_LIST_FILE;
  const socksHostOverride = process.env.RELAYRAD_SOCKS_HOST_OVERRIDE;
  const socksPortOverride = process.env.RELAYRAD_SOCKS_PORT_OVERRIDE;

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
});

await server.listen(port, host);
console.log(`relayrad listening on http://${host}:${port}`);
console.log(`loaded ${initialRelays.length} relays`);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
