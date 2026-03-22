export interface RuntimeOptions {
  host: string;
  port: number;
  logProxyConsole: boolean;
  logProxySqlitePath?: string;
}

interface ParseRuntimeOptionsInput {
  argv: string[];
  env: Record<string, string | undefined>;
}

export function parseRuntimeOptions({
  argv,
  env,
}: ParseRuntimeOptionsInput): RuntimeOptions {
  const host = env.RELAYRAD_HOST?.trim() || "127.0.0.1";
  const envPort = parsePort(env.RELAYRAD_PORT);
  const flagPort = parsePortFlag(argv);
  const logProxyConsole = parseLogProxyConsole(argv);
  const logProxySqlitePath = parseLogProxySqlitePath(argv);

  return {
    host,
    port: flagPort ?? envPort ?? 4123,
    logProxyConsole,
    logProxySqlitePath,
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

    return parsePort(argv[index + 1]);
  }

  return undefined;
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
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
