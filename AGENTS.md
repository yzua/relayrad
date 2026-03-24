# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-23 01:30 (+03)
**Updated:** 2026-03-24 — NordVPN source, HTTP upstream, API-only Mullvad, socket-utils extraction
**Branch:** main

## OVERVIEW
`relayrad` is a Bun + TypeScript local rotating multi-source HTTP proxy. Routes traffic through Mullvad VPN relays, TOR, NordVPN, or any combination. Supports HTTP proxy, CONNECT tunnels, and SOCKS5 server mode. Interactive TUI on `bun run start` for source/options selection. Runtime starts in `index.ts`, with domain logic in `src/` and verification in `test/`.

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
|  |  |- http-proxy.ts      # HTTP proxy forwarding + CONNECT tunnel dispatch
|  |  |- http-upstream.ts   # TLS HTTP proxy upstream (NordVPN port 89)
|  |  |- socket-utils.ts    # Shared: readUntilHeaderEnd, waitForSocketDrain, onceSocketClosed
|  |  |- socks5.ts          # SOCKS5 client handshake + prewarm cache
|  |  |- socks5-server.ts   # SOCKS5 server listener (protocol-aware dispatch)
|  |  `- relay-retry.ts     # Retry across relays on failure
|  |- relay/
|  |  |- AGENTS.md
|  |  |- relay-types.ts     # RelayRecord, RelaySource, filters
|  |  |- relay-selector.ts  # Rotation/filter/backoff state machine
|  |  |- mullvad/
|  |  |  `- mullvad-api.ts  # Fetches relays from api.mullvad.net
|  |  |- nordvpn/
|  |  |  `- nordvpn.ts      # Fetches servers from api.nordvpn.com, HTTP proxy on port 89
|  |  `- tor/
|  |     `- tor-relay.ts    # TOR relay source + availability check
|  |- runtime/
|  |  |- runtime-options.ts # CLI flags + env parsing
|  |  |- runtime-validation.ts # Port + auth input validation
|  |  `- startup.ts         # Startup orchestration + source loading
|  |- server/
|  |  |- server.ts          # HTTP server + API routes + proxy dispatch
|  |  |- selection-config.ts # Request config parsing + sanitization
|  |  `- config.ts          # Default selection config
|  |- logging/
|  |  `- proxy-request-logger.ts # Console + SQLite proxy logging
|  `- stats.ts              # per-relay request/failure tracking
|- test/                    # bun:test coverage + fixtures
|- README.md
|- package.json
|- tsconfig.json
|- biome.json
`- .env.example
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Boot + shutdown + TUI gate | `index.ts` | TUI check, multi-source loading, server boot, SIGINT/SIGTERM |
| Interactive TUI | `src/tui/tui.ts` | @inquirer/prompts: source select, logging, ports, auth |
| Route handling + API surface | `src/server/server.ts` | `/relays`, `/rotate`, `/relays/refresh`, `/health`, `/stats` |
| HTTP proxy + CONNECT tunnel | `src/proxy/http-proxy.ts` | Retry flow, upstream header parsing, relay fallback, stats recording |
| HTTP upstream (NordVPN TLS) | `src/proxy/http-upstream.ts` | CONNECT via TLS, HTTP request formatting, proxy auth header |
| Shared socket utilities | `src/proxy/socket-utils.ts` | `readUntilHeaderEnd`, `waitForSocketDrain`, `onceSocketClosed` |
| SOCKS5 client handshake | `src/proxy/socks5.ts` | Connect framing + socket prewarm cache |
| SOCKS5 server listener | `src/proxy/socks5-server.ts` | Accepts SOCKS5 clients, protocol-aware relay dispatch |
| Relay selection strategy | `src/relay/relay-selector.ts` | Filters, sort modes, round-robin/random cycle, unhealthy backoff |
| Mullvad API loader | `src/relay/mullvad/mullvad-api.ts` | Fetches from `api.mullvad.net`, maps to `RelayRecord` |
| NordVPN API loader | `src/relay/nordvpn/nordvpn.ts` | Fetches from `api.nordvpn.com`, HTTP proxy protocol |
| TOR relay source | `src/relay/tor/tor-relay.ts` | `createTorRelay()`, `checkTorAvailable()` TCP probe |
| Relay source contracts | `src/relay/relay-types.ts` | `RelaySource = "mullvad" | "tor" | "nordvpn"` |
| Runtime option parsing | `src/runtime/runtime-options.ts` | `--port`, `--socks5-port`, `--proxy-auth`, `--tor`, `--mullvad`, `--nordvpn`, `--no-tui` |
| Startup orchestration | `src/runtime/startup.ts` | Config resolution, source loading, error reporting |
| Request stats tracking | `src/stats.ts` | Per-relay request/failure counts, active connections |
| Canonical test behavior | `test/*.test.ts` | Bun tests + integration-style proxy checks |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `createServer` | function | `src/server/server.ts` | 9 | HTTP server entry, route dispatch, proxy auth |
| `handleHttpProxyRequest` | function | `src/proxy/http-proxy.ts` | 3 | Absolute `http://` proxy forwarding (SOCKS5 + HTTP upstream) |
| `handleConnectTunnel` | function | `src/proxy/http-proxy.ts` | 3 | `CONNECT` tunnel handling (SOCKS5 + HTTP upstream) |
| `connectViaSocks5` | function | `src/proxy/socks5.ts` | medium | SOCKS5 handshake + connect |
| `connectViaHttpProxy` | function | `src/proxy/http-upstream.ts` | medium | TLS CONNECT tunnel via HTTP proxy |
| `readUntilHeaderEnd` | function | `src/proxy/socket-utils.ts` | medium | Shared header reader with size/time limits |
| `createSocks5Server` | function | `src/proxy/socks5-server.ts` | low | SOCKS5 server listener |
| `createRelaySelector` | function | `src/relay/relay-selector.ts` | 9 | Rotation/filter state machine with excludeCountry |
| `createStatsTracker` | function | `src/stats.ts` | low | Per-relay request/failure counters |
| `loadRelaysFromMullvadApi` | function | `src/relay/mullvad/mullvad-api.ts` | medium | Fetches Mullvad relays from API |
| `loadNordvpnRelays` | function | `src/relay/nordvpn/nordvpn.ts` | medium | Fetches NordVPN servers, returns relays + warnings |
| `createTorRelay` | function | `src/relay/tor/tor-relay.ts` | low | TOR synthetic relay record |
| `checkTorAvailable` | function | `src/relay/tor/tor-relay.ts` | low | TCP probe to TOR SOCKS5 port |
| `runTui` | function | `src/tui/tui.ts` | medium | Interactive setup via @inquirer/prompts |
| `shouldShowTui` | function | `src/tui/tui.ts` | low | Detect TUI mode from argv/TTY |
| `parseRuntimeOptions` | function | `src/runtime/runtime-options.ts` | low | Port, socks5-port, proxy-auth, logging, source, tui flags |

## RELAY SOURCE MODEL
- `RelayRecord.source` field: `"mullvad" | "tor" | "nordvpn"` — identifies the originating source.
- Mullvad: fetched from `api.mullvad.net` JSON API, ~580 SOCKS5 relays, no auth required.
- TOR: single synthetic record (`source: "tor"`, `hostname: "tor-relay"`), SOCKS5 at `localhost:9050`. TOR handles its own internal circuit rotation.
- NordVPN: fetched from `api.nordvpn.com` JSON API, ~9000 HTTP proxy relays on port 89 (TLS), requires service credentials.
- All sources coexist in the same `RelaySelector`. TOR's single entry competes fairly in random/round-robin rotation.
- Relay protocol distinguishes transport: `protocol: "socks5"` (Mullvad, TOR) vs `protocol: "http"` (NordVPN).

## CONVENTIONS
- Bun-first commands in docs/examples (`bun run`, `bun test`, `bunx`).
- Tests stay in `test/` as `*.test.ts`, using `bun:test` imports.
- Keep frameworkless module boundaries (plain TypeScript modules, explicit wiring).
- Prefer explicit error responses and validation over implicit fallback behavior.
- New relay sources get their own `src/relay/<source>/` directory + `RelaySource` type variant.

## ANTI-PATTERNS (THIS PROJECT)
- Do not introduce non-Bun command examples in docs.
- Do not scatter tests outside `test/`.
- Do not hardcode TOR port; use `--tor-port` flag or default 9050.
- Do not bypass unhealthy relay marking in proxy retry paths.

## UNIQUE STYLES
- Supports HTTP proxy, CONNECT tunnels, and SOCKS5 server mode.
- Multi-source relay aggregation (Mullvad + TOR + NordVPN, extensible).
- All relay sources use JSON API payloads (no CLI text parsing).
- Dual upstream transport: SOCKS5 (`protocol: "socks5"`) and HTTP proxy (`protocol: "http"`).
- Relay rotation supports unhealthy backoff and runtime reconfiguration over HTTP endpoints.
- Country exclusion (`exclude_country=us,de`) enables jurisdiction-aware relay filtering.
- Proxy auth is optional and off by default; API endpoints are always unauthenticated.
- Interactive TUI on `bun run start` when no direct flags passed.

## COMMANDS
```bash
bun install
bun run start                         # Interactive TUI
bun run start -- --mullvad            # Mullvad only, skip TUI
bun run start -- --nordvpn            # NordVPN only, skip TUI (needs NORDVPN_USERNAME/PASSWORD)
bun run start -- --tor                # TOR only, skip TUI
NORDVPN_USERNAME=u NORDVPN_PASSWORD=p bun run start -- --mullvad --nordvpn
bun test
bunx tsc --noEmit
bun run biome-lint
bun run biome-format
```

## NOTES
- Domain-specific guidance lives in `src/AGENTS.md`, `src/proxy/AGENTS.md`, and `src/relay/AGENTS.md`.
