# relayrad

Local rotating HTTP proxy for Mullvad relays.

`relayrad` reads relays from the local `mullvad relay list` CLI output and exposes one stable local proxy endpoint that rotates the upstream Mullvad relay on each request.

## Requirements

- Bun
- Mullvad CLI installed
- The host machine connected to Mullvad

## Install

```bash
bun install
```

## Run

Start the server:

```bash
bun run start
```

Set a custom port:

```bash
bun run start -- --port 4123
```

Default address:

```text
http://127.0.0.1:4123
```

## Examples

Rotate through relays with `curl`:

```bash
curl -x http://127.0.0.1:4123 http://httpbin.org/ip
curl -x http://127.0.0.1:4123 http://httpbin.org/ip
curl -x http://127.0.0.1:4123 http://httpbin.org/ip
```

List available relays:

```bash
curl 'http://127.0.0.1:4123/relays?country=usa&sort=hostname'
```

Restrict rotation to a country:

```bash
curl -X POST http://127.0.0.1:4123/rotate \
  -H 'content-type: application/json' \
  -d '{"country":"usa","sort":"hostname"}'
```

Refresh relays from the Mullvad CLI:

```bash
curl -X POST http://127.0.0.1:4123/relays/refresh
```

Health check:

```bash
curl http://127.0.0.1:4123/health
```

## How Rotation Works

- One local proxy endpoint (`http://127.0.0.1:4123`) forwards each request through one selected Mullvad relay.
- The runtime selection config defaults to:
  - `sort: "random"`
  - `unhealthyBackoffMs: 30000`
- If a relay fails for an upstream request, it is marked unhealthy and skipped until backoff expires.
- `POST /rotate` updates the active selection config without restarting the server.

## Selection Options

The selector accepts these fields (in query params for `GET /relays` or JSON body for `POST /rotate`):

### Filters

- `country` (string): country code or name match (case-insensitive)
- `city` (string): city code or name match (case-insensitive)
- `hostname` (string): substring match on relay hostname
- `provider` (string): exact provider match (case-insensitive)
- `ownership` (`owned` | `rented`)

### Sort Options

- `random`: random order
- `hostname`: lexical order by hostname
- `country`: lexical order by country, then city, then hostname
- `city`: lexical order by city, then hostname

### Other

- `unhealthyBackoffMs` (number): milliseconds to skip a relay after failure

## HTTP API

### `GET /relays`

Returns relay inventory after applying optional filters/sort.

Example:

```bash
curl 'http://127.0.0.1:4123/relays?country=usa&sort=random&ownership=rented'
```

Response shape:

```json
{
  "relays": [
    {
      "countryName": "Sweden",
      "countryCode": "se",
      "cityName": "Stockholm",
      "cityCode": "sto",
      "hostname": "se-sto-wg-001",
      "ipv4": "1.1.1.1",
      "ipv6": "::1",
      "protocol": "WireGuard",
      "provider": "M247",
      "ownership": "rented",
      "socks5Hostname": "se-sto-wg-socks5-001.relays.mullvad.net",
      "socks5Port": 1080
    }
  ],
  "total": 1
}
```

### `POST /rotate`

Updates active runtime selection config and returns a preview of first 10 matching relays.

Example:

```bash
curl -X POST http://127.0.0.1:4123/rotate \
  -H 'content-type: application/json' \
  -d '{"country":"usa","sort":"random","unhealthyBackoffMs":45000}'
```

### `POST /relays/refresh`

Reloads relay inventory from the configured source (Mullvad CLI by default, or file if configured).

### `GET /health`

Simple liveness endpoint returning `{ "ok": true }`.

## Error Responses

- Invalid JSON body on `POST /rotate` returns HTTP `400`.
- Invalid non-proxy request URL returns HTTP `400`.
- Upstream proxy failures return HTTP `502`.
- CLI load/refresh failures (missing command, non-zero exit, malformed output) return explicit error messages.

## Env Vars

- `RELAYRAD_HOST` default `127.0.0.1`
- `RELAYRAD_PORT` optional port override
- `RELAYRAD_RELAY_LIST_FILE` optional text fixture file path; when set, skips `mullvad relay list`
- `RELAYRAD_SOCKS_HOST_OVERRIDE` optional SOCKS hostname override applied to all loaded relays
- `RELAYRAD_SOCKS_PORT_OVERRIDE` optional SOCKS port override applied to all loaded relays

## Validation

```bash
bun test
bunx tsc --noEmit
bun run biome-lint
```
