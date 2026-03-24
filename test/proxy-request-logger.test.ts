import { describe, expect, test } from "bun:test";
import {
  createNoopProxyRequestLogger,
  createProxyRequestLogger,
  createSqliteProxyRequestLoggerFromStatement,
  type ProxyRequestLogEvent,
} from "../src/logging/proxy-request-logger";

const sampleEvent: ProxyRequestLogEvent = {
  timestamp: "2026-03-22T12:34:56.789Z",
  requestType: "http",
  destinationHost: "example.com",
  destinationPort: 80,
  relayHostname: "us-nyc-wg-101",
  relaySource: "mullvad",
};

describe("proxy request logger", () => {
  test("returns a noop logger when both logging flags are disabled", () => {
    const logger = createProxyRequestLogger({
      logProxyConsole: false,
    });

    expect(() => logger.log(sampleEvent)).not.toThrow();
    expect(() => logger.close()).not.toThrow();
  });

  test("swallows sqlite insert failures and warns to stderr", () => {
    const errors: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };

    try {
      const logger = createSqliteProxyRequestLoggerFromStatement({
        run() {
          throw new Error("insert failed");
        },
      });

      expect(() => logger.log(sampleEvent)).not.toThrow();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Failed to write sqlite log");
      expect(errors[0]).toContain("insert failed");
    } finally {
      console.error = originalConsoleError;
    }
  });

  test("noop logger remains safe to close repeatedly", () => {
    const logger = createNoopProxyRequestLogger();

    expect(() => logger.close()).not.toThrow();
    expect(() => logger.close()).not.toThrow();
  });

  test("creates a console logger when console logging is enabled", () => {
    const messages: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      messages.push(args.join(" "));
    };

    try {
      const logger = createProxyRequestLogger({
        logProxyConsole: true,
      });

      logger.log(sampleEvent);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("[proxy-log]");
      expect(messages[0]).toContain("type=http");
    } finally {
      console.log = originalConsoleLog;
    }
  });
});
