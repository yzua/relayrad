# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-06 23:20 (+03)
**Commit:** bfddeb5
**Branch:** main

## OVERVIEW
`relayrad` is a Bun + TypeScript local rotating HTTP proxy for Mullvad relays. Runtime starts in `index.ts`, with domain logic in `src/` and verification in `test/`.

## STRUCTURE
```text
mullvader/
|- index.ts
|- src/                 # server/proxy/relay/runtime domains
|  |- AGENTS.md
|  |- proxy/AGENTS.md
|  `- relay/AGENTS.md
|- test/                # bun:test coverage + fixtures
|- README.md
|- package.json
|- tsconfig.json
`- biome.json
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Boot + shutdown lifecycle | `index.ts` | Loads relays, starts server, handles SIGINT/SIGTERM |
| Route handling + API surface | `src/server/server.ts` | `/relays`, `/rotate`, `/relays/refresh`, `/health` |
| HTTP proxy + CONNECT tunnel | `src/proxy/http-proxy.ts` | Retry flow, upstream header parsing, relay fallback |
| SOCKS5 handshake/transport | `src/proxy/socks5.ts` | Connect framing + socket prewarm cache |
| Relay parse + selection strategy | `src/relay/*.ts` | CLI text parser + filter/sort/backoff/cursor state |
| Runtime option parsing | `src/runtime/runtime-options.ts` | `--port`/`-p` precedence over env |
| Canonical test behavior | `test/*.test.ts` | Bun tests + integration-style proxy checks |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `createServer` | function | `src/server/server.ts` | 9 | HTTP server entry and route dispatch |
| `handleHttpProxyRequest` | function | `src/proxy/http-proxy.ts` | 3 | Absolute `http://` proxy forwarding via SOCKS5 |
| `handleConnectTunnel` | function | `src/proxy/http-proxy.ts` | 3 | `CONNECT` tunnel handling |
| `connectViaSocks5` | function | `src/proxy/socks5.ts` | medium | SOCKS5 handshake + connect |
| `createRelaySelector` | function | `src/relay/relay-selector.ts` | 9 | Rotation/filter state machine |
| `parseRelayList` | function | `src/relay/relay-parser.ts` | 9 | Mullvad CLI text -> relay records |
| `parseRuntimeOptions` | function | `src/runtime/runtime-options.ts` | low | Host/port runtime parsing |

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
- Supports both absolute HTTP proxy requests and CONNECT tunnels.
- Relay source is human-readable CLI output parsed by regex, not JSON API payloads.
- Relay rotation supports unhealthy backoff and runtime reconfiguration over HTTP endpoints.

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
