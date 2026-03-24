import { checkbox, confirm, input } from "@inquirer/prompts";
import { checkTorAvailable } from "../relay/tor/tor-relay";
import {
  parsePortValue,
  parseProxyAuthValue,
  validatePortInput,
  validateProxyAuthInput,
} from "../runtime/runtime-validation";

export interface TuiConfig {
  sources: string[];
  logProxyConsole: boolean;
  logProxySqlitePath?: string | undefined;
  port: number;
  socks5Port?: number | undefined;
  proxyAuth?: { username: string; password: string } | undefined;
}

export async function runTui(): Promise<TuiConfig> {
  console.log("");
  console.log("  relayrad setup");
  console.log("");

  const torAvailable = await checkTorAvailable();

  const sourceChoices = [
    { name: "Mullvad", value: "mullvad", checked: true },
    {
      name: torAvailable ? "TOR" : "TOR (not running — install tor first)",
      value: "tor",
      checked: false,
      disabled: torAvailable ? false : "TOR not detected",
    },
    { name: "NordVPN", value: "nordvpn", checked: false },
  ];

  const sources = await checkbox({
    message: "Select relay sources:",
    choices: sourceChoices,
  });

  if (sources.length === 0) {
    console.error("Error: select at least one relay source");
    process.exit(1);
  }

  const enableConsoleLog = await confirm({
    message: "Enable console proxy logging?",
    default: true,
  });

  let logProxySqlitePath: string | undefined;
  const enableSqliteLog = await confirm({
    message: "Enable SQLite proxy logging?",
    default: false,
  });

  if (enableSqliteLog) {
    logProxySqlitePath = await input({
      message: "SQLite file path:",
      default: "./relayrad-logs.sqlite",
    });
  }

  const portStr = await input({
    message: "HTTP proxy port:",
    default: "4123",
    validate: validatePortInput,
  });

  let socks5Port: number | undefined;
  const enableSocks5 = await confirm({
    message: "Enable SOCKS5 server?",
    default: false,
  });

  if (enableSocks5) {
    const socks5PortStr = await input({
      message: "SOCKS5 port:",
      default: "1080",
      validate: validatePortInput,
    });
    socks5Port = parsePortValue(socks5PortStr);
  }

  let proxyAuth: { username: string; password: string } | undefined;
  const enableAuth = await confirm({
    message: "Require proxy authentication?",
    default: false,
  });

  if (enableAuth) {
    const authStr = await input({
      message: "Credentials (user:pass):",
      validate: validateProxyAuthInput,
    });
    proxyAuth = parseProxyAuthValue(authStr);
  }

  console.log("");

  return {
    sources,
    logProxyConsole: enableConsoleLog,
    logProxySqlitePath,
    port: parsePortValue(portStr) ?? 4123,
    socks5Port,
    proxyAuth,
  };
}

export function shouldShowTui(argv: string[]): boolean {
  if (argv.includes("--no-tui")) {
    return false;
  }

  const sourceFlags = ["--mullvad", "--tor", "--nordvpn"];
  if (sourceFlags.some((flag) => argv.includes(flag))) {
    return false;
  }

  const configFlags = [
    "--port",
    "-p",
    "--socks5-port",
    "--proxy-auth",
    "--log-proxy-sqlite",
  ];
  if (configFlags.some((flag) => argv.includes(flag))) {
    return false;
  }

  return process.stdin.isTTY === true;
}
