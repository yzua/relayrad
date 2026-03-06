# SRC KNOWLEDGE BASE

**Scope:** `src/` internals only

## OVERVIEW
`src/` contains the proxy engine, relay ingestion/parsing, filtering/rotation state, and colocated Bun tests.

## STRUCTURE
```text
src/
|- server.ts               # HTTP server, API routes, proxy request dispatch
|- http-proxy.ts           # SOCKS5 tunnel + HTTP/CONNECT transport
|- relay-selector.ts       # filtering, sorting, unhealthy backoff, cursor
|- relay-parser.ts         # Mullvad CLI text parser
|- mullvad-cli.ts          # process spawn wrapper for `mullvad relay list`
|- runtime-options.ts      # argv/env host+port parsing
|- relay-types.ts          # shared contracts
|- config.ts               # default selection config
`- *.test.ts               # Bun tests beside implementation files
```

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Add/adjust API route behavior | `src/server.ts` | Keep `routeRequest` branch style and JSON response helpers |
| Change upstream proxy behavior | `src/http-proxy.ts` | Touch relay retry loop + SOCKS5 framing carefully |
| Modify relay matching/sorting rules | `src/relay-selector.ts` | Preserve normalization + cursor semantics |
| Adapt CLI output parsing | `src/relay-parser.ts` | Keep regex line-state parsing approach |
| Change runtime flags/env behavior | `src/runtime-options.ts` | Preserve `--port` / `-p` precedence over env |
| Add types for new relay metadata | `src/relay-types.ts` | Keep shared contract updates centralized |

## CONVENTIONS
- Keep side effects at boundaries (`server.ts`, `mullvad-cli.ts`); keep pure logic in selector/parser/options modules.
- Return explicit `undefined`/errors rather than hidden fallbacks in parsing and proxy validation paths.
- Prefer narrow helper functions (`stringField`, `numberField`, `parseConnectTarget`) over inline ad-hoc parsing.
- Tests should stay colocated as `*.test.ts` and use `bun:test` imports.

## ANTI-PATTERNS (SRC)
- Do not bypass `tryRelays` unhealthy marking when adding new upstream request paths.
- Do not swap regex parser for JSON assumptions; Mullvad relay source is CLI text.
- Do not add framework abstractions (Express-style middleware/router) in `src/server.ts`.
- Do not move `src/*.test.ts` into separate test folders.
