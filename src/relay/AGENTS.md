# RELAY KNOWLEDGE BASE

**Scope:** `src/relay/` parsing, contracts, selection strategy.

## OVERVIEW
`src/relay` turns Mullvad CLI output into typed relay records and applies filtering/sorting/rotation with unhealthy backoff and country exclusion.

## OVERRIDES ROOT
- Source-of-truth input is CLI text (`mullvad relay list`), not JSON.
- Selection behavior is stateful (cursor/random cycle/unhealthy map), so ordering changes can affect runtime rotation guarantees.

## KEY FILES
| Task | File | Notes |
|------|------|-------|
| Parse CLI output | `src/relay/relay-parser.ts` | Regex line-state parser for country/city/relay rows |
| Relay selection logic | `src/relay/relay-selector.ts` | Filters, sort modes, round-robin/random cycle, unhealthy backoff |
| CLI process adapter | `src/relay/mullvad-cli.ts` | `Bun.spawn` wrapper + explicit failure messages |
| Shared relay contracts | `src/relay/relay-types.ts` | `RelayRecord`, filters, sort, selection config |

## LOCAL INVARIANTS
- Parser ignores malformed/incomplete rows; only fully populated relay entries are emitted.
- `socks5Hostname` is derived from relay hostname transformation (`-wg-` -> `-wg-socks5-`) plus Mullvad domain suffix.
- Internal `normalizeConfig` fallback: `sort: hostname`, `unhealthyBackoffMs: 30000`. Server overrides to `sort: random`.
- `excludeCountry` matches against both `countryCode` and `countryName` (case-insensitive).
- `next()` must return deterministic round-robin for non-random sorts and cycle-based random ordering for `sort=random`.

## ANTI-PATTERNS
- Do not replace regex parser with JSON assumptions.
- Do not mutate selector state without resetting cursor/random-cycle state on `update()`.
- Do not weaken CLI error messages into generic failures; explicit cause context is required.
- Do not split relay contracts across unrelated modules; keep canonical types in `relay-types.ts`.

## VALIDATION
- Run: `bun test test/relay-parser.test.ts`
- Run: `bun test test/relay-selector.test.ts`
- For CLI adapter changes, run full suite: `bun test`

## RELATED PATHS
- `index.ts` (relay loading/refresh wiring)
- `src/server/server.ts` (reads selector outputs and updates active config)
