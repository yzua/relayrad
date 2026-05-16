# AGENTS.md

## Start here

- Runtime entrypoint is `index.ts`. It parses flags/env, optionally shows the TUI, loads relay sources, starts the HTTP proxy, and optionally starts the SOCKS5 server.
- Before editing under `src/`, read the nearest scoped instructions: `src/AGENTS.md`, then `src/proxy/AGENTS.md` or `src/relay/AGENTS.md` for those subtrees.

## Source of truth

- No CI workflows, task runners, or pre-commit configs. `package.json` scripts and `test/*.test.ts` are authoritative.
- Bun runs TypeScript directly; no build/emit step.

## Commands

- Install: `bun install`
- Start interactive mode: `bun run start`
- Skip the TUI: `bun run start -- --mullvad` or `bun run start -- --tor --port 5000`
- Focused test: `bun test test/server.test.ts` (swap the file as needed)
- Full test suite: `bun test`
- Typecheck: `bun run typecheck`
- Lint: `bun run biome-lint`
- Format in place: `bun run biome-format` (writes the whole repo)
- Unused-code check: `bun run knip` — only scans `src/**/*.ts`; does not cover `index.ts` or `test/`.

## TypeScript strictness

The tsconfig is stricter than defaults. The ones most likely to cause surprises:

- `verbatimModuleSyntax`: always use `import type` for type-only imports.
- `exactOptionalPropertyTypes`: optional properties cannot be explicitly assigned `undefined`.
- `noUncheckedIndexedAccess`: index-signature and array accesses return `T | undefined`.
- `noPropertyAccessFromIndexSignature`: use bracket notation for index-signature keys.

## Data flow

1. `index.ts` → `parseRuntimeOptions` → optional `runTui` → `loadRelaySources` → `createServer`
2. Incoming HTTP request → `server.ts` dispatch → sticky session lookup → `relay-retry.ts` picks relay → `connectViaRelay` dispatches by `relay.protocol` to SOCKS5 / HTTP-proxy-TLS / HTTP-plain transport
3. `POST /rotate` mutates live `RelaySelectionConfig` without restart; unknown fields produce warnings, not errors

## Runtime quirks

- `.env` is not auto-loaded. `source .env` before `bun run start`.
- No relay source flags → defaults to Mullvad.
- `--relay-refresh-interval` (flag, ms) or `RELAYRAD_RELAY_REFRESH_INTERVAL` (env) controls auto-refresh; default 3,600,000 ms (60 min). Set `0` to disable.
- TUI appears when stdin is a TTY and neither source flags (`--mullvad`, `--tor`, `--nordvpn`, `--github-lists`) nor config flags (`--port`/`-p`, `--socks5-port`, `--proxy-auth`, `--log-proxy-sqlite`) nor `--no-tui` are present. Other flags like `--tor-port` or `--no-log-proxy-console` do NOT suppress the TUI.
- Proxy auth guards proxy traffic only. API routes (`/relays`, `/rotate`, `/relays/refresh`, `/health`, `/stats`) are unauthenticated.

## Where to edit

- `src/runtime/startup.ts`: source defaulting/loading and partial-failure handling
- `src/relay/github-lists/github-lists.ts`: GitHub Lists proxy list loader
- `src/server/routes.ts` + `src/server/selection-config.ts`: HTTP API, request-body parsing, unknown-field warnings
- `src/server/server.ts`: sticky-session wiring, CONNECT/upgrade auth, live selection config
- `src/proxy/relay-retry.ts`: sticky relay reuse and relay failover
- `src/relay/relay-selector.ts`: filtering, sorting, unhealthy backoff, rotation state

## Repo-specific invariants

- `POST /rotate` ignores unknown JSON fields and returns warnings instead of failing.
- `X-Proxy-Session` applies to HTTP, CONNECT, and WebSocket flows. If a sticky relay fails, clear/rebind it; do not keep retrying the dead relay.
- Relay transport is protocol-driven: Mullvad/TOR use SOCKS5, NordVPN uses HTTP proxy over TLS, GitHub Lists uses SOCKS5 or plain HTTP CONNECT.
- Selector module defaults to `sort: "hostname"`, but runtime default is `sort: "random"` (defined in `src/proxy/proxy-runtime.ts` as `RUNTIME_DEFAULT_CONFIG`).
- Keep explicit error surfaces (`400`/`407`/`502`) rather than silent fallbacks.
- No framework abstractions in `server.ts` — raw Node HTTP server with manual routing.

## Validation

- No umbrella check script. Run the closest `bun test test/<file>.test.ts` first.
- For shared/runtime/proxy changes, broaden to `bun run typecheck` and `bun test`.
- `bun test` also runs `test/perf-bench.test.ts`, which is heavier/noisier than the unit suites.
