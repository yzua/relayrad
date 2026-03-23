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
  torPort: number;
  noTui: boolean;
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
    torPort,
    noTui: parseFlag(argv, "--no-tui"),
  };
}

function parsePortFlag(argv: string[]): number | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value !== "--port" && value !== "-p") {
      continue;
    }

    if (argv[index + 1] === undefined) {
      throw new Error(`Missing port value for ${value}`);
    }

    return parsePortValue(argv[index + 1]);
  }

  return undefined;
}

function parseLogProxySqlitePath(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--log-proxy-sqlite") {
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error("Missing SQLite path value for --log-proxy-sqlite");
    }

    return value;
  }

  return undefined;
}

function parseLogProxyConsole(argv: string[]): boolean {
  if (argv.includes("--no-log-proxy-console")) {
    return false;
  }

  return true;
}

function parseSocks5Port(argv: string[]): number | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--socks5-port") {
      continue;
    }

    if (argv[index + 1] === undefined) {
      throw new Error("Missing port value for --socks5-port");
    }

    return parsePortValue(argv[index + 1]);
  }

  return undefined;
}

function parseProxyAuth(
  argv: string[],
): { username: string; password: string } | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--proxy-auth") {
      continue;
    }

    const value = argv[index + 1];
    if (!value) {
      throw new Error("Missing value for --proxy-auth (expected user:pass)");
    }

    return parseProxyAuthValue(value);
  }

  return undefined;
}

function parseTorPort(argv: string[]): number {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--tor-port") {
      continue;
    }

    if (argv[index + 1] === undefined) {
      throw new Error("Missing port value for --tor-port");
    }

    return parsePortValue(argv[index + 1]) ?? 9050;
  }

  return 9050;
}

function parseFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}
