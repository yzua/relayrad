import { describe, expect, test } from "bun:test";
import { parseRuntimeOptions } from "../src/runtime/runtime-options";

describe("parseRuntimeOptions", () => {
  test("uses 4123 as the default port", () => {
    const options = parseRuntimeOptions({ argv: ["bun", "index.ts"], env: {} });

    expect(options.host).toBe("127.0.0.1");
    expect(options.port).toBe(4123);
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
});
