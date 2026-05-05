# Quick start

You'll need:

- **Docker** with Compose v2 (`docker compose ...`)
- **Node.js 20+** — `setup.sh` calls `npx web-push generate-vapid-keys` to mint the keypair that signs push notifications. If Node.js isn't on PATH, setup completes but push notifications stay disabled (everything else works); install Node.js + re-run `./setup.sh --force` later to enable.
- ~2 GB free disk for the Supabase + webapp images, ~3 GB during a source build
- An **interactive terminal** for `./setup.sh` (it prompts for the URL your browser will use). Piping `setup.sh` over SSH or into a script makes it skip the prompt and silently default to `localhost:8100`, which won't work for any other device on your network. If you must run it non-interactively, set `API_EXTERNAL_URL` and `SITE_URL` in `webapp/docker/.env` *before* running `./setup.sh`.
- A free [OpenWeatherMap API key](https://openweathermap.org/api) (optional, for the weather widget)

## 1. Clone and bootstrap

```bash
git clone https://github.com/svenger87/kinboard.git
cd kinboard

# Generates webapp/docker/.env with random secrets, VAPID keys, and
# Supabase API keys. Will ask you ONE question along the way.
./setup.sh
```

### The one question setup asks

`setup.sh` will prompt: **"Where will you and your family open Kinboard?"** This is the URL your browser will use. Get it right or browser API calls fail with `ERR_CONNECTION_REFUSED`.

Pick what matches your setup:

| Your situation | Type this |
|---|---|
| Just trying it on this same machine | `http://localhost:8100` |
| Home server, family will browse from phones in the house | `http://<your-server-LAN-IP>:8100` (find with `hostname -I`) |
| Cloud server (Hetzner, DigitalOcean, etc.) | `http://<your-server-public-IP>:8100` |
| You've set up a domain + Traefik for HTTPS | `https://kinboard.your-domain.com` |

> **Don't forget the `:8100`** unless you're using Traefik. See the [URL gotchas section](Self-hosting.md#what-url-should-i-use-the-most-common-confusion) for more.

`setup.sh` auto-detects a sensible default (your public or LAN IP) so non-technical users can usually just press Enter. It's idempotent — re-running won't overwrite anything you've set manually. It:

- generates `POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRET_KEY_BASE`, `CRON_SECRET`
- mints `ANON_KEY` + `SERVICE_ROLE_KEY` (Supabase JWTs signed with `JWT_SECRET` — no need to visit supabase.com)
- runs `npx web-push generate-vapid-keys` for `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (if Node.js is installed; push notifications stay disabled otherwise)
- substitutes the keys into `kong.yml`
- copies `webapp/.env.example` to `webapp/.env.local` for dev

## 2. Bring up the stack

You have two paths. Pick one:

### Path A — Pull the pre-built image (recommended, fastest)

Skip the local build entirely. Pulls the multi-arch image (amd64 + arm64) from `ghcr.io/svenger87/kinboard:latest`. Bring-up takes **~30 sec**, runtime needs only **~512 MB RAM**, no compiler needed.

```bash
cd webapp/docker
docker compose -f docker-compose.yml -f docker-compose.image.yml up -d
```

Or, when you also want the Traefik HTTPS overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.image.yml -f docker-compose.traefik.yml up -d
```

Pin a version with `KINBOARD_TAG=1.0.1` (defaults to `:latest`).

### Path B — Build from source (if you've patched the code or want a frozen build)

```bash
cd webapp/docker
./start.sh up
```

The first build takes **~5–10 min** and peaks at **~4 GB RAM** during type-check + static-page generation. On a 4 GB VM you'll need swap (`fallocate -l 8G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`) or you'll hit OOM. Subsequent `up` calls reuse the cached image — fast.

### Both paths

`start.sh` runs migrations automatically on every `up`. The other commands work either way:

```bash
./start.sh status   # check container health
./start.sh logs     # tail logs from all services
./start.sh down     # stop everything
./start.sh restart  # rebuild webapp + restart  (Path B only — Path A skips the build)
./start.sh migrate  # re-apply migrations (rarely needed; `up` already does it)
```

> **Image-path users:** runtime overrides for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are read from `webapp/docker/.env` at container start, so the same image works for any URL — no rebuild needed when you change `SITE_URL` later.

## 3. Open the app

```
http://localhost:3001
```

You'll land on `/join` with a "Welcome — let's set things up" card because the database is empty. Pick a family name, give this device a name, and create the family. You'll get a 6-character join code — write it down. Other devices use it via the same `/join` page.

## 4. Configure integrations

Open the menu → **Settings** and walk through the integrations you care about. Each is documented separately:

- [[Integration-OpenWeatherMap]] (5 minutes, just paste the key)
- [[Integration-Google-Calendar]] (10 minutes, OAuth setup)
- [[Integration-Home-Assistant]] (15 minutes, generate a token)
- [[Integration-Immich]] / [[Integration-Bring]] / [[Integration-Cameras]] as needed

## What runs on your machine

| Container | Port | What |
|---|---|---|
| `kinboard-webapp` | 3001 | Next.js dashboard |
| `kinboard-kong` | 8100 | Supabase API gateway |
| `kinboard-db` | 5432 | PostgreSQL 15 |
| `kinboard-realtime` | (internal) | Supabase Realtime (WebSocket) |
| `kinboard-rest` | (internal) | PostgREST |
| `kinboard-storage` | (internal) | Supabase Storage |
| `kinboard-imgproxy` | (internal) | On-the-fly image transformation |
| `kinboard-auth` | (internal) | GoTrue (used minimally) |
| `kinboard-go2rtc` | 1984, 8555/udp | Camera RTSP-to-WebRTC bridge |
| `kinboard-cron` | (internal) | Ofelia scheduler for `/api/cron/*` |

Bind paths default to `./data/` (relative to `webapp/docker/`). Override with `DATA_DIR=/some/abs/path` in `.env` for NAS or external storage.

## Putting it on the wall

When you're ready to mount a touchscreen, see:

- **[[Kiosk-Windows-11-Mele-4C]]** for a Windows-11 setup (the maintainer's actual config)
- **[[Kiosk-Linux-Guidance]]** for Linux guidance

## Next

- **[[Onboarding]]** — joining additional devices, multi-family scenarios, leaving a family
- **[[Self-hosting]]** — production deployment with Traefik, backups, updates
