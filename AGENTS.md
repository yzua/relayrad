# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-06 20:46 (Etc/GMT-3)
**Commit:** N/A (not a git repository)
**Branch:** N/A (not a git repository)

## OVERVIEW

`relayrad` is a Bun + TypeScript local rotating HTTP proxy for Mullvad relays. Runtime starts from `index.ts`, while proxy, relay parsing, and selection logic live in `src/`.

## STRUCTURE

```text
mullvader/
|- index.ts
|- src/               # proxy runtime, relay parsing, selection, tests
|- README.md
|- package.json
|- tsconfig.json
`- biome.json
```

## WHERE TO LOOK

| Task                                | Location                 | Notes                                                        |
| ----------------------------------- | ------------------------ | ------------------------------------------------------------ |
| Runtime boot + process lifecycle    | `index.ts`               | Loads relays, creates server, handles SIGINT/SIGTERM         |
| HTTP/CONNECT proxy transport        | `src/http-proxy.ts`      | SOCKS5 connect, request/response piping, retry across relays |
| API endpoints + request routing     | `src/server.ts`          | `/relays`, `/rotate`, `/relays/refresh`, `/health`           |
| Relay parsing from Mullvad CLI text | `src/relay-parser.ts`    | Regex-based parser and relay record mapping                  |
| Relay rotation/filter strategy      | `src/relay-selector.ts`  | Filtering, sorting, unhealthy backoff, round-robin cursor    |
| Runtime flags/env parsing           | `src/runtime-options.ts` | `--port` / `-p` and env fallbacks                            |
| Core data contracts                 | `src/relay-types.ts`     | Shared types for relay records/config                        |
| Test behavior and conventions       | `src/*.test.ts`          | Bun test files colocated beside source                       |

## CODE MAP

| Symbol                     | Type     | Location                 | Refs   | Role                                           |
| -------------------------- | -------- | ------------------------ | ------ | ---------------------------------------------- |
| `createServer`             | function | `src/server.ts`          | high   | Main HTTP server and routing entry             |
| `handleHttpProxyRequest`   | function | `src/http-proxy.ts`      | high   | Proxies absolute `http://` requests via SOCKS5 |
| `handleConnectTunnel`      | function | `src/http-proxy.ts`      | high   | Handles `CONNECT` tunnel traffic               |
| `connectViaSocks5`         | function | `src/http-proxy.ts`      | high   | Performs SOCKS5 handshake/connect              |
| `createRelaySelector`      | function | `src/relay-selector.ts`  | high   | Filtering/sorting/rotation state machine       |
| `parseRelayList`           | function | `src/relay-parser.ts`    | medium | Converts CLI text to typed relay records       |
| `parseRuntimeOptions`      | function | `src/runtime-options.ts` | medium | Runtime host/port config parser                |
| `loadRelaysFromMullvadCli` | function | `src/mullvad-cli.ts`     | medium | Spawns `mullvad relay list` and parses output  |

## CONVENTIONS

- Use Bun-first workflows (`bun run`, `bun test`, `bunx`) instead of Node/npm equivalents.
- Keep tests in `src/` with `*.test.ts` suffix and import from `bun:test`.
- Keep HTTP proxy and relay selection logic in plain TypeScript modules (no framework server layer).
- Prefer strict runtime validation and explicit error responses over silent fallback behavior.

## ANTI-PATTERNS (THIS PROJECT)

- Do not add Node ecosystem substitutions prohibited in `CLAUDE.md` (`express`, `ws`, `ioredis`, `pg`, `better-sqlite3`, `vite`, `dotenv`).
- Do not move test files into separate infra folders; this repo uses source-colocated tests.
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
