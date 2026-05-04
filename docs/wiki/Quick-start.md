# Quick start

You'll need:

- **Docker** with Compose v2 (`docker compose ...`)
- **Node.js 20+** if you want to run the dev server locally; not required for the production stack
- ~2 GB free disk for the Supabase + webapp images
- A free [OpenWeatherMap API key](https://openweathermap.org/api) (optional, for the weather widget)

## 1. Clone and bootstrap

```bash
git clone https://github.com/svenger87/familyboard.git
cd familyboard

# Generates webapp/docker/.env with random secrets, VAPID keys, and
# Supabase API keys. Will ask you ONE question along the way.
./setup.sh
```

### The one question setup asks

`setup.sh` will prompt: **"Where will you and your family open Familyboard?"** This is the URL your browser will use. Get it right or browser API calls fail with `ERR_CONNECTION_REFUSED`.

Pick what matches your setup:

| Your situation | Type this |
|---|---|
| Just trying it on this same machine | `http://localhost:8100` |
| Home server, family will browse from phones in the house | `http://<your-server-LAN-IP>:8100` (find with `hostname -I`) |
| Cloud server (Hetzner, DigitalOcean, etc.) | `http://<your-server-public-IP>:8100` |
| You've set up a domain + Traefik for HTTPS | `https://familyboard.your-domain.com` |

> **Don't forget the `:8100`** unless you're using Traefik. See the [URL gotchas section](Self-hosting.md#what-url-should-i-use-the-most-common-confusion) for more.

`setup.sh` auto-detects a sensible default (your public or LAN IP) so non-technical users can usually just press Enter. It's idempotent — re-running won't overwrite anything you've set manually. It:

- generates `POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRET_KEY_BASE`, `CRON_SECRET`
- mints `ANON_KEY` + `SERVICE_ROLE_KEY` (Supabase JWTs signed with `JWT_SECRET` — no need to visit supabase.com)
- runs `npx web-push generate-vapid-keys` for `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (if Node.js is installed; push notifications stay disabled otherwise)
- substitutes the keys into `kong.yml`
- copies `webapp/.env.example` to `webapp/.env.local` for dev

## 2. Bring up the stack

```bash
cd webapp/docker
./start.sh up
```

The first run pulls images (~1.5 GB), builds the webapp container, and applies all schema migrations to the fresh database (idempotent — re-running `up` is safe). After that:

```bash
./start.sh status   # check container health
./start.sh logs     # tail logs from all services
./start.sh down     # stop everything
./start.sh restart  # rebuild webapp + restart
./start.sh migrate  # re-apply migrations (rarely needed; `up` already does it)
```

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
| `familyboard-webapp` | 3001 | Next.js dashboard |
| `familyboard-kong` | 8100 | Supabase API gateway |
| `familyboard-db` | 5432 | PostgreSQL 15 |
| `familyboard-realtime` | (internal) | Supabase Realtime (WebSocket) |
| `familyboard-rest` | (internal) | PostgREST |
| `familyboard-storage` | (internal) | Supabase Storage |
| `familyboard-imgproxy` | (internal) | On-the-fly image transformation |
| `familyboard-auth` | (internal) | GoTrue (used minimally) |
| `familyboard-go2rtc` | 1984, 8555/udp | Camera RTSP-to-WebRTC bridge |
| `familyboard-cron` | (internal) | Ofelia scheduler for `/api/cron/*` |

Bind paths default to `./data/` (relative to `webapp/docker/`). Override with `DATA_DIR=/some/abs/path` in `.env` for NAS or external storage.

## Putting it on the wall

When you're ready to mount a touchscreen, see:

- **[[Kiosk-Windows-11-Mele-4C]]** for a Windows-11 setup (the maintainer's actual config)
- **[[Kiosk-Linux-Guidance]]** for Linux guidance

## Next

- **[[Onboarding]]** — joining additional devices, multi-family scenarios, leaving a family
- **[[Self-hosting]]** — production deployment with Traefik, backups, updates
