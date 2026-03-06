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
curl 'http://127.0.0.1:4123/relays?country=se&sort=hostname'
```

Restrict rotation to a country:

```bash
curl -X POST http://127.0.0.1:4123/rotate \
  -H 'content-type: application/json' \
  -d '{"country":"se","sort":"hostname"}'
```

Refresh relays from the Mullvad CLI:

```bash
curl -X POST http://127.0.0.1:4123/relays/refresh
```

Health check:

```bash
curl http://127.0.0.1:4123/health
```

## Env Vars

- `RELAYRAD_HOST` default `127.0.0.1`
- `RELAYRAD_PORT` optional port override
- `RELAYRAD_RELAY_LIST_FILE` optional fixture file instead of calling `mullvad relay list`
- `RELAYRAD_SOCKS_HOST_OVERRIDE` optional SOCKS host override for testing
- `RELAYRAD_SOCKS_PORT_OVERRIDE` optional SOCKS port override for testing

## Validation

```bash
bun test
bunx tsc --noEmit
bun run biome-lint
```
