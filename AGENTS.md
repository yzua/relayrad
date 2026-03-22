# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-23 01:30 (+03)
**Commit:** 72fa473 (stale — features added since, uncommitted)
**Branch:** main

## OVERVIEW
`relayrad` is a Bun + TypeScript local rotating HTTP proxy for Mullvad relays. Supports HTTP proxy, CONNECT tunnels, and SOCKS5 server mode. Runtime starts in `index.ts`, with domain logic in `src/` and verification in `test/`.

## STRUCTURE
```text
mullvader/
|- index.ts
|- src/                 # server/proxy/relay/runtime/stats domains
|  |- AGENTS.md
|  |- proxy/
|  |  |- AGENTS.md
|  |  |- http-proxy.ts
|  |  |- socks5.ts
|  |  `- socks5-server.ts   # SOCKS5 server listener
|  |- relay/
|  |  `- AGENTS.md
|  |- runtime/
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
| Boot + shutdown lifecycle | `index.ts` | Loads relays, starts HTTP + optional SOCKS5 server, handles SIGINT/SIGTERM |
| Route handling + API surface | `src/server/server.ts` | `/relays`, `/rotate`, `/relays/refresh`, `/health`, `/stats` |
| HTTP proxy + CONNECT tunnel | `src/proxy/http-proxy.ts` | Retry flow, upstream header parsing, relay fallback, stats recording |
| SOCKS5 client handshake | `src/proxy/socks5.ts` | Connect framing + socket prewarm cache |
| SOCKS5 server listener | `src/proxy/socks5-server.ts` | Accepts SOCKS5 clients, routes through relays |
| Relay parse + selection strategy | `src/relay/*.ts` | CLI text parser + filter/sort/backoff/cursor + excludeCountry |
| Runtime option parsing | `src/runtime/runtime-options.ts` | `--port`, `--socks5-port`, `--proxy-auth`, logging flags |
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
| `parseRuntimeOptions` | function | `src/runtime/runtime-options.ts` | low | Port, socks5-port, proxy-auth, logging flags |

## CONVENTIONS
- Bun-first commands in docs/examples (`bun run`, `bun test`, `bunx`).
- Tests stay in `test/` as `*.test.ts`, using `bun:test` imports.
- Keep frameworkless module boundaries (plain TypeScript modules, explicit wiring).
- Prefer explicit error responses and validation over implicit fallback behavior.

## ANTI-PATTERNS (THIS PROJECT)
- Do not introduce non-Bun command examples in docs.
- Do not scatter tests outside `test/`.
- Do not replace project constraints from global `CLAUDE.md` (forbidden packages, safety rules).

## UNIQUE STYLES
- Supports HTTP proxy, CONNECT tunnels, and SOCKS5 server mode.
- Relay source is human-readable CLI output parsed by regex, not JSON API payloads.
- Relay rotation supports unhealthy backoff and runtime reconfiguration over HTTP endpoints.
- Country exclusion (`exclude_country=us,de`) enables jurisdiction-aware relay filtering.
- Proxy auth is optional and off by default; API endpoints are always unauthenticated.

## COMMANDS
```bash
bun install
bun run start
bun test
bunx tsc --noEmit
bun run biome-lint
bun run biome-format
```

## NOTES
- Project is a git repo; keep commit/branch metadata current when regenerating this file.
- Domain-specific guidance lives in `src/AGENTS.md`, `src/proxy/AGENTS.md`, and `src/relay/AGENTS.md`.
