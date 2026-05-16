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

interface RelaySourceDescriptor {
  label: string;
  load(): Promise<RelayRecord[]>;
  fixHints: string[];
  formatSummary(count: number): string;
}

const SOURCE_FORMATTERS: Record<string, (count: number) => string> = {
  mullvad: (n) => `mullvad(${n} relays)`,
  tor: (n) => `tor(${n} local endpoint${n === 1 ? "" : "s"}, dynamic circuits)`,
  nordvpn: (n) => `nordvpn(${n} servers)`,
  "github-lists": (n) => `github-lists(${n} proxies)`,
};

function createMullvadDescriptor(
  env: Record<string, string | undefined>,
): RelaySourceDescriptor {
  return {
    label: "Mullvad",
    async load() {
      return loadMullvadRelays(env);
    },
    fixHints: ["Check network connectivity to api.mullvad.net"],
    formatSummary: SOURCE_FORMATTERS["mullvad"]!,
  };
}

function createTorDescriptor(port: number): RelaySourceDescriptor {
  return {
    label: "TOR",
    async load() {
      const available = await checkTorAvailable(port);
      if (!available) {
        throw new Error(
          `not available on 127.0.0.1:${port} — start Tor and try again`,
        );
      }
      return [createTorRelay(port)];
    },
    fixHints: [
      "Install Tor: sudo apt install tor",
      "Start Tor service: sudo systemctl start tor",
    ],
    formatSummary: SOURCE_FORMATTERS["tor"]!,
  };
}

function createNordvpnDescriptor(
  env: Record<string, string | undefined>,
): RelaySourceDescriptor {
  return {
    label: "NordVPN",
    async load() {
      const result = await loadNordvpnRelays(env);
      for (const warning of result.warnings) {
        console.warn(`relayrad: warning: ${warning}`);
      }
      return result.relays;
    },
    fixHints: [
      "Check network connectivity to api.nordvpn.com",
      "Or override the API URL: NORDVPN_API_URL=https://custom-endpoint bun run start",
    ],
    formatSummary: SOURCE_FORMATTERS["nordvpn"]!,
  };
}

function createGithubListsDescriptor(): RelaySourceDescriptor {
  return {
    label: "GitHub Lists",
    async load() {
      const result = await loadGithubListRelays();
      for (const warning of result.warnings) {
        console.warn(`relayrad: warning: ${warning}`);
      }
      return result.relays;
    },
    fixHints: ["Check network connectivity to raw.githubusercontent.com"],
    formatSummary: SOURCE_FORMATTERS["github-lists"]!,
  };
}

function resolveActiveDescriptors(
  config: Pick<
    StartupConfig,
    "useMullvad" | "useTor" | "useNordvpn" | "useGithubLists" | "torPort"
  >,
  env: Record<string, string | undefined>,
): RelaySourceDescriptor[] {
  const descriptors: RelaySourceDescriptor[] = [];
  if (config.useMullvad) descriptors.push(createMullvadDescriptor(env));
  if (config.useTor) descriptors.push(createTorDescriptor(config.torPort));
  if (config.useNordvpn) descriptors.push(createNordvpnDescriptor(env));
  if (config.useGithubLists) descriptors.push(createGithubListsDescriptor());
  return descriptors;
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
  descriptor: RelaySourceDescriptor,
  relays: RelayRecord[],
  errors: string[],
): Promise<void> {
  try {
    relays.push(...(await descriptor.load()));
  } catch (error) {
    errors.push(
      `${descriptor.label}: ${error instanceof Error ? error.message : String(error)}`,
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
  const descriptors = resolveActiveDescriptors(config, env);
  const relays: RelayRecord[] = [];
  const errors: string[] = [];

  for (const descriptor of descriptors) {
    await tryLoadSource(descriptor, relays, errors);
  }

  if (errors.length > 0) {
    reportSourceErrors(errors, relays.length === 0, descriptors);
    if (relays.length === 0) {
      throw new Error("All relay sources failed");
    }
  }

  return relays;
}

export function formatLoadedSources(relays: RelayRecord[]): string {
  const counts = new Map<string, number>();
  for (const relay of relays) {
    counts.set(relay.source, (counts.get(relay.source) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([source, count]) => {
      const formatter = SOURCE_FORMATTERS[source];
      return formatter ? formatter(count) : `${source}(${count})`;
    })
    .join(", ");
}

function reportSourceErrors(
  errors: string[],
  fatal: boolean,
  descriptors: RelaySourceDescriptor[],
): void {
  for (const err of errors) {
    console.error(`relayrad: failed to load ${err}`);
  }

  if (!fatal) {
    console.error("Continuing with available sources...");
    return;
  }

  for (const descriptor of descriptors) {
    console.error("");
    console.error(`To fix ${descriptor.label}:`);
    for (const hint of descriptor.fixHints) {
      console.error(`  - ${hint}`);
    }
  }
}
