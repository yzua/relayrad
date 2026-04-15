# AGENTS.md

## Start here
- Runtime entrypoint is `index.ts`. It parses flags/env, optionally shows the TUI, loads relay sources, starts the HTTP proxy, and optionally starts the SOCKS5 server.
- Before editing under `src/`, read the nearest scoped instructions: `src/AGENTS.md`, then `src/proxy/AGENTS.md` or `src/relay/AGENTS.md` for those subtrees.

## Source of truth
- There are no checked-in CI workflows, task runners, or pre-commit configs. `package.json`, `README.md`, and the `test/*.test.ts` files are the authoritative workflow docs.
- Bun runs TypeScript directly here; there is no build script or emitted-JS step.

## Commands
- Install: `bun install`
- Start interactive mode: `bun run start`
- Skip the TUI by passing any source/config flag, e.g. `bun run start -- --mullvad` or `bun run start -- --tor --port 5000`
- Focused test: `bun test test/server.test.ts` (swap the file as needed)
- Full test suite: `bun test`
- Typecheck: `bun run typecheck`
- Lint: `bun run biome-lint`
- Format in place: `bun run biome-format` (writes the whole repo)
- Unused-code check: `bun run knip`
- `knip` only scans `src/**/*.ts`; it does not cover root `index.ts` or anything in `test/`.

## Runtime quirks worth remembering
- `.env` is not auto-loaded. Export or `source .env` yourself before running `bun run start`.
- If no relay source flags are provided, startup defaults to Mullvad.
- The TUI only appears when stdin is a TTY and you passed none of: source flags (`--mullvad`, `--tor`, `--nordvpn`), config flags (`--port`, `-p`, `--socks5-port`, `--proxy-auth`, `--log-proxy-sqlite`), or `--no-tui`.
- Proxy auth guards proxy traffic only. API routes (`/relays`, `/rotate`, `/relays/refresh`, `/health`, `/stats`) stay unauthenticated.

## Where to edit
- `src/runtime/startup.ts`: source defaulting/loading and partial-failure handling
- `src/server/routes.ts` + `src/server/selection-config.ts`: HTTP API, request-body parsing, unknown-field warnings
- `src/server/server.ts`: sticky-session wiring, CONNECT/upgrade auth, live selection config
- `src/proxy/relay-retry.ts`: sticky relay reuse and relay failover
- `src/relay/relay-selector.ts`: filtering, sorting, unhealthy backoff, rotation state

## Repo-specific invariants
- `POST /rotate` ignores unknown JSON fields and returns warnings instead of failing.
- `X-Proxy-Session` applies to HTTP, CONNECT, and WebSocket flows. If a sticky relay fails, clear/rebind it; do not keep retrying the dead relay.
- Relay transport is protocol-driven: Mullvad and TOR use SOCKS5, NordVPN uses HTTP proxy over TLS.
- The selector module defaults to `sort: "hostname"`, but the live server default is `sort: "random"` (`src/server/config.ts`).
- Keep explicit error surfaces (`400`/`407`/`502`) rather than silent fallbacks.

## Validation
- There is no umbrella check script. Run the closest `bun test test/<file>.test.ts` first.
- For shared/runtime/proxy changes, broaden to `bun run typecheck` and `bun test`.
- `bun test` also runs `test/perf-bench.test.ts`, which prints benchmark output and is noisier/heavier than the smaller unit suites.
