# RELAY KNOWLEDGE BASE

**Scope:** `src/relay/` parsing, contracts, selection strategy.

## OVERVIEW

`src/relay` aggregates relay nodes from multiple sources (Mullvad API, NordVPN API, TOR) into typed relay records and applies filtering/sorting/rotation with unhealthy backoff and country exclusion.

## OVERRIDES ROOT

- All relay sources use JSON API payloads, not CLI text parsing.
- Selection behavior is stateful (cursor/random cycle/unhealthy map), so ordering changes can affect runtime rotation guarantees.

## KEY FILES

| Task                             | File                                     | Notes                                                                                        |
| -------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Relay selection logic            | `src/relay/relay-selector.ts`            | Filters, sort modes, round-robin/random cycle, unhealthy backoff                             |
| Mullvad API loader               | `src/relay/mullvad/mullvad-api.ts`       | Fetches from `api.mullvad.net`, maps to `RelayRecord`                                        |
| NordVPN API loader               | `src/relay/nordvpn/nordvpn.ts`           | Fetches from `api.nordvpn.com`, HTTP proxy on port 89                                        |
| TOR relay source                 | `src/relay/tor/tor-relay.ts`             | `createTorRelay()`, `checkTorAvailable()` TCP probe to SOCKS5 port                           |
| GitHub Lists loader              | `src/relay/github-lists/github-lists.ts` | Fetches SOCKS5/SOCKS4/HTTP lists from GitHub, maps to `RelayRecord`                          |
| Shared relay contracts           | `src/relay/relay-types.ts`               | `RelayRecord`, `RelaySource`, filters, sort, selection config                                |
| Relay matching and normalization | `src/relay/relay-utils.ts`               | `normalizeConfig`, `normalizeRelay`, `matches`, `sortRelays`, `isUnhealthy`, `shuffleValues` |

## LOCAL INVARIANTS

- Internal `normalizeConfig` fallback: `sort: hostname`, `unhealthyBackoffMs: 30000`. Server overrides to `sort: random`.
- `excludeCountry` matches against both `countryCode` and `countryName` (case-insensitive).
- `next()` must return deterministic round-robin for non-random sorts and cycle-based random ordering for `sort=random`.
- TOR relay is a single synthetic record (`source: "tor"`, `hostname: "tor-relay"`). TOR handles its own circuit rotation internally.
- Relay protocol distinguishes transport: `protocol: "socks5"` (Mullvad, TOR) vs `protocol: "http"` (NordVPN) vs `protocol: "http-plain"` (GitHub Lists HTTP entries).
- Adding a new relay source: create `src/relay/<source>/` directory + module, add `RelaySource` variant to `relay-types.ts`, wire in `startup.ts`.

## ANTI-PATTERNS

- Do not mutate selector state without resetting cursor/random-cycle state on `update()`.
- Do not weaken API error messages into generic failures; explicit cause context is required.
- Do not split relay contracts across unrelated modules; keep canonical types in `relay-types.ts`.

## VALIDATION

- Run: `bun test test/relay-selector.test.ts`
- Run: `bun test test/tor-relay.test.ts`
- For loader changes, run full suite: `bun test`

## RELATED PATHS

- `index.ts` (relay loading/refresh wiring)
- `src/server/server.ts` (reads selector outputs and updates active config)
- `src/runtime/startup.ts` (source loading orchestration)
