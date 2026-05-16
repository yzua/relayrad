# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**relayrad** — a local rotating proxy that aggregates relay sources (Mullvad, NordVPN, TOR, GitHub Lists) behind a single HTTP/SOCKS5 endpoint. Written in TypeScript, runs on Bun with no build/emit step.

## Commands

```bash
bun install                       # install deps
bun run start                     # start with interactive TUI
bun run start -- --mullvad        # skip TUI, use specific source
bun test                          # full test suite (includes perf benchmarks)
bun test test/server.test.ts      # single test file
bun run typecheck                 # tsc --noEmit
bun run biome-lint                # lint
bun run biome-format              # format (writes in place)
bun run knip                      # unused code check (src/**/*.ts only)
```

`.env` is not auto-loaded — `source .env` before `bun run start`.

## Architecture

```
index.ts              # Entry: parses flags/env, optional TUI, loads sources, starts servers
src/
  runtime/            # CLI flag + env parsing, startup orchestration, source loading
  tui/                # @inquirer/prompts interactive setup
  server/             # HTTP route handling, proxy dispatch, sticky sessions, auth
  proxy/              # Upstream transport (SOCKS5, HTTP proxy TLS, HTTP plain), relay retry, SOCKS5 server
  relay/              # Relay contracts (RelayRecord), per-source API loaders, selector/backoff
    mullvad/          # Mullvad public API loader
    nordvpn/          # NordVPN API loader (HTTP proxy over TLS)
    tor/              # TOR local SOCKS5 source
    github-lists/     # GitHub public proxy list loader
  logging/            # Console + SQLite request logging
  stats.ts            # Per-relay request/failure counters
```

### Key data flow

1. `index.ts` → `parseRuntimeOptions` → optional `runTui` → `loadRelaySources` → `createServer`
2. Incoming HTTP request → `server.ts` dispatch → sticky session lookup → `relay-retry.ts` picks relay → `connectViaRelay` dispatches by `relay.protocol` to SOCKS5/HTTP-proxy/HTTP-plain transport
3. `POST /rotate` mutates live `RelaySelectionConfig` without restart; unknown fields produce warnings, not errors

### Core types

- `RelayRecord` (`src/relay/relay-types.ts`): canonical relay shape used across all sources. Each source loader normalizes to this.
- `RelaySelectionConfig`: filter/sort config shared by `/relays` query params and `/rotate` body.
- `RelaySource`: union `"mullvad" | "tor" | "nordvpn" | "github-lists"`.

### Transport dispatch

`connectViaRelay` (`src/proxy/connect-via-relay.ts`) routes by `relay.protocol`:

- `"socks5"` (default) → `connectViaSocks5`
- `"http"` → `connectViaHttpProxy` (TLS HTTP proxy, used by NordVPN)
- `"http-plain"` → `connectViaHttpPlain` (plain CONNECT, used by GitHub Lists HTTP entries)

### Server defaults

- Runtime defaults (`sort: "random"`, `unhealthyBackoffMs: 30000`, sticky session TTL 5 min) are defined in `src/proxy/proxy-runtime.ts` (`RUNTIME_DEFAULT_CONFIG`, `STICKY_SESSION_TTL_MS`). Selector module defaults to `sort: "hostname"`.
- API routes (`/relays`, `/rotate`, `/relays/refresh`, `/health`, `/stats`) are unauthenticated; proxy auth only guards proxy traffic.
- Sticky sessions (`X-Proxy-Session`) pin to one relay for 5 min inactivity, auto-rebind on failure.

## Repo conventions

- No framework abstractions in `server.ts` — raw Node HTTP server with manual routing.
- Side effects at boundaries (`server.ts`, source loaders); selector/options modules stay mostly pure.
- Explicit error surfaces (`400`/`407`/`502`) over silent fallbacks.
- Tests use `bun:test` only. Shared helpers in `test/test-fixtures.ts`. Test servers use `listen(0)` — never hard-code ports.
- Scoped `AGENTS.md` files exist at `src/`, `src/proxy/`, `src/relay/`, `src/server/`, and `test/` levels with subtree-specific guidance.

## TypeScript config

Strict mode with `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. Bun types available.
