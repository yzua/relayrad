# SRC KNOWLEDGE BASE

**Scope:** `src/` internals only.

## OVERVIEW
`src/` holds runtime server wiring plus domain modules for proxy transport and relay selection. Folder-level deltas are documented in child AGENTS files.

## STRUCTURE
```text
src/
|- tui/                    # Interactive TUI for source/options selection
|- server/                 # HTTP route handling + runtime state wiring
|- proxy/                  # upstream transport, SOCKS5 connect, SOCKS5 server
|  `- AGENTS.md
|- relay/                  # relay contracts, API loaders, selection/backoff logic
|  |- AGENTS.md
|  |- mullvad/             # Mullvad API relay loader
|  |- nordvpn/             # NordVPN API relay loader
|  `- tor/                 # TOR relay source + availability check
|- runtime/                # argv/env runtime option parsing + startup orchestration
|- logging/                # proxy request logging (console + SQLite)
`- stats.ts                # per-relay request/failure tracking
```

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Add/adjust API route behavior | `src/server/server.ts` | Keep `routeRequest` branch style and JSON response helpers |
| Change proxy request dispatch | `src/proxy/AGENTS.md` | Child doc covers transport-specific invariants |
| Change relay selection | `src/relay/AGENTS.md` | Child doc covers selector invariants |
| Change runtime flags/env behavior | `src/runtime/runtime-options.ts` | Preserve `--port` / `-p` precedence over env |
| Change logging behavior | `src/logging/proxy-request-logger.ts` | Console + SQLite backends, composite logger |
| Change TUI prompts/flow | `src/tui/tui.ts` | @inquirer/prompts, TUI detection logic |
| Add new relay source | `src/relay/<source>/` | Create directory + module, add `RelaySource` variant, wire in `startup.ts` |

## CONVENTIONS
- Keep side effects at boundaries (`src/server/server.ts`, relay source loaders); keep selector/options modules mostly pure.
- Preserve explicit error surfaces (`400`/`502` responses, thrown API errors) over silent fallbacks.
- Favor focused helpers (`parseConnectTarget`, field coercion helpers) over large inline parsing blocks.

## ANTI-PATTERNS (SRC)
- Do not add framework abstractions (Express-style middleware/router) in `src/server/server.ts`.
- Do not bypass unhealthy relay marking in proxy retry paths.

## NOTES
- `src/proxy/AGENTS.md` and `src/relay/AGENTS.md` intentionally contain local deltas only.
- Shared project-wide policy and commands stay in root `AGENTS.md`.
