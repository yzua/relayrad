import { loadGithubListRelays } from "../relay/github-lists/github-lists";
import { loadRelaysFromMullvadApi } from "../relay/mullvad/mullvad-api";
import { loadNordvpnRelays } from "../relay/nordvpn/nordvpn";
import type { RelayRecord } from "../relay/relay-types";
import { checkTorAvailable, createTorRelay } from "../relay/tor/tor-relay";
import type { RuntimeOptions } from "./runtime-options";

export interface StartupOverrides {
  port?: number | undefined;
  logProxyConsole?: boolean | undefined;
  logProxySqlitePath?: string | undefined;
  socks5Port?: number | undefined;
  proxyAuth?: { username: string; password: string } | undefined;
  useMullvad?: boolean | undefined;
  useTor?: boolean | undefined;
  useNordvpn?: boolean | undefined;
  useGithubLists?: boolean | undefined;
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
  useNordvpn: boolean;
  useGithubLists: boolean;
  torPort: number;
  relayRefreshIntervalMs: number;
}

export function resolveStartupConfig(
  options: RuntimeOptions,
  overrides?: StartupOverrides,
): StartupConfig {
  const useTor = overrides?.useTor ?? options.useTor;
  const useNordvpn = overrides?.useNordvpn ?? options.useNordvpn;
  const useGithubLists = overrides?.useGithubLists ?? options.useGithubLists;
  const anySourceExplicit =
    (overrides?.useMullvad ?? options.useMullvad) ||
    useTor ||
    useNordvpn ||
    useGithubLists;

  return {
    host: options.host,
    port: overrides?.port ?? options.port,
    logProxyConsole: overrides?.logProxyConsole ?? options.logProxyConsole,
    logProxySqlitePath:
      overrides?.logProxySqlitePath ?? options.logProxySqlitePath,
    socks5Port: overrides?.socks5Port ?? options.socks5Port,
    proxyAuth: overrides?.proxyAuth ?? options.proxyAuth,
    useMullvad:
      overrides?.useMullvad ?? (anySourceExplicit ? options.useMullvad : true),
    useTor,
    useNordvpn,
    useGithubLists,
    torPort: options.torPort,
    relayRefreshIntervalMs: options.relayRefreshIntervalMs,
  };
}

export async function loadMullvadRelays(
  env: Record<string, string | undefined>,
): Promise<RelayRecord[]> {
  const socksHostOverride = env["RELAYRAD_SOCKS_HOST_OVERRIDE"];
  const socksPortOverride = env["RELAYRAD_SOCKS_PORT_OVERRIDE"];

  const relays = await loadRelaysFromMullvadApi();

  return relays.map((relay) => ({
    ...relay,
    socks5Hostname: socksHostOverride || relay.socks5Hostname,
    socks5Port: socksPortOverride
      ? Number(socksPortOverride)
      : relay.socks5Port,
  }));
}

async function tryLoadSource(
  label: string,
  loader: () => Promise<RelayRecord[]>,
  relays: RelayRecord[],
  errors: string[],
): Promise<void> {
  try {
    relays.push(...(await loader()));
  } catch (error) {
    errors.push(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function loadRelaySources(
  config: Pick<
    StartupConfig,
    "useMullvad" | "useTor" | "useNordvpn" | "useGithubLists" | "torPort"
  >,
  env: Record<string, string | undefined>,
): Promise<RelayRecord[]> {
  const relays: RelayRecord[] = [];
  const errors: string[] = [];

  if (config.useMullvad) {
    await tryLoadSource(
      "Mullvad",
      () => loadMullvadRelays(env),
      relays,
      errors,
    );
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

  if (config.useNordvpn) {
    await tryLoadSource(
      "NordVPN",
      async () => {
        const result = await loadNordvpnRelays(env);
        for (const warning of result.warnings) {
          console.warn(`relayrad: warning: ${warning}`);
        }
        return result.relays;
      },
      relays,
      errors,
    );
  }

  if (config.useGithubLists) {
    await tryLoadSource(
      "GitHub Lists",
      async () => {
        const result = await loadGithubListRelays();
        for (const warning of result.warnings) {
          console.warn(`relayrad: warning: ${warning}`);
        }
        return result.relays;
      },
      relays,
      errors,
    );
  }

  if (errors.length > 0) {
    reportSourceErrors(
      errors,
      relays.length === 0,
      config.useMullvad,
      config.useTor,
      config.useNordvpn,
      config.useGithubLists,
    );
    if (relays.length === 0) {
      throw new Error("All relay sources failed");
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
  const nordvpnCount = relays.filter(
    (relay) => relay.source === "nordvpn",
  ).length;
  const githubListsCount = relays.filter(
    (relay) => relay.source === "github-lists",
  ).length;

  if (mullvadCount > 0) {
    sourceLabels.push(`mullvad(${mullvadCount} relays)`);
  }

  if (torCount > 0) {
    sourceLabels.push(
      `tor(${torCount} local endpoint${torCount === 1 ? "" : "s"}, dynamic circuits)`,
    );
  }

  if (nordvpnCount > 0) {
    sourceLabels.push(`nordvpn(${nordvpnCount} servers)`);
  }

  if (githubListsCount > 0) {
    sourceLabels.push(`github-lists(${githubListsCount} proxies)`);
  }

  return sourceLabels.join(", ");
}

function reportSourceErrors(
  errors: string[],
  fatal: boolean,
  useMullvad: boolean,
  useTor: boolean,
  useNordvpn: boolean,
  useGithubLists: boolean,
): void {
  for (const err of errors) {
    console.error(`relayrad: failed to load ${err}`);
  }

  if (!fatal) {
    console.error("Continuing with available sources...");
    return;
  }

  if (useMullvad) {
    console.error("");
    console.error("To fix Mullvad:");
    console.error("  - Check network connectivity to api.mullvad.net");
  }

  if (useTor) {
    console.error("");
    console.error("To fix TOR:");
    console.error("  - Install Tor: sudo apt install tor");
    console.error("  - Start Tor service: sudo systemctl start tor");
  }

  if (useNordvpn) {
    console.error("");
    console.error("To fix NordVPN:");
    console.error("  - Check network connectivity to api.nordvpn.com");
    console.error("  - Or override the API URL:");
    console.error(
      "      NORDVPN_API_URL=https://custom-endpoint bun run start",
    );
  }

  if (useGithubLists) {
    console.error("");
    console.error("To fix GitHub Lists:");
    console.error(
      "  - Check network connectivity to raw.githubusercontent.com",
    );
  }
}
