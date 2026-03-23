# relayrad

Local rotating proxy that routes traffic through Mullvad relays, TOR, or both.

`relayrad` gives you one stable local proxy endpoint and rotates upstream relay paths behind it. It supports HTTP proxying, `CONNECT` tunnels, and an optional SOCKS5 server.

## Why use it?

- One local proxy endpoint: `http://127.0.0.1:4123`
- Multiple upstream sources: Mullvad, TOR, or both
- Interactive TUI on `bun run start`
- Runtime rotation API: list relays, change filters, refresh sources
- Optional SOCKS5 server, proxy auth, console logging, and SQLite logging

## Supported sources

| Source | Status | Notes |
| --- | --- | --- |
| Mullvad | Stable | Reads from `mullvad relay list` or a relay list file |
| TOR | Stable | Uses the local TOR SOCKS5 proxy and rotates circuits per request |
| NordVPN | Planned | Not implemented yet |

## Quick start

### Requirements

- Bun
- At least one upstream source:
  - Mullvad CLI in `PATH`, or
  - a Mullvad relay list file, or
  - TOR running on `127.0.0.1:9050`

### Start with the TUI

```bash
bun install
bun run start
```

The TUI lets you choose:

- Mullvad and/or TOR
- console / SQLite logging
- HTTP port
- optional SOCKS5 port
- optional proxy auth

### Start directly from CLI

```bash
# Mullvad only
bun run start -- --mullvad

# TOR only
bun run start -- --tor

# Mullvad + TOR
bun run start -- --mullvad --tor

# Skip TUI explicitly
bun run start -- --no-tui --mullvad
```

## Examples

### curl

```bash
curl -x http://127.0.0.1:4123 http://httpbin.org/ip
curl -x http://127.0.0.1:4123 http://httpbin.org/ip
curl -x http://127.0.0.1:4123 http://httpbin.org/ip
```

### Python with `requests`

```python
import requests

proxies = {
    "http": "http://127.0.0.1:4123",
    "https": "http://127.0.0.1:4123",
}

for _ in range(3):
    r = requests.get("http://httpbin.org/ip", proxies=proxies, timeout=30)
    print(r.json())
```

### SOCKS5 client mode

```bash
bun run start -- --mullvad --socks5-port 1080
curl --socks5-hostname 127.0.0.1:1080 https://api.example.com
```

## Common setups

### Mullvad only

```bash
bun run start -- --mullvad
```

### TOR only

```bash
bun run start -- --tor
```

TOR uses one local SOCKS endpoint, but `relayrad` asks TOR for fresh isolated circuits per request, so exit IPs rotate naturally.

### Mullvad without Mullvad CLI

Generate a relay file on a machine that has the CLI:

```bash
mullvad relay list > relays.txt
```

Then run:

```bash
RELAYRAD_RELAY_LIST_FILE=relays.txt bun run start -- --mullvad
```

### TOR setup

```bash
# Debian/Ubuntu
sudo apt install tor
sudo systemctl start tor

# macOS
brew install tor
brew services start tor
```

### With SQLite logging

```bash
bun run start -- --mullvad --log-proxy-sqlite ./relayrad-logs.sqlite
```

### With proxy auth

```bash
bun run start -- --mullvad --proxy-auth admin:secret123
curl -x http://127.0.0.1:4123 --proxy-user admin:secret123 http://httpbin.org/ip
```

## API

### `GET /relays`

List currently available relay endpoints.

```bash
curl 'http://127.0.0.1:4123/relays?sort=random'
curl 'http://127.0.0.1:4123/relays?exclude_country=us,de&sort=random'
```

### `POST /rotate`

Update the active rotation config at runtime.

```bash
curl -X POST http://127.0.0.1:4123/rotate \
  -H 'content-type: application/json' \
  -d '{"country":"se","sort":"random","unhealthyBackoffMs":45000}'
```

### `POST /relays/refresh`

Reload upstream relay sources.

```bash
curl -X POST http://127.0.0.1:4123/relays/refresh
```

### `GET /health`

```bash
curl http://127.0.0.1:4123/health
```

### `GET /stats`

```bash
curl http://127.0.0.1:4123/stats
```

Example response:

```json
{
  "requestsTotal": 15230,
  "failuresTotal": 42,
  "activeConnections": 5,
  "startTime": "2026-03-22T20:00:00.000Z",
  "topRelays": [
    { "hostname": "us-chi-wg-303", "requests": 230, "failures": 2 },
    { "hostname": "tor-relay", "requests": 180, "failures": 1 }
  ]
}
```

## Selection config

Use these fields in query params for `GET /relays` or JSON bodies for `POST /rotate`.

| Field | Type | Behavior |
| --- | --- | --- |
| `country` | `string` | Match by country code or country name |
| `city` | `string` | Match by city code or city name |
| `hostname` | `string` | Substring match on relay hostname |
| `provider` | `string` | Exact provider match |
| `ownership` | `owned \| rented` | Filter by ownership type |
| `exclude_country` | `string` | Comma-separated country codes/names to exclude |
| `sort` | `random \| hostname \| country \| city` | Result ordering |
| `unhealthyBackoffMs` | `number` | Skip duration after relay failure |

Sort behavior:

- `random`: randomized order
- `hostname`: lexical by hostname
- `country`: lexical by country, then city, then hostname
- `city`: lexical by city, then hostname

## CLI flags

| Flag | Default | Description |
| --- | --- | --- |
| `--mullvad` | auto | Enable Mullvad as a source |
| `--tor` | off | Enable TOR as a source |
| `--tor-port <port>` | `9050` | TOR SOCKS5 port |
| `--port`, `-p` | `4123` | HTTP proxy port |
| `--socks5-port <port>` | off | Start SOCKS5 listener |
| `--proxy-auth user:pass` | off | Require proxy auth |
| `--log-proxy-sqlite <path>` | off | Write proxy logs to SQLite |
| `--no-log-proxy-console` | off | Disable console logging |
| `--no-tui` | off | Skip interactive startup |

When no source flags are passed and `--no-tui` is not set, the TUI starts automatically in a TTY.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `RELAYRAD_HOST` | `127.0.0.1` | Bind host |
| `RELAYRAD_PORT` | `4123` | Bind port |
| `RELAYRAD_RELAY_LIST_FILE` | unset | Mullvad relay list file |
| `RELAYRAD_SOCKS_HOST_OVERRIDE` | unset | Override Mullvad SOCKS host |
| `RELAYRAD_SOCKS_PORT_OVERRIDE` | unset | Override Mullvad SOCKS port |

## Rotation notes

- Default sort is `random`
- Failed relays are marked unhealthy and skipped for `30000ms`
- `POST /rotate` changes selection behavior without restarting
- Mullvad contributes many relay endpoints
- TOR contributes one local endpoint that produces rotating circuits per request

## SOCKS5 server mode

When `--socks5-port` is set, `relayrad` starts a local SOCKS5 server in addition to the HTTP proxy.

```bash
bun run start -- --mullvad --socks5-port 1080
curl --socks5-hostname 127.0.0.1:1080 https://api.example.com
```

## Proxy auth

When `--proxy-auth user:pass` is set, proxy requests require `Proxy-Authorization: Basic ...`.
API endpoints like `/relays`, `/health`, and `/stats` stay unauthenticated.

## Error handling

- Invalid JSON in `POST /rotate` -> `400`
- Invalid non-proxy request URL -> `400`
- Upstream proxy failure -> `502`
- Missing or invalid proxy auth -> `407`
- Relay load or refresh failure -> explicit startup/runtime error message
- TOR not running when selected -> clear error with instructions

## TUI behavior

The interactive setup asks for:

- relay sources
- console / SQLite logging
- HTTP port
- optional SOCKS5 port
- optional proxy auth

The TUI is skipped automatically when:

- `--no-tui` is passed
- a source flag like `--mullvad` or `--tor` is passed
- config flags like `--port`, `--socks5-port`, `--proxy-auth`, or `--log-proxy-sqlite` are passed
- not running in a TTY

## Development

```bash
bun install
bun run biome-lint
bunx tsc --noEmit
bun test
```

## Roadmap

- Better startup/status messaging for TOR circuit mode
- More relay sources such as NordVPN
- More TUI options and presets
