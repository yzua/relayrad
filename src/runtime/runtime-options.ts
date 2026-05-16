import { parsePortValue, parseProxyAuthValue } from "./runtime-validation";

export interface RuntimeOptions {
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
  noTui: boolean;
  relayRefreshIntervalMs: number;
}

interface ParseRuntimeOptionsInput {
  argv: string[];
  env: Record<string, string | undefined>;
}

export function parseRuntimeOptions({
  argv,
  env,
}: ParseRuntimeOptionsInput): RuntimeOptions {
  const host = env["RELAYRAD_HOST"]?.trim() || "127.0.0.1";
  const envPort = parsePortValue(env["RELAYRAD_PORT"]);
  const flagPort = parsePortFlag(argv);
  const logProxyConsole = parseLogProxyConsole(argv);
  const logProxySqlitePath = parseLogProxySqlitePath(argv);
  const torPort = parseTorPort(argv);

  return {
    host,
    port: flagPort ?? envPort ?? 4123,
    logProxyConsole,
    logProxySqlitePath,
    socks5Port: parseSocks5Port(argv),
    proxyAuth: parseProxyAuth(argv),
    useMullvad: parseFlag(argv, "--mullvad"),
    useTor: parseFlag(argv, "--tor"),
    useNordvpn: parseFlag(argv, "--nordvpn"),
    useGithubLists: parseFlag(argv, "--github-lists"),
    torPort,
    noTui: parseFlag(argv, "--no-tui"),
    relayRefreshIntervalMs: parseRelayRefreshInterval(argv, env),
  };
}

function parsePortFlag(argv: string[]): number | undefined {
  const value = extractFlagValue(argv, "Missing port value", "--port", "-p");
  if (value === undefined) return undefined;
  return parsePortValue(value);
}

function parseLogProxySqlitePath(argv: string[]): string | undefined {
  return extractFlagValue(
    argv,
    "Missing SQLite path value",
    "--log-proxy-sqlite",
  );
}

function parseLogProxyConsole(argv: string[]): boolean {
  if (argv.includes("--no-log-proxy-console")) {
    return false;
  }

  return true;
}

function parseSocks5Port(argv: string[]): number | undefined {
  const value = extractFlagValue(argv, "Missing port value", "--socks5-port");
  if (value === undefined) return undefined;
  return parsePortValue(value);
}

function parseProxyAuth(
  argv: string[],
): { username: string; password: string } | undefined {
  const value = extractFlagValue(argv, "Missing value", "--proxy-auth");
  if (value === undefined) return undefined;
  return parseProxyAuthValue(value);
}

function parseTorPort(argv: string[]): number {
  const value = extractFlagValue(argv, "Missing port value", "--tor-port");
  return value ? (parsePortValue(value) ?? 9050) : 9050;
}

function extractFlagValue(
  argv: string[],
  errorPrefix: string,
  ...flags: string[]
): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === undefined || !flags.includes(flag)) {
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${errorPrefix} for ${flag}`);
    }

    return value;
  }

  return undefined;
}

function parseFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function parseRelayRefreshInterval(
  argv: string[],
  env: Record<string, string | undefined>,
): number {
  const flagValue = extractFlagValue(
    argv,
    "Missing relay refresh interval value",
    "--relay-refresh-interval",
  );
  if (flagValue !== undefined) {
    const ms = Number(flagValue);
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`Invalid relay refresh interval: ${flagValue}`);
    }
    return ms;
  }

  const envValue = env["RELAYRAD_RELAY_REFRESH_INTERVAL"];
  if (envValue !== undefined && envValue.trim() !== "") {
    const ms = Number(envValue.trim());
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`Invalid RELAYRAD_RELAY_REFRESH_INTERVAL: ${envValue}`);
    }
    return ms;
  }

  return 3_600_000;
}
