# Quick start

You'll need:

- **Docker** with Compose v2 (`docker compose ...`)
- **Node.js 20+** — `setup.sh` calls `npx web-push generate-vapid-keys` to mint the keypair that signs push notifications. If Node.js isn't on PATH, setup completes but push notifications stay disabled (everything else works); install Node.js + re-run `./setup.sh --force` later to enable.
- ~2 GB free disk for the Postgres + webapp images, ~3 GB during a source build
- An interactive terminal for `./setup.sh` if you want to be asked for the optional integration keys. Without one (`--non-interactive`, over SSH, in a script) it simply skips them.
- A free [OpenWeatherMap API key](https://openweathermap.org/api) (optional, for the weather widget)

> **On Windows?** Install into your WSL filesystem, not `/mnt/c/` — PostgreSQL
> cannot create its data directory on a Windows drive, and the failure looks
> like an unrelated "container kinboard-db is unhealthy". See
> [Windows (WSL) as a host](Windows-WSL-Host) first.

## 1. Clone and bootstrap

```bash
git clone https://github.com/svenger87/kinboard.git
cd kinboard

# Generates webapp/docker/.env with random secrets, VAPID keys, and
# the API keys. No questions about addresses.
./setup.sh
```

### No address to get right

Open Kinboard at whatever address reaches your server: `http://localhost:3001` on the same machine, `http://<your-server-LAN-IP>:3001` from phones and tablets at home (find the IP with `hostname -I`), your domain if you put it behind [Traefik](Self-hosting#behind-traefik) or a [Cloudflare Tunnel](Self-hosting#reverse-proxied-via-cloudflare-tunnel). Every device talks to Kinboard at the address it opened it from, so they can all differ.

`setup.sh` prints the address it expects (this machine's LAN address at home, its public address on a cloud server, `localhost` under WSL — see [Windows (WSL) as a host](Windows-WSL-Host)) and stores it as `SITE_URL`, which is only used for links Kinboard hands to other apps, like the calendar feed. Change it with `./setup.sh --url <address>`. More in [Self-hosting → What URL should I use?](Self-hosting#what-url-should-i-use).

It's idempotent — re-running won't overwrite anything you've set manually. It:

- generates `POSTGRES_PASSWORD`, `JWT_SECRET`, `CRON_SECRET`
- mints `ANON_KEY` + `SERVICE_ROLE_KEY` (JWTs signed with `JWT_SECRET` — no need to visit supabase.com)
- runs `npx web-push generate-vapid-keys` for `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (if Node.js is installed; push notifications stay disabled otherwise)
- copies `webapp/.env.example` to `webapp/.env.local` for dev

## 2. Bring up the stack

You have two paths. Pick one:

### Path A — Pull the pre-built image (recommended, fastest)

Skip the local build entirely. Pulls the multi-arch image (amd64 + arm64) from `ghcr.io/svenger87/kinboard:latest`. Bring-up takes **~30 sec**, runtime needs only **~512 MB RAM**, no compiler needed.

```bash
cd webapp/docker
./start.sh up
```

`docker-compose.yml` runs the published image on its own, so there is no second file to name. When you also want the Traefik HTTPS overlay:

```bash
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.traefik.yml" ./start.sh up
```

Pin a version with `KINBOARD_TAG=1.15.0` in `.env` (defaults to `:latest`).

> **`start.sh up` or plain `docker compose up -d` both work.** The one-shot `db-init` service aligns PostgREST's login role (`authenticator`) with `POSTGRES_PASSWORD` inside the stack before `rest` starts, so nothing has to be fixed up from the host. `start.sh up` adds a few checks on top (the data directory, retired containers from older versions, waiting for the migrations) and prints the container status at the end.

### Path B — Build from source (if you've patched the code or want a frozen build)

```bash
cd webapp/docker
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.build.yml" ./start.sh up
```

`docker-compose.build.yml` builds the webapp from this checkout and tags it `kinboard-webapp:local`, so it is never confused with a pulled image. Build from a clean checkout: a `webapp/.env.local` on the build machine ends up baked into the bundle.

The first build takes **~5–10 min** and peaks at **~4 GB RAM** during type-check + static-page generation. On a 4 GB VM you'll need swap (`fallocate -l 8G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`) or you'll hit OOM. Subsequent `up` calls reuse the cached image — fast.

### Both paths

The webapp container applies any new database migrations every time it starts, and `start.sh up` waits for that to finish. The other commands work either way:

```bash
./start.sh status   # check container health
./start.sh logs     # tail logs from all services
./start.sh down     # stop everything
./start.sh restart  # pull (Path A) or rebuild (Path B) the webapp, then restart it + cron
./start.sh migrate  # apply pending migrations by hand (rarely needed; the webapp does it on start)
```

> **No address is baked into the image.** The browser always talks to Kinboard at the address the page came from, and the anon key is read from `webapp/docker/.env` at container start, so the same image works for any URL — no rebuild needed when you change `SITE_URL` later.

## 3. Open the app

```
http://localhost:3001
```

You'll land on `/join` with a "Welcome — let's set things up" card because the database is empty. Pick a family name, give this device a name, and create the family. You'll get a 6-character join code — write it down. Other devices use it via the same `/join` page.

## 4. Configure integrations

Open the menu → **Settings** and walk through the integrations you care about. Each is documented separately:

- [OpenWeatherMap](OpenWeatherMap) (5 minutes, just paste the key)
- [Google-Calendar](Google-Calendar) (10 minutes, OAuth setup)
- [Home-Assistant](Home-Assistant) (15 minutes, generate a token)
- [Immich](Immich) / [Bring](Bring) / [Cameras](Cameras) as needed

## What runs on your machine

| Container | Port | What |
|---|---|---|
| `kinboard-webapp` | 3001 | Next.js dashboard — and everything the browser talks to: the database API at `/rest/v1`, uploaded files at `/storage/v1/…`, and live updates |
| `kinboard-db` | 5432 | PostgreSQL 15 (the `supabase/postgres` image) |
| `kinboard-db-init` | — | One-shot: aligns PostgREST's login password, then exits |
| `kinboard-rest` | (internal) | PostgREST, reached through the webapp |
| `kinboard-go2rtc` | 1984 (localhost only), 8555/udp | Camera RTSP-to-WebRTC bridge |
| `kinboard-cron` | (internal) | Ofelia scheduler for `/api/cron/*` |

One address, one port: the family only ever needs `WEBAPP_PORT` (3001).

Bind paths default to `./data/` (relative to `webapp/docker/`): `db/` for Postgres, `storage/` for uploaded files. Override with `DATA_DIR=/some/abs/path` in `.env` for NAS or external storage.

## Adding more devices

Any device on the network can join the family you just created: browse to `http://<host>:<port>/join`, tap **Join family**, and enter the 6-character code (shown at **Settings** → top of the page on any already-connected device). Give the new device a name and tap **Join** — there's no hard cap on devices per family, and everything (kitchen kiosk, phones, tablets, a dev laptop) sees the same state, kept in sync by live updates from the server.

Once a device has joined, it keeps a random device id of its own, so on future visits `/join` offers a one-tap "Welcome back" rejoin instead of asking for the code again. If the browser's site data is cleared, that id is gone and the device joins with the code once more — see [how device recognition works](Security-and-Threat-Model#how-device-recognition-works).

> **Don't share the join code over the public internet.** Anyone with the code + the URL can join your family. The model assumes a trusted LAN — see [Security-and-Threat-Model](Security-and-Threat-Model).

## Leaving or switching a family

A device belongs to exactly one family at a time. **Settings → Leave family** deletes the device's row from the family's `devices` table (the family itself stays) and clears local browser state (cookies + localStorage), landing you back on `/join`. To switch families, leave the current one and join the new one with its code.

If the device you're leaving is the last one in the family, the family's data stays in the database — any other device with the join code can re-enter later and pick up where you left off.

To wipe a fresh-install state entirely during development:

```bash
docker exec -i kinboard-db psql -U postgres -d postgres <<'EOF'
TRUNCATE families CASCADE;
EOF
```

`CASCADE` removes everything linked: devices, people, calendars, events, todos, shopping_items, etc. The schema and the demo seed (if applied) are unaffected.

## Putting it on the wall

When you're ready to mount a touchscreen, see:

- **[Kiosk-Windows-11-Mele-4C](Kiosk-Windows-11-Mele-4C)** for a Windows-11 setup (the maintainer's actual config)
- **[Kiosk-Linux-Guidance](Kiosk-Linux-Guidance)** for Linux guidance

## Next

- **[Self-hosting](Self-hosting)** — production deployment with Traefik, backups, updates
