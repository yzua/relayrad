# PROXY KNOWLEDGE BASE

**Scope:** `src/proxy/` transport layer only.

## OVERVIEW
`src/proxy` handles forwarding of absolute HTTP proxy requests, CONNECT tunnels, and SOCKS5 server connections over selected relays (SOCKS5 or HTTP upstream depending on relay protocol).

## OVERRIDES ROOT
- Transport error semantics here are strict: upstream failure paths should resolve to deterministic `502` behavior.
- Retry behavior is relay-centric (mark unhealthy, then try next), not socket-centric.

## KEY FILES
| Task | File | Notes |
|------|------|-------|
| HTTP proxy forwarding | `src/proxy/http-proxy.ts` | Absolute `http://` URL validation, request rewrite, relay retry |
| CONNECT tunnel behavior | `src/proxy/http-proxy.ts` | CONNECT authority parse + bidirectional socket piping |
| HTTP proxy upstream (TLS) | `src/proxy/http-upstream.ts` | CONNECT via TLS, HTTP request formatting, proxy auth header |
| Shared socket utilities | `src/proxy/socket-utils.ts` | `readUntilHeaderEnd`, `waitForSocketDrain`, `onceSocketClosed` |
| SOCKS5 client handshake | `src/proxy/socks5.ts` | Greeting, connect request framing, status validation, prewarm cache |
| SOCKS5 server listener | `src/proxy/socks5-server.ts` | Accepts SOCKS5 clients, routes through relays (protocol-aware) |

## LOCAL INVARIANTS
- `handleHttpProxyRequest` must reject non-absolute/non-HTTP proxy URLs with `400` JSON.
- `tryRelays` must mark failed relays unhealthy before moving to the next candidate.
- Header read limits/timeouts (in `socket-utils.ts`) are safety guards, not optional behavior.
- CONNECT authority parsing must validate host + integer port in `1..65535`.
- Dual upstream transport: `protocol: "socks5"` relays use `connectViaSocks5`, `protocol: "http"` relays use `connectViaHttpProxy` with TLS.

## ANTI-PATTERNS
- Do not bypass `tryRelays` for new upstream request paths.
- Do not remove upstream header size/time limits from response parsing.
- Do not leak partially parsed/invalid upstream responses to clients.
- Do not treat SOCKS5 domain and IPv4 target framing as interchangeable.

## VALIDATION
- Run: `bun test test/http-proxy.test.ts`
- Then run: `bun test`
- Keep `bunx tsc --noEmit` clean after transport-layer edits.

## RELATED PATHS
- `src/server/server.ts` (entrypoints that call proxy handlers)
- `src/relay/relay-selector.ts` (relay selection + unhealthy backoff)
