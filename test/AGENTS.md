# TEST KNOWLEDGE BASE

**Scope:** `test/` directory only.

## OVERVIEW

Tests use `bun:test` (no external test frameworks). Each test file maps to a source module or subsystem. `test-fixtures.ts` provides shared factory helpers.

## KEY FILES

| Task                        | File                                | Notes                                                                           |
| --------------------------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| Shared relay factory        | `test/test-fixtures.ts`             | `makeRelayRecord()` with `Partial<RelayRecord>` overrides                       |
| Proxy routing (integration) | `test/http-proxy.test.ts`           | Full HTTP/CONNECT/WebSocket proxy tests with mock SOCKS5 servers                |
| Server API routes           | `test/server.test.ts`               | `/relays`, `/rotate`, `/relays/refresh`, `/health`, `stats` endpoint tests      |
| Relay selector              | `test/relay-selector.test.ts`       | Filtering, round-robin, random cycle, unhealthy backoff, multi-source balancing |
| TOR relay                   | `test/tor-relay.test.ts`            | `createTorRelay()` record shape, `checkTorAvailable()` port probe               |
| Request logger              | `test/proxy-request-logger.test.ts` | Noop/console/SQLite logger creation, error swallowing                           |
| Runtime options             | `test/runtime-options.test.ts`      | CLI flag parsing, env var precedence, error cases                               |
| Performance benchmarks      | `test/perf-bench.test.ts`           | Throughput benchmarks for selector, sticky sessions, stats, logger              |

## LOCAL INVARIANTS

- `test-fixtures.ts` is the only shared helper module; all other test files are self-contained.
- `http-proxy.test.ts` spins up real TCP servers (mock SOCKS5, HTTP target, malformed target) on random ports via `listen(0)`.
- `http-proxy.test.ts` uses `bun:sqlite` for SQLite log persistence tests with temp directories.
- `perf-bench.test.ts` is heavier/noisier than unit suites — it prints benchmark output and uses large relay sets (~9581 records).
- Biome complexity rule is disabled for `test/**` (see `biome.json` overrides).

## CONVENTIONS

- Use `makeRelayRecord()` from `test-fixtures.ts` for relay data in tests.
- Use `createNoopProxyRequestLogger()` for tests that don't need real logging.
- Use `listen(0)` for all test servers to avoid port conflicts.
- Clean up temp directories and close servers in `afterAll` / `finally` blocks.

## ANTI-PATTERNS

- Do not add external test frameworks or assertion libraries beyond `bun:test`.
- Do not hard-code ports in test server setup; always use `listen(0)` and read the assigned port.
- Do not add test files for code that has no corresponding `src/` module.

## VALIDATION

- Single file: `bun test test/<file>.test.ts`
- Full suite: `bun test`
- `perf-bench.test.ts` is included in `bun test` and will print benchmark output.
