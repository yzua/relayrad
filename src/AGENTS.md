# SRC KNOWLEDGE BASE

**Scope:** `src/` internals only

## OVERVIEW
`src/` contains the proxy engine, relay ingestion/parsing, filtering/rotation state, and runtime/server modules. Tests live in `test/`.

## STRUCTURE
```text
src/
|- server/
|  |- server.ts            # HTTP server, API routes, proxy request dispatch
|  |- selection-config.ts  # request/query config sanitization and JSON body parsing
|  `- config.ts            # default selection config
|- proxy/
|  |- http-proxy.ts        # HTTP/CONNECT transport
|  `- socks5.ts            # SOCKS5 handshake/connect framing
|- relay/
|  |- relay-selector.ts    # filtering, sorting, unhealthy backoff, cursor
|  |- relay-parser.ts      # Mullvad CLI text parser
|  |- mullvad-cli.ts       # process spawn wrapper for `mullvad relay list`
|  `- relay-types.ts       # shared contracts
`- runtime/
   `- runtime-options.ts   # argv/env host+port parsing
```

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Add/adjust API route behavior | `src/server/server.ts` | Keep `routeRequest` branch style and JSON response helpers |
| Change upstream proxy behavior | `src/proxy/http-proxy.ts` | Touch relay retry loop + SOCKS5 framing carefully |
| Modify relay matching/sorting rules | `src/relay/relay-selector.ts` | Preserve normalization + cursor semantics |
| Adapt CLI output parsing | `src/relay/relay-parser.ts` | Keep regex line-state parsing approach |
| Change runtime flags/env behavior | `src/runtime/runtime-options.ts` | Preserve `--port` / `-p` precedence over env |
| Add types for new relay metadata | `src/relay/relay-types.ts` | Keep shared contract updates centralized |

## CONVENTIONS
- Keep side effects at boundaries (`src/server/server.ts`, `src/relay/mullvad-cli.ts`); keep pure logic in selector/parser/options modules.
- Return explicit `undefined`/errors rather than hidden fallbacks in parsing and proxy validation paths.
- Prefer narrow helper functions (`stringField`, `numberField`, `parseConnectTarget`) over inline ad-hoc parsing.
- Tests should stay in `test/` and use `bun:test` imports.

## ANTI-PATTERNS (SRC)
- Do not bypass `tryRelays` unhealthy marking when adding new upstream request paths.
- Do not swap regex parser for JSON assumptions; Mullvad relay source is CLI text.
- Do not add framework abstractions (Express-style middleware/router) in `src/server/server.ts`.
- Do not move `test/*.test.ts` into mixed locations.
