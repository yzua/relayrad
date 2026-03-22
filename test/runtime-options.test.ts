import { describe, expect, test } from "bun:test";
import { parseRuntimeOptions } from "../src/runtime/runtime-options";

describe("parseRuntimeOptions", () => {
  test("uses 4123 as the default port", () => {
    const options = parseRuntimeOptions({ argv: ["bun", "index.ts"], env: {} });

    expect(options.host).toBe("127.0.0.1");
    expect(options.port).toBe(4123);
    expect(options.logProxyConsole).toBe(true);
    expect(options.logProxySqlitePath).toBeUndefined();
  });

  test("disables console logging with --no-log-proxy-console", () => {
    const options = parseRuntimeOptions({
      argv: ["bun", "index.ts", "--no-log-proxy-console"],
      env: {},
    });

    expect(options.logProxyConsole).toBe(false);
  });

  test("uses RELAYRAD_PORT when present", () => {
    const options = parseRuntimeOptions({
      argv: ["bun", "index.ts"],
      env: { RELAYRAD_PORT: "4999" },
    });

    expect(options.port).toBe(4999);
  });

  test("prefers the --port flag over env", () => {
    const options = parseRuntimeOptions({
      argv: ["bun", "index.ts", "--port", "4555"],
      env: { RELAYRAD_PORT: "4999" },
    });

    expect(options.port).toBe(4555);
  });

  test("supports the short -p flag", () => {
    const options = parseRuntimeOptions({
      argv: ["bun", "index.ts", "-p", "4666"],
      env: {},
    });

    expect(options.port).toBe(4666);
  });

  test("throws when --port is provided without a value", () => {
    expect(() =>
      parseRuntimeOptions({
        argv: ["bun", "index.ts", "--port"],
        env: {},
      }),
    ).toThrow("Missing port value for --port");
  });

  test("enables console logging with --log-proxy-console", () => {
    const options = parseRuntimeOptions({
      argv: ["bun", "index.ts", "--log-proxy-console"],
      env: {},
    });

    expect(options.logProxyConsole).toBe(true);
    expect(options.logProxySqlitePath).toBeUndefined();
  });

  test("enables sqlite logging with --log-proxy-sqlite", () => {
    const options = parseRuntimeOptions({
      argv: ["bun", "index.ts", "--log-proxy-sqlite", "./relayrad.sqlite"],
      env: {},
    });

    expect(options.logProxyConsole).toBe(true);
    expect(options.logProxySqlitePath).toBe("./relayrad.sqlite");
  });

  test("supports enabling both logging flags together", () => {
    const options = parseRuntimeOptions({
      argv: [
        "bun",
        "index.ts",
        "--log-proxy-console",
        "--log-proxy-sqlite",
        "./relayrad.sqlite",
      ],
      env: {},
    });

    expect(options.logProxyConsole).toBe(true);
    expect(options.logProxySqlitePath).toBe("./relayrad.sqlite");
  });

  test("throws when --log-proxy-sqlite is provided without a value", () => {
    expect(() =>
      parseRuntimeOptions({
        argv: ["bun", "index.ts", "--log-proxy-sqlite"],
        env: {},
      }),
    ).toThrow("Missing SQLite path value for --log-proxy-sqlite");
  });
});
