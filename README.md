# relayrad

Local rotating HTTP proxy for Mullvad relays.

`relayrad` reads relay inventory from `mullvad relay list` (or a fixture file) and exposes one stable local proxy endpoint. Each proxied request is sent through a selected relay based on your active rotation config.

## Quick Start

### Requirements

- Bun
- A relay source (one of):
  - **Mullvad CLI** installed (`mullvad` in PATH), or
  - A **relay list file** (see below)

### Start

```bash
bun install
bun run start
```

The startup will fail with a clear message if no relay source is available.

### Without Mullvad CLI

If you don't have the Mullvad CLI installed, generate a relay list file on a machine that does:

```bash
mullvad relay list > relays.txt
```

Then copy `relays.txt` to your relayrad directory and start with:

```bash
RELAYRAD_RELAY_LIST_FILE=relays.txt bun run start
```

Default endpoint: `http://127.0.0.1:4123`

Custom port:

```bash
bun run start -- --port 4123
```

Console proxy request logging is enabled by default.

Disable console logging explicitly:

```bash
bun run start -- --no-log-proxy-console
```

Enable console logging (already on by default, this flag is a no-op):

```bash
bun run start -- --log-proxy-console
```

Enable SQLite storage only:

```bash
bun run start -- --log-proxy-sqlite ./relayrad-logs.sqlite
```

Enable both console and SQLite logging:

```bash
bun run start -- --log-proxy-console --log-proxy-sqlite ./relayrad-logs.sqlite
```

Start a SOCKS5 listener alongside the HTTP proxy:

```bash
bun run start -- --socks5-port 1080
```

Require proxy authentication:

```bash
bun run start -- --proxy-auth myuser:mypassword
```

## Basic Usage

Use `relayrad` as your HTTP proxy:

```bash
curl -x http://127.0.0.1:4123 http://httpbin.org/ip
curl -x http://127.0.0.1:4123 http://httpbin.org/ip
curl -x http://127.0.0.1:4123 http://httpbin.org/ip
```

Use via SOCKS5 (when `--socks5-port` is set):

```bash
curl --socks5 127.0.0.1:1080 http://httpbin.org/ip
curl --socks5-hostname 127.0.0.1:1080 https://api.example.com
```

With authentication:

```bash
curl -x http://127.0.0.1:4123 --proxy-user myuser:mypassword http://httpbin.org/ip
```

## API

### List Relays

```bash
curl 'http://127.0.0.1:4123/relays?country=usa&sort=random'
```

Exclude specific countries:

```bash
curl 'http://127.0.0.1:4123/relays?exclude_country=us,de&sort=random'
```

### Update Rotation Config

```bash
curl -X POST http://127.0.0.1:4123/rotate \
  -H 'content-type: application/json' \
  -d '{"country":"usa","sort":"random","unhealthyBackoffMs":45000}'
```

### Refresh Relay Inventory

```bash
curl -X POST http://127.0.0.1:4123/relays/refresh
```

### Health Check

```bash
curl http://127.0.0.1:4123/health
```

### Stats

```bash
curl http://127.0.0.1:4123/stats
```

Returns:

```json
{
  "requestsTotal": 15230,
  "failuresTotal": 42,
  "activeConnections": 5,
  "startTime": "2026-03-22T20:00:00.000Z",
  "topRelays": [
    { "hostname": "us-chi-wg-303", "requests": 230, "failures": 2 }
  ]
}
```

## Rotation Behavior

- Default config:
  - `sort: "random"`
  - `unhealthyBackoffMs: 30000`
- If a relay fails during proxying, it is marked unhealthy and temporarily skipped.
- `POST /rotate` changes the active config at runtime (no restart required).

## Selection Config Reference

Use these fields in query params (`GET /relays`) or JSON body (`POST /rotate`).

| Field | Type | Behavior |
| --- | --- | --- |
| `country` | `string` | Match by country code or country name (case-insensitive) |
| `city` | `string` | Match by city code or city name (case-insensitive) |
| `hostname` | `string` | Substring match on relay hostname |
| `provider` | `string` | Exact provider match (case-insensitive) |
| `ownership` | `owned \| rented` | Filter by ownership type |
| `exclude_country` | `string` | Comma-separated country codes/names to exclude (e.g. `us,de,fr`) |
| `sort` | `random \| hostname \| country \| city` | Result ordering |
| `unhealthyBackoffMs` | `number` | Skip duration after relay failure |

Sort behavior:

- `random`: randomized order
- `hostname`: lexical by hostname
- `country`: lexical by country, then city, then hostname
- `city`: lexical by city, then hostname

## HTTP API

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/relays` | `GET` | List relays using optional filters/sort |
| `/rotate` | `POST` | Update active rotation config and return preview |
| `/relays/refresh` | `POST` | Reload relay inventory from configured source |
| `/health` | `GET` | Liveness check (`{ "ok": true }`) |
| `/stats` | `GET` | Request stats, per-relay counts, active connections |

## SOCKS5 Server Mode

When `--socks5-port` is set, relayrad starts a second listener that speaks the SOCKS5 protocol directly. This lets tools that natively support SOCKS5 (curl, browsers, proxychains) connect without the HTTP CONNECT wrapper.

```bash
bun run start -- --socks5-port 1080
# logs: relayrad SOCKS5 listening on socks5://127.0.0.1:1080
```

The SOCKS5 server uses its own relay selector (independent from the HTTP proxy). Requests are logged and tracked in stats identically.

## Proxy Authentication

When `--proxy-auth user:pass` is set, all proxy requests (both HTTP and CONNECT) require a `Proxy-Authorization: Basic ...` header. API endpoints (`/relays`, `/health`, `/stats`, etc.) are not affected.

```bash
# Start with auth
bun run start -- --proxy-auth admin:secret123

# Requests without auth get 407
curl -x http://127.0.0.1:4123 http://example.com
# => 407 Proxy Authentication Required

# Requests with auth work
curl -x http://127.0.0.1:4123 --proxy-user admin:secret123 http://example.com
```

Auth is **off by default**. Without `--proxy-auth`, all proxy requests are accepted without credentials.

## Error Handling

- Invalid JSON in `POST /rotate` -> `400`
- Invalid non-proxy request URL -> `400`
- Upstream proxy failure -> `502`
- Missing/invalid proxy auth (when enabled) -> `407`
- Relay load/refresh failure (missing CLI, non-zero exit, malformed output) -> explicit error message

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `RELAYRAD_HOST` | `127.0.0.1` | Bind host |
| `RELAYRAD_PORT` | `4123` | Bind port |
| `RELAYRAD_RELAY_LIST_FILE` | _unset_ | Read relay list from file instead of `mullvad relay list` |
| `RELAYRAD_SOCKS_HOST_OVERRIDE` | _unset_ | Override SOCKS hostname for all loaded relays |
| `RELAYRAD_SOCKS_PORT_OVERRIDE` | _unset_ | Override SOCKS port for all loaded relays |

## CLI Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--port`, `-p` | `4123` | HTTP proxy listen port |
| `--socks5-port` | _disabled_ | SOCKS5 listener port (enables SOCKS5 server) |
| `--proxy-auth user:pass` | _disabled_ | Require Basic auth for proxy requests |
| `--log-proxy-console` | enabled | Print one line per proxied request/CONNECT tunnel |
| `--no-log-proxy-console` | disabled | Disable default console proxy logging |
| `--log-proxy-sqlite <path>` | disabled | Log proxied requests to SQLite file |

## Proxy Logging

Only successful final relay usage is logged. Failed relay attempts are not stored. No request headers, client IPs, bodies, or full URLs are stored by this feature.

Stored fields in SQLite:

- `timestamp`
- `request_type` (`http` or `connect`)
- `destination_host`
- `destination_port`
- `relay_hostname`

## Dev Validation

```bash
bun run biome-lint
bunx tsc --noEmit
bun test
```
