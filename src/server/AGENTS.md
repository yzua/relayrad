# SERVER KNOWLEDGE BASE

**Scope:** `src/server/` HTTP server, routes, auth, session management, and live config.

## OVERVIEW

`src/server/` contains the HTTP proxy server wiring, API route dispatch, proxy authentication, sticky session management, and the live selection config that overrides selector defaults.

## KEY FILES

| Task                           | File                                   | Notes                                                                                                           |
| ------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Server creation + event wiring | `src/server/server.ts`                 | `createServer()`, relay selector wiring, sticky session manager, CONNECT/upgrade handlers with proxy auth guard |
| API route dispatch             | `src/server/routes.ts`                 | `routeRequest()` — `/relays`, `/rotate`, `/relays/refresh`, `/health`, `/stats`, plus proxy request detection   |
| Selection config parsing       | `src/server/selection-config.ts`       | `sanitizeSelectionConfig()`, `unknownFields()`, `readJsonBody()`, URL query param extraction                    |
| Default selection config       | `src/server/config.ts`                 | `defaultSelectionConfig` — `sort: "random"`, `unhealthyBackoffMs: 30000`                                        |
| Proxy auth                     | `src/server/proxy-auth.ts`             | `checkProxyAuthRaw()` — Basic auth header parsing, `sendProxyAuthRequired()` — 407 response                     |
| Sticky session manager         | `src/server/sticky-session-manager.ts` | `createStickySessionManager()` — session-keyed relay pinning with inactivity TTL                                |

## LOCAL INVARIANTS

- `defaultSelectionConfig` (in `config.ts`) overrides the selector's internal `normalizeConfig` default of `sort: "hostname"` to `sort: "random"`.
- `POST /rotate` body is parsed by `sanitizeSelectionConfig()` which coerces all fields; unknown keys produce warnings, not errors.
- `InvalidJsonBodyError` is the only custom error class; it's caught in `server.ts` and mapped to `400`.
- Proxy auth (`--proxy-auth`) guards proxy traffic (HTTP, CONNECT, WebSocket upgrade) but **not** API routes (`/relays`, `/rotate`, `/relays/refresh`, `/health`, `/stats`).
- `routeRequest()` detects proxy requests by checking if the URL starts with `http://` or `ws://` (via `isProxyRequest()`).
- The relay list cache in `server.ts` holds up to 64 entries and is cleared on config update or relay refresh.
- Sticky session TTL is `5 * 60_000` ms (5 minutes), reset on each access.

## ANTI-PATTERNS

- Do not add Express-style middleware/router abstractions in `server.ts`.
- Do not add auth checks to API routes — proxy auth is intentional scope for proxy traffic only.
- Do not bypass `sanitizeSelectionConfig()` for request body parsing — it provides the coercion and field-whitelist contract.

## VALIDATION

- Run: `bun test test/server.test.ts`
- Then run: `bun test`
- Keep `bun run typecheck` clean after server-layer edits.

## RELATED PATHS

- `src/proxy/http-proxy.ts` (called by `routeRequest` for proxy requests)
- `src/proxy/tunnel-handlers.ts` (CONNECT + WebSocket, wired in `server.ts` events)
- `src/proxy/relay-retry.ts` (ProxyRuntime type, sticky session header parsing)
- `src/relay/relay-selector.ts` (relay selection + config update)
