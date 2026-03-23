# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-23 01:30 (+03)
**Updated:** 2026-03-23 — multi-source relay support + TUI
**Commit:** 72fa473 (stale — features added since, uncommitted)
**Branch:** main

## OVERVIEW
`relayrad` is a Bun + TypeScript local rotating multi-source HTTP proxy. Routes traffic through Mullvad VPN relays, TOR, or both. Supports HTTP proxy, CONNECT tunnels, and SOCKS5 server mode. Interactive TUI on `bun run start` for source/options selection. Runtime starts in `index.ts`, with domain logic in `src/` and verification in `test/`.

## STRUCTURE
```text
mullvader/
|- index.ts                 # TUI gate + multi-source relay loading + server boot
|- src/
|  |- AGENTS.md
|  |- tui/
|  |  `- tui.ts             # Interactive TUI using @inquirer/prompts
|  |- proxy/
|  |  |- AGENTS.md
|  |  |- http-proxy.ts
|  |  |- socks5.ts
|  |  |- socks5-server.ts   # SOCKS5 server listener
|  |  `- relay-retry.ts     # Retry across relays on failure
|  |- relay/
|  |  |- AGENTS.md
|  |  |- relay-types.ts     # RelayRecord, RelaySource, filters
|  |  |- relay-parser.ts    # Mullvad CLI text parser
|  |  |- relay-selector.ts  # Rotation/filter/backoff state machine
|  |  |- mullvad-cli.ts     # Mullvad CLI process adapter
|  |  `- tor-relay.ts       # TOR relay source + availability check
|  |- runtime/
|  |  `- runtime-options.ts # CLI flags + env parsing
|  |- server/
|  |- logging/              # proxy request logging (console + SQLite)
|  `- stats.ts              # per-relay request/failure tracking
|- test/                # bun:test coverage + fixtures
|- README.md
|- package.json
|- tsconfig.json
`- biome.json
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Boot + shutdown + TUI gate | `index.ts` | TUI check, multi-source loading, server boot, SIGINT/SIGTERM |
| Interactive TUI | `src/tui/tui.ts` | @inquirer/prompts: source select, logging, ports, auth |
| Route handling + API surface | `src/server/server.ts` | `/relays`, `/rotate`, `/relays/refresh`, `/health`, `/stats` |
| HTTP proxy + CONNECT tunnel | `src/proxy/http-proxy.ts` | Retry flow, upstream header parsing, relay fallback, stats recording |
| SOCKS5 client handshake | `src/proxy/socks5.ts` | Connect framing + socket prewarm cache |
| SOCKS5 server listener | `src/proxy/socks5-server.ts` | Accepts SOCKS5 clients, routes through relays |
| Relay parse + selection strategy | `src/relay/*.ts` | CLI text parser + filter/sort/backoff/cursor + excludeCountry |
| TOR relay source | `src/relay/tor-relay.ts` | `createTorRelay()`, `checkTorAvailable()` TCP probe |
| Relay source contracts | `src/relay/relay-types.ts` | `RelaySource = "mullvad" | "tor"`, `RelayRecord.source` field |
| Runtime option parsing | `src/runtime/runtime-options.ts` | `--port`, `--socks5-port`, `--proxy-auth`, `--tor`, `--mullvad`, `--no-tui` |
| Request stats tracking | `src/stats.ts` | Per-relay request/failure counts, active connections |
| Canonical test behavior | `test/*.test.ts` | Bun tests + integration-style proxy checks |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `createServer` | function | `src/server/server.ts` | 9 | HTTP server entry, route dispatch, proxy auth |
| `handleHttpProxyRequest` | function | `src/proxy/http-proxy.ts` | 3 | Absolute `http://` proxy forwarding via SOCKS5 |
| `handleConnectTunnel` | function | `src/proxy/http-proxy.ts` | 3 | `CONNECT` tunnel handling |
| `connectViaSocks5` | function | `src/proxy/socks5.ts` | medium | SOCKS5 handshake + connect |
| `createSocks5Server` | function | `src/proxy/socks5-server.ts` | low | SOCKS5 server listener |
| `createRelaySelector` | function | `src/relay/relay-selector.ts` | 9 | Rotation/filter state machine with excludeCountry |
| `createStatsTracker` | function | `src/stats.ts` | low | Per-relay request/failure counters |
| `parseRelayList` | function | `src/relay/relay-parser.ts` | 9 | Mullvad CLI text -> relay records |
| `createTorRelay` | function | `src/relay/tor-relay.ts` | low | TOR synthetic relay record |
| `checkTorAvailable` | function | `src/relay/tor-relay.ts` | low | TCP probe to TOR SOCKS5 port |
| `runTui` | function | `src/tui/tui.ts` | medium | Interactive setup via @inquirer/prompts |
| `shouldShowTui` | function | `src/tui/tui.ts` | low | Detect TUI mode from argv/TTY |
| `parseRuntimeOptions` | function | `src/runtime/runtime-options.ts` | low | Port, socks5-port, proxy-auth, logging, source, tui flags |

## RELAY SOURCE MODEL
- `RelayRecord.source` field: `"mullvad" | "tor"` — identifies the originating source.
- Mullvad: parsed from CLI text, many relays, SOCKS5 per relay.
- TOR: single synthetic record (`source: "tor"`, `hostname: "tor-relay"`), SOCKS5 at `localhost:9050`. TOR handles its own internal circuit rotation.
- Both sources coexist in the same `RelaySelector`. TOR's single entry competes fairly in random/round-robin rotation.
- Future sources (NordVPN, etc.) add another `RelaySource` variant and `src/relay/<name>.ts` module.

## CONVENTIONS
- Bun-first commands in docs/examples (`bun run`, `bun test`, `bunx`).
- Tests stay in `test/` as `*.test.ts`, using `bun:test` imports.
- Keep frameworkless module boundaries (plain TypeScript modules, explicit wiring).
- Prefer explicit error responses and validation over implicit fallback behavior.
- New relay sources get their own `src/relay/<source>.ts` module + `RelaySource` type variant.

## ANTI-PATTERNS (THIS PROJECT)
- Do not introduce non-Bun command examples in docs.
- Do not scatter tests outside `test/`.
- Do not replace project constraints from global `CLAUDE.md` (forbidden packages, safety rules).
- Do not hardcode TOR port; use `--tor-port` flag or default 9050.

## UNIQUE STYLES
- Supports HTTP proxy, CONNECT tunnels, and SOCKS5 server mode.
- Multi-source relay aggregation (Mullvad + TOR, extensible).
- Relay source is human-readable CLI output parsed by regex, not JSON API payloads.
- Relay rotation supports unhealthy backoff and runtime reconfiguration over HTTP endpoints.
- Country exclusion (`exclude_country=us,de`) enables jurisdiction-aware relay filtering.
- Proxy auth is optional and off by default; API endpoints are always unauthenticated.
- Interactive TUI on `bun run start` when no direct flags passed.

## COMMANDS
```bash
bun install
bun run start              # Interactive TUI
bun run start -- --mullvad # Mullvad only, skip TUI
bun run start -- --tor     # TOR only, skip TUI
bun test
bunx tsc --noEmit
bun run biome-lint
bun run biome-format
```

## NOTES
- Project is a git repo; keep commit/branch metadata current when regenerating this file.
- Domain-specific guidance lives in `src/AGENTS.md`, `src/proxy/AGENTS.md`, and `src/relay/AGENTS.md`.
