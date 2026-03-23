import { describe, expect, test } from "bun:test";
import { checkTorAvailable, createTorRelay } from "../src/relay/tor-relay";

describe("createTorRelay", () => {
  test("returns a relay record with tor source and default port", () => {
    const relay = createTorRelay();

    expect(relay.source).toBe("tor");
    expect(relay.hostname).toBe("tor-relay");
    expect(relay.socks5Hostname).toBe("127.0.0.1");
    expect(relay.socks5Port).toBe(9050);
    expect(relay.countryName).toBe("Tor");
    expect(relay.countryCode).toBe("tor");
    expect(relay.provider).toBe("tor-project");
    expect(relay.socks5Username).toBeUndefined();
    expect(relay.socks5UniqueAuth).toBe(true);
    expect(relay.socks5Password).toBe("");
  });

  test("accepts custom port", () => {
    const relay = createTorRelay(9150);

    expect(relay.socks5Port).toBe(9150);
    expect(relay.socks5Hostname).toBe("127.0.0.1");
  });
});

describe("checkTorAvailable", () => {
  test("returns false when nothing is listening on the port", async () => {
    const available = await checkTorAvailable(49151);
    expect(available).toBe(false);
  });
});
