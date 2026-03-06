import { describe, expect, test } from "bun:test";
import { parseRelayList } from "./relay-parser";

const sampleRelayList = `Albania (al)
\tTirana (tia) @ 41.32795°N, 19.81902°W
\t\tal-tia-wg-003 (103.124.165.130, 2a04:27c0:0:c::f001) - WireGuard, hosted by iRegister (rented)
\t\tal-tia-wg-004 (103.124.165.191, 2a04:27c0:0:d::f001) - WireGuard, hosted by iRegister (rented)

Australia (au)
\tSydney (syd) @ -33.86148°N, 151.20548°W
\t\tau-syd-wg-001 (146.70.200.2, 2001:ac8:84:5::f001) - WireGuard, hosted by M247 (rented)
\t\tau-syd-wg-101 (103.136.147.3, 2a11:3:500::f001) - WireGuard, hosted by xtom (rented)
`;

describe("parseRelayList", () => {
  test("parses countries, cities, and relay entries from mullvad cli output", () => {
    const relays = parseRelayList(sampleRelayList);

    expect(relays).toHaveLength(4);
    expect(relays[0]).toEqual({
      countryName: "Albania",
      countryCode: "al",
      cityName: "Tirana",
      cityCode: "tia",
      hostname: "al-tia-wg-003",
      ipv4: "103.124.165.130",
      ipv6: "2a04:27c0:0:c::f001",
      protocol: "WireGuard",
      provider: "iRegister",
      ownership: "rented",
      socks5Hostname: "al-tia-wg-socks5-003.relays.mullvad.net",
      socks5Port: 1080,
    });

    expect(relays[3]?.hostname).toBe("au-syd-wg-101");
    expect(relays[3]?.provider).toBe("xtom");
  });

  test("ignores blank lines and preserves entry order", () => {
    const relays = parseRelayList(`\n${sampleRelayList}\n`);

    expect(relays.map((relay) => relay.hostname)).toEqual([
      "al-tia-wg-003",
      "al-tia-wg-004",
      "au-syd-wg-001",
      "au-syd-wg-101",
    ]);
  });

  test("builds Mullvad SOCKS5 relay hostnames in the documented format", () => {
    const relays = parseRelayList(sampleRelayList);

    expect(relays[0]?.socks5Hostname).toBe(
      "al-tia-wg-socks5-003.relays.mullvad.net",
    );
    expect(relays[2]?.socks5Hostname).toBe(
      "au-syd-wg-socks5-001.relays.mullvad.net",
    );
  });
});
