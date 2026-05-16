# PROXY KNOWLEDGE BASE

**Scope:** `src/proxy/` transport layer only.

## OVERVIEW

`src/proxy` handles forwarding of absolute HTTP proxy requests, CONNECT tunnels, WebSocket upgrades, and SOCKS5 server connections over selected relays (SOCKS5 or HTTP upstream depending on relay protocol).

## OVERRIDES ROOT

- Transport error semantics here are strict: upstream failure paths should resolve to deterministic `502` behavior.
- Retry behavior is relay-centric (mark unhealthy, then try next), not socket-centric.

## KEY FILES

| Task                         | File                             | Notes                                                                                                       |
| ---------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Protocol-aware relay connect | `src/proxy/connect-via-relay.ts` | Dispatches to `connectViaSocks5`, `connectViaHttpProxy`, or `connectViaHttpPlain` based on `relay.protocol` |
| HTTP proxy forwarding        | `src/proxy/http-proxy.ts`        | Absolute `http://`/`ws://` URL validation, request rewrite                                                  |
| Plain HTTP proxy upstream    | `src/proxy/http-plain.ts`        | CONNECT without TLS for `protocol: "http-plain"` relays                                                     |
| CONNECT tunnel behavior      | `src/proxy/tunnel-handlers.ts`   | CONNECT authority parse + bidirectional socket piping via relay retry                                       |
| WebSocket upgrade proxying   | `src/proxy/tunnel-handlers.ts`   | `ws://` URL proxying + upgrade event handling via relay retry                                               |
| HTTP proxy upstream (TLS)    | `src/proxy/http-upstream.ts`     | CONNECT via TLS, HTTP request formatting, proxy auth header                                                 |
| Shared socket utilities      | `src/proxy/socket-utils.ts`      | `readUntilHeaderEnd`, `waitForSocketDrain`, `onceSocketClosed`, `readExact`                                 |
| SOCKS5 client handshake      | `src/proxy/socks5.ts`            | Greeting, connect request framing, status validation, unique SOCKS5 auth for TOR                            |
| SOCKS5 server listener       | `src/proxy/socks5-server.ts`     | Accepts SOCKS5 clients, routes through relays (protocol-aware)                                              |
| Socket prewarm cache         | `src/proxy/socket-prewarm.ts`    | TCP connection cache for SOCKS5 relays (max 64, 2s idle TTL)                                                |
| Proxy runtime + retry        | `src/proxy/relay-retry.ts`       | `ProxyRuntime`, `tryRelays`, `createRetryDeps`, sticky session header parse                                 |

## LOCAL INVARIANTS

- `handleHttpProxyRequest` (in `http-proxy.ts`) must reject non-absolute/non-HTTP proxy URLs with `400` JSON (accepts `http://` and `ws://`).
- `handleWebSocketUpgrade` and `handleConnectTunnel` (in `tunnel-handlers.ts`) use the same `tryRelays` relay retry path as HTTP.
- `tryRelays` must mark failed relays unhealthy before moving to the next candidate.
- Header read limits/timeouts (in `socket-utils.ts`) are safety guards, not optional behavior.
- CONNECT authority parsing must validate host + integer port in `1..65535`.
- Triple upstream transport: `protocol: "socks5"` relays use `connectViaSocks5`, `protocol: "http"` relays use `connectViaHttpProxy` with TLS, `protocol: "http-plain"` relays use `connectViaHttpPlain` without TLS.

## ANTI-PATTERNS

- Do not bypass `tryRelays` for new upstream request paths.
- Do not remove upstream header size/time limits from response parsing.
- Do not leak partially parsed/invalid upstream responses to clients.
- Do not treat SOCKS5 domain and IPv4 target framing as interchangeable.

## VALIDATION

- Run: `bun test test/http-proxy.test.ts`
- Then run: `bun test`
- Keep `bun run typecheck` clean after transport-layer edits.

## RELATED PATHS

- `src/server/server.ts` (entrypoints that call proxy handlers)
- `src/proxy/tunnel-handlers.ts` (CONNECT + WebSocket tunnel handling)
- `src/relay/relay-selector.ts` (relay selection + unhealthy backoff)
