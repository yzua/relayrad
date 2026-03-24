# relayrad

Local rotating proxy. One endpoint, ~9600 rotating IPs.

```
curl -x http://127.0.0.1:4123 http://httpbin.org/ip   # Mullvad relay
curl -x http://127.0.0.1:4123 http://httpbin.org/ip   # NordVPN server
curl -x http://127.0.0.1:4123 http://httpbin.org/ip   # TOR circuit
```

## Sources

| Source | Relays | Auth | Install needed |
| --- | --- | --- | --- |
| Mullvad | ~580 | None | No |
| NordVPN | ~9000 | Service credentials | No |
| TOR | 1 endpoint (routes through entire TOR network) | None | Yes (local tor) |

## Quick start

```bash
bun install
bun run start           # interactive TUI
bun run start -- --mullvad --nordvpn   # skip TUI
```

**NordVPN** needs service credentials. Get them at:
`https://my.nordaccount.com/dashboard/nordvpn/manual-configuration/service-credentials/`

```bash
cp .env.example .env
# fill in NORDVPN_USERNAME and NORDVPN_PASSWORD
source .env && bun run start -- --mullvad --nordvpn
```

**TOR** needs a local tor daemon:

```bash
# Debian/Ubuntu
sudo apt install tor && sudo systemctl start tor

# macOS
brew install tor && brew services start tor
```

## Usage

```bash
# curl
curl -x http://127.0.0.1:4123 http://httpbin.org/ip

# Python
proxies = {"http": "http://127.0.0.1:4123", "https": "http://127.0.0.1:4123"}
requests.get("http://httpbin.org/ip", proxies=proxies)

# SOCKS5 mode
bun run start -- --mullvad --socks5-port 1080
curl --socks5-hostname 127.0.0.1:1080 https://api.example.com

# Proxy auth
bun run start -- --mullvad --proxy-auth admin:secret123
curl -x http://127.0.0.1:4123 --proxy-user admin:secret123 http://httpbin.org/ip
```

## API

| Endpoint | Description |
| --- | --- |
| `GET /relays` | List available relays |
| `POST /rotate` | Change rotation config |
| `POST /relays/refresh` | Reload sources |
| `GET /health` | Health check |
| `GET /stats` | Request stats |

```bash
# filter by country, exclude some
curl 'http://127.0.0.1:4123/relays?country=se&exclude_country=us,de&sort=random'

# change rotation at runtime
curl -X POST http://127.0.0.1:4123/rotate \
  -H 'content-type: application/json' \
  -d '{"sort":"random","unhealthyBackoffMs":45000}'
```

## CLI flags

| Flag | Default | Description |
| --- | --- | --- |
| `--mullvad` | auto | Mullvad source |
| `--tor` | off | TOR source |
| `--nordvpn` | off | NordVPN source |
| `--port`, `-p` | `4123` | HTTP proxy port |
| `--socks5-port` | off | SOCKS5 listener port |
| `--proxy-auth` | off | `user:pass` for incoming proxy auth |
| `--tor-port` | `9050` | TOR SOCKS5 port |
| `--log-proxy-sqlite` | off | SQLite log path |
| `--no-log-proxy-console` | off | Disable console logs |
| `--no-tui` | off | Skip interactive setup |

## Environment variables

| Variable | Description |
| --- | --- |
| `RELAYRAD_HOST` | Bind host (default `127.0.0.1`) |
| `RELAYRAD_PORT` | Bind port (default `4123`) |
| `NORDVPN_USERNAME` | NordVPN service username |
| `NORDVPN_PASSWORD` | NordVPN service password |

See `.env.example` for all options.

## Selection config

Fields for `GET /relays?...` and `POST /rotate` body:

| Field | Type | Example |
| --- | --- | --- |
| `country` | string | `se`, `germany` |
| `city` | string | `stockholm` |
| `hostname` | string | substring match |
| `exclude_country` | string | `us,de` (comma-separated) |
| `sort` | `random`, `hostname`, `country`, `city` | default: `random` |
| `unhealthyBackoffMs` | number | default: `30000` |

Mullvad-specific fields (only meaningful when filtering Mullvad relays):

| Field | Type | Example | Notes |
| --- | --- | --- | --- |
| `provider` | string | `iRegister`, `M247` | Mullvad lists hosting provider per server |
| `ownership` | `owned` or `rented` | | Mullvad owns some servers, rents others |

NordVPN relays always have `provider: "nordvpn"`, `ownership: "rented"`.
TOR relay has `provider: "tor-project"`, `ownership: "owned"`.

## How it works

- Failed relays are marked unhealthy and skipped for 30s
- `POST /rotate` changes behavior without restart
- Mullvad: SOCKS5 per server, no auth, public endpoints
- NordVPN: HTTPS proxy on port 89, requires service credentials
- TOR: one local SOCKS5 endpoint (localhost:9050), but TOR internally routes through thousands of relays and rotates circuits per request

## Development

```bash
bun install
bun run biome-lint
bunx tsc --noEmit
bun test
```
