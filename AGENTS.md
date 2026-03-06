# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-06 20:46 (Etc/GMT-3)
**Commit:** N/A (not a git repository)
**Branch:** N/A (not a git repository)

## OVERVIEW

`relayrad` is a Bun + TypeScript local rotating HTTP proxy for Mullvad relays. Runtime starts from `index.ts`, while domain modules live in `src/{server,proxy,relay,runtime}` and tests live in `test/`.

## STRUCTURE

```text
mullvader/
|- index.ts
|- src/               # domain modules: server, proxy, relay, runtime
|- test/              # Bun tests and shared test fixtures
|- README.md
|- package.json
|- tsconfig.json
`- biome.json
```

## WHERE TO LOOK

| Task                                | Location                 | Notes                                                        |
| ----------------------------------- | ------------------------ | ------------------------------------------------------------ |
| Runtime boot + process lifecycle    | `index.ts`               | Loads relays, creates server, handles SIGINT/SIGTERM         |
| HTTP/CONNECT proxy transport        | `src/proxy/http-proxy.ts`      | HTTP and CONNECT proxy flow, relay retry                      |
| SOCKS5 transport implementation     | `src/proxy/socks5.ts`          | SOCKS5 handshake/connect framing                              |
| API endpoints + request routing     | `src/server/server.ts`         | `/relays`, `/rotate`, `/relays/refresh`, `/health`           |
| Request payload/query sanitization  | `src/server/selection-config.ts` | Selection-config parsing and JSON body reading             |
| Relay parsing from Mullvad CLI text | `src/relay/relay-parser.ts`    | Regex-based parser and relay record mapping                  |
| Relay rotation/filter strategy      | `src/relay/relay-selector.ts`  | Filtering, sorting, unhealthy backoff, round-robin cursor    |
| Runtime flags/env parsing           | `src/runtime/runtime-options.ts` | `--port` / `-p` and env fallbacks                          |
| Core data contracts                 | `src/relay/relay-types.ts`     | Shared types for relay records/config                        |
| Test behavior and conventions       | `test/*.test.ts`               | Bun tests under a dedicated test directory                    |

## CODE MAP

| Symbol                     | Type     | Location                 | Refs   | Role                                           |
| -------------------------- | -------- | ------------------------ | ------ | ---------------------------------------------- |
| `createServer`             | function | `src/server/server.ts`          | high   | Main HTTP server and routing entry             |
| `handleHttpProxyRequest`   | function | `src/proxy/http-proxy.ts`       | high   | Proxies absolute `http://` requests via SOCKS5 |
| `handleConnectTunnel`      | function | `src/proxy/http-proxy.ts`       | high   | Handles `CONNECT` tunnel traffic               |
| `connectViaSocks5`         | function | `src/proxy/socks5.ts`           | high   | Performs SOCKS5 handshake/connect              |
| `createRelaySelector`      | function | `src/relay/relay-selector.ts`   | high   | Filtering/sorting/rotation state machine       |
| `parseRelayList`           | function | `src/relay/relay-parser.ts`     | medium | Converts CLI text to typed relay records       |
| `parseRuntimeOptions`      | function | `src/runtime/runtime-options.ts` | medium | Runtime host/port config parser               |
| `loadRelaysFromMullvadCli` | function | `src/relay/mullvad-cli.ts`      | medium | Spawns `mullvad relay list` and parses output  |

## CONVENTIONS

- Use Bun-first workflows (`bun run`, `bun test`, `bunx`) instead of Node/npm equivalents.
- Keep tests in `test/` with `*.test.ts` suffix and import from `bun:test`.
- Keep HTTP proxy and relay selection logic in plain TypeScript modules (no framework server layer).
- Prefer strict runtime validation and explicit error responses over silent fallback behavior.

## ANTI-PATTERNS (THIS PROJECT)

- Do not add Node ecosystem substitutions prohibited in `CLAUDE.md` (`express`, `ws`, `ioredis`, `pg`, `better-sqlite3`, `vite`, `dotenv`).
- Do not spread tests across mixed locations; keep tests in `test/` for consistency.
- Do not introduce non-Bun run/test command examples in docs or task instructions.

## UNIQUE STYLES

- Proxy functionality covers both absolute HTTP proxy requests and CONNECT tunnel mode.
- Relay parsing is regex-driven from human-readable Mullvad CLI output, not JSON API responses.
- Rotation supports unhealthy relay backoff and reconfiguration through HTTP endpoints.

## COMMANDS

```bash
# install deps
bun install

# run service
bun run start

# run test suite
bun test

# typecheck
bunx tsc --noEmit

# lint / format
bun run biome-lint
bun run biome-format
```

## NOTES

- This workspace is currently not a git repository; commit/branch metadata is unavailable.
- Large `node_modules/` content should be ignored when deriving project conventions.
