# relayrad

Local rotating HTTP proxy for Mullvad relays.

`relayrad` reads relay inventory from `mullvad relay list` (or a fixture file) and exposes one stable local proxy endpoint. Each proxied request is sent through a selected relay based on your active rotation config.

## Quick Start

### Requirements

- Bun
- Mullvad CLI installed
- Host is connected to Mullvad

### Install

```bash
bun install
```

### Start

```bash
bun run start
```

Default endpoint: `http://127.0.0.1:4123`

Custom port:

```bash
bun run start -- --port 4123
```

## Basic Usage

Use `relayrad` as your HTTP proxy:

```bash
curl -x http://127.0.0.1:4123 http://httpbin.org/ip
curl -x http://127.0.0.1:4123 http://httpbin.org/ip
curl -x http://127.0.0.1:4123 http://httpbin.org/ip
```

List currently available relays:

```bash
curl 'http://127.0.0.1:4123/relays?country=usa&sort=random'
```

Update active rotation config:

```bash
curl -X POST http://127.0.0.1:4123/rotate \
  -H 'content-type: application/json' \
  -d '{"country":"usa","sort":"random","unhealthyBackoffMs":45000}'
```

Refresh relay inventory:

```bash
curl -X POST http://127.0.0.1:4123/relays/refresh
```

Health check:

```bash
curl http://127.0.0.1:4123/health
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

## Error Handling

- Invalid JSON in `POST /rotate` -> `400`
- Invalid non-proxy request URL -> `400`
- Upstream proxy failure -> `502`
- Relay load/refresh failure (missing CLI, non-zero exit, malformed output) -> explicit error message

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `RELAYRAD_HOST` | `127.0.0.1` | Bind host |
| `RELAYRAD_PORT` | `4123` | Bind port |
| `RELAYRAD_RELAY_LIST_FILE` | _unset_ | Read relay list from file instead of `mullvad relay list` |
| `RELAYRAD_SOCKS_HOST_OVERRIDE` | _unset_ | Override SOCKS hostname for all loaded relays |
| `RELAYRAD_SOCKS_PORT_OVERRIDE` | _unset_ | Override SOCKS port for all loaded relays |

## Dev Validation

```bash
bun run biome-lint
bunx tsc --noEmit
bun test
```
