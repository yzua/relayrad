import { loadRelaysFromMullvadCli } from "../relay/mullvad-cli";
import { parseRelayList } from "../relay/relay-parser";
import type { RelayRecord } from "../relay/relay-types";
import { checkTorAvailable, createTorRelay } from "../relay/tor-relay";
import type { RuntimeOptions } from "./runtime-options";

export interface StartupOverrides {
  port?: number | undefined;
  logProxyConsole?: boolean | undefined;
  logProxySqlitePath?: string | undefined;
  socks5Port?: number | undefined;
  proxyAuth?: { username: string; password: string } | undefined;
  useMullvad?: boolean | undefined;
  useTor?: boolean | undefined;
}

export interface StartupConfig {
  host: string;
  port: number;
  logProxyConsole: boolean;
  logProxySqlitePath?: string | undefined;
  socks5Port?: number | undefined;
  proxyAuth?: { username: string; password: string } | undefined;
  useMullvad: boolean;
  useTor: boolean;
  torPort: number;
}

export function resolveStartupConfig(
  options: RuntimeOptions,
  overrides?: StartupOverrides,
): StartupConfig {
  const useTor = overrides?.useTor ?? options.useTor;

  return {
    host: options.host,
    port: overrides?.port ?? options.port,
    logProxyConsole: overrides?.logProxyConsole ?? options.logProxyConsole,
    logProxySqlitePath:
      overrides?.logProxySqlitePath ?? options.logProxySqlitePath,
    socks5Port: overrides?.socks5Port ?? options.socks5Port,
    proxyAuth: overrides?.proxyAuth ?? options.proxyAuth,
    useMullvad: overrides?.useMullvad ?? (options.useMullvad || !useTor),
    useTor,
    torPort: options.torPort,
  };
}

export async function loadMullvadRelays(
  env: Record<string, string | undefined>,
): Promise<RelayRecord[]> {
  const relayListFile = env["RELAYRAD_RELAY_LIST_FILE"];
  const socksHostOverride = env["RELAYRAD_SOCKS_HOST_OVERRIDE"];
  const socksPortOverride = env["RELAYRAD_SOCKS_PORT_OVERRIDE"];

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

export async function loadRelaySources(
  config: Pick<StartupConfig, "useMullvad" | "useTor" | "torPort">,
  env: Record<string, string | undefined>,
): Promise<RelayRecord[]> {
  const relays: RelayRecord[] = [];
  const errors: string[] = [];

  if (config.useMullvad) {
    try {
      relays.push(...(await loadMullvadRelays(env)));
    } catch (error) {
      errors.push(
        `Mullvad: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.useTor) {
    const available = await checkTorAvailable(config.torPort);
    if (!available) {
      errors.push(
        `TOR: not available on 127.0.0.1:${config.torPort} — start Tor and try again`,
      );
    } else {
      relays.push(createTorRelay(config.torPort));
    }
  }

  if (errors.length > 0) {
    reportSourceErrors(
      errors,
      relays.length === 0,
      config.useMullvad,
      config.useTor,
      env,
    );
    if (relays.length === 0) {
      process.exit(1);
    }
  }

  return relays;
}

export function formatLoadedSources(relays: RelayRecord[]): string {
  const sourceLabels: string[] = [];
  const mullvadCount = relays.filter(
    (relay) => relay.source === "mullvad",
  ).length;
  const torCount = relays.filter((relay) => relay.source === "tor").length;

  if (mullvadCount > 0) {
    sourceLabels.push(`mullvad(${mullvadCount} relays)`);
  }

  if (torCount > 0) {
    sourceLabels.push(
      `tor(${torCount} local endpoint${torCount === 1 ? "" : "s"}, dynamic circuits)`,
    );
  }

  return sourceLabels.join(", ");
}

function reportSourceErrors(
  errors: string[],
  fatal: boolean,
  useMullvad: boolean,
  useTor: boolean,
  env: Record<string, string | undefined>,
): void {
  for (const err of errors) {
    console.error(`relayrad: failed to load ${err}`);
  }

  if (!fatal) {
    console.error("Continuing with available sources...");
    return;
  }

  if (useMullvad && !env["RELAYRAD_RELAY_LIST_FILE"]) {
    console.error("");
    console.error("To fix Mullvad:");
    console.error(
      "  - Install Mullvad CLI: https://mullvad.net/download/vpn/linux",
    );
    console.error("  - Or provide a relay list file:");
    console.error("      RELAYRAD_RELAY_LIST_FILE=relays.txt bun run start");
  }

  if (useTor) {
    console.error("");
    console.error("To fix TOR:");
    console.error("  - Install Tor: sudo apt install tor");
    console.error("  - Start Tor service: sudo systemctl start tor");
  }
}
