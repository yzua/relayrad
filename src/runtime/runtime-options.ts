export interface RuntimeOptions {
  host: string;
  port: number;
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

  return {
    host,
    port: flagPort ?? envPort ?? 4123,
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
