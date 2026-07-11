# Self-hosting

This is the deeper deployment guide. If you just want to bring up the stack, see [Quick-start](Quick-start) first.

## What URL should I use? (the most common confusion)

When you run `setup.sh`, it asks **"Where will you and your family open Kinboard?"** This is the single most important answer to get right — getting it wrong is what causes the dashboard to load but show endless `ERR_CONNECTION_REFUSED` errors in the browser console.

### Why the URL matters

Kinboard's webapp talks to a Supabase API gateway (Kong) that sits in your stack. The browser running on your phone/laptop/kiosk needs to reach Kong directly — so the URL Kong listens at gets baked into the JavaScript bundle when the webapp container is built. Get it wrong and the browser tries to connect to the wrong place, and every API call fails.

### Pick the right URL for your setup

| Your setup | URL to enter |
|---|---|
| **Just trying it on the same machine** (browser + docker on your laptop) | `http://localhost:8100` |
| **Home server / NAS** (browser on phone, server in your basement) | `http://<your-server-LAN-IP>:8100` (find LAN IP with `hostname -I` on Linux, or check your router) |
| **Cloud server with no domain** (Hetzner, DigitalOcean, etc.) | `http://<your-server-public-IP>:8100` |
| **You set up a domain + Traefik for HTTPS** | `https://kinboard.your-domain.com` (no port — Traefik handles 443) |

### Common gotchas

- **Don't forget the port `:8100`** unless you're using Traefik. The webapp itself runs on `:3001` but the **API** (which the browser fetches from) runs on `:8100`. The setup script wires both correctly once you give it the URL.
- **Don't put `localhost` if anyone else will use the app.** A phone visiting `localhost` is asking its OWN device, not your server. Use the LAN IP or domain instead.
- **HTTP vs HTTPS:** plain HTTP is fine for LAN-only use. For internet-facing setups, you need HTTPS — the easiest path is the [Traefik overlay](Self-hosting#behind-traefik).
- **Behind Traefik:** if you're using Traefik, your URL is just `https://yourdomain.com` (no port, no `:8100`). Traefik routes `/rest/v1/*` and `/auth/v1/*` to Kong internally.
- **Browser console shows `CORS policy: No 'Access-Control-Allow-Origin' header`** → the Kong CORS allowlist is missing your webapp's origin. `setup.sh` writes it for you from the URL you enter. If you skipped setup or hand-edited `.env`, see [Changing the URL later](Self-hosting#changing-the-url-later) below — re-running `setup.sh` rewrites the CORS lines in `kong.yml`. (For the curious: each CORS plugin block in `webapp/docker/kong.yml` has a line marked `# webapp_origin` that `setup.sh` substitutes from `SITE_URL`. CORS can't use `*` here because credentials are sent — the spec forbids that combo.)

### Changing the URL later

If you set the wrong URL initially:

1. Edit `webapp/docker/.env` — update `API_EXTERNAL_URL`, `SITE_URL`, and `ADDITIONAL_REDIRECT_URLS` to match
2. Re-run `./setup.sh` from the repo root — it'll rewrite the `# webapp_origin` line in `kong.yml` to match your new `SITE_URL` (this step is what fixes CORS errors in the browser)
3. Restart Kong to pick up the new CORS allowlist: `docker restart kinboard-kong` (a `kong reload` is **not** enough — DB-less Kong only re-parses `kong.yml` on container start)
4. Rebuild the webapp so the JS bundle baked at build time picks up the new `API_EXTERNAL_URL`: `cd webapp/docker && ./start.sh restart`

`./setup.sh` (without `--force`) is idempotent — it won't regenerate secrets that already exist, only update the URL-driven values. `--force` regenerates everything and **invalidates existing device join codes**, so prefer the plain re-run unless you want a clean slate.



## Compose file overlay

The repo ships three compose files; you opt into them as your environment requires:

| File | Purpose | Default? |
|---|---|---|
| `webapp/docker/docker-compose.yml` | Base stack (db, kong, webapp, cron, go2rtc, ...). Ports forwarded directly to host. | Yes |
| `webapp/docker/docker-compose.traefik.yml.example` | Traefik labels for kong, webapp, go2rtc. Copy to `docker-compose.traefik.yml` and adjust. | No |
| `webapp/docker/docker-compose.override.yml` | Host-specific extras (GPU device pins, custom volumes, etc.). Gitignored. | No |

To run with all three:

```bash
export COMPOSE_FILES="-f docker-compose.yml -f docker-compose.traefik.yml -f docker-compose.override.yml"
./start.sh up
```

Or directly:

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml -f docker-compose.override.yml up -d
```

## Environment variables

All driven from `webapp/docker/.env`. The shipped `.env.example` has comments explaining each. Selected ones:

| Variable | Default | What |
|---|---|---|
| `PROJECT_NAME` | `kinboard` | Container name prefix (e.g. `kinboard-db`) |
| `DATA_DIR` | `./data` | Bind path root for db + storage volumes |
| `WEBAPP_PORT` | `3001` | Host port the webapp listens on |
| `KONG_HTTP_PORT` | `8100` | Host port for the Supabase API gateway |
| `NETWORK_SUBNET` | `10.200.0.0/24` | Internal Docker network subnet (change if it collides) |
| `TZ` | `UTC` | Timezone passed to go2rtc |
| `DOMAIN` | `kinboard.example.com` | Public domain — only consumed by the Traefik overlay |
| `TRAEFIK_CERT_RESOLVER` | `letsencrypt` | Name of your Traefik cert resolver |
| `TRAEFIK_NETWORK` | `proxy` | External network Traefik watches |

### Secrets

`POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRET_KEY_BASE`, `CRON_SECRET`, `VAPID_*` are generated by `setup.sh`. `ANON_KEY` and `SERVICE_ROLE_KEY` are JWTs signed with `JWT_SECRET` — generate them per [Supabase self-hosting docs](https://supabase.com/docs/guides/self-hosting#api-keys) and paste into `.env`. Re-run `setup.sh` after pasting; it'll substitute the values into `kong.yml` automatically.

## Behind Traefik

The repo ships a Traefik overlay that wires kong + webapp + (optional) go2rtc into an external Traefik instance. **It assumes Traefik is already running on the host with a cert resolver configured.** If you don't have Traefik yet, follow [From scratch: Traefik + Let's Encrypt](#from-scratch-traefik--lets-encrypt) below first.

### Wiring kinboard into your existing Traefik

Copy the example override:

```bash
cd webapp/docker
cp docker-compose.traefik.yml.example docker-compose.traefik.yml
```

Set in `.env`:

```
DOMAIN=kinboard.example.com
SITE_URL=https://kinboard.example.com
API_EXTERNAL_URL=https://kinboard.example.com
ADDITIONAL_REDIRECT_URLS=https://kinboard.example.com
TRAEFIK_CERT_RESOLVER=letsencrypt
TRAEFIK_NETWORK=proxy
```

The override registers two HTTP routers — Kong on `/rest|/auth|/storage|/realtime` and webapp on everything else — both behind `Host(${DOMAIN})` with the same cert resolver. Traefik prefers the longer `PathPrefix` rules first, so Kong wins for the API paths and the webapp serves the rest.

If you don't want Traefik fronting Kong on the same origin as the webapp, drop the `kong` block from the override — the webapp's `/api/*` routes proxy server-side to `http://kong:8000` over the internal Docker network anyway.

> **Re-run `setup.sh` after editing `.env`** so it re-pins Kong's CORS allow-list to the new `SITE_URL`. Without that, the browser will reject every API response with `blocked by CORS policy: origin ... is not allowed`.

### From scratch: Traefik + Let's Encrypt

If you're starting on a fresh box with no reverse proxy, this is the minimal setup. It runs Traefik in its own compose stack, with HTTP-01 ACME challenges against Let's Encrypt — no Cloudflare API token, no DNS-01 plumbing.

**Prerequisites:**
- Domain DNS A/AAAA records point at the host (`dig demo.kinboard.app` should resolve to your IP)
- Ports 80 + 443 reachable from the public internet (HTTP-01 ACME challenges hit `http://yourdomain/.well-known/acme-challenge/...`)
- Docker Engine 28+ (Engine 29 dropped legacy API <1.40 — see the version note below)

Create `/srv/traefik/docker-compose.yml` (or anywhere you like):

```yaml
services:
  traefik:
    image: traefik:v3.7
    container_name: traefik
    restart: unless-stopped
    environment:
      # Required on Docker Engine 29+ which dropped legacy API <1.40.
      # Earlier Traefik builds default to API 1.24 and crash-loop with
      # "client version 1.24 is too old". traefik:v3.7+ also fixes this.
      - DOCKER_API_VERSION=1.45
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=proxy
      - --entrypoints.web.address=:80
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.web.http.redirections.entrypoint.scheme=https
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.email=you@example.com
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.letsencrypt.acme.httpchallenge=true
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
      - --log.level=INFO
    ports:
      - 80:80
      - 443:443
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./letsencrypt:/letsencrypt
    networks:
      - proxy

networks:
  proxy:
    external: true
```

Create the external network kinboard's overlay also references, then bring Traefik up:

```bash
docker network create proxy
mkdir -p /srv/traefik/letsencrypt
cd /srv/traefik
docker compose up -d
```

Replace `you@example.com` with a real address — Let's Encrypt sends expiry warnings there if auto-renewal stalls.

Then follow [Wiring kinboard into your existing Traefik](#wiring-kinboard-into-your-existing-traefik) above.

**Firewall (UFW):** open 80/tcp and 443/tcp publicly. Close 3001 and 8100 — Traefik fronts both. If you've followed the [Hardening](#hardening) section's DOCKER-USER chain pattern, mirror the change there too (drop `--ctorigdstport 3001` and `8100`, add `80` and `443`).

**Verify:**

```bash
curl -sS -o /dev/null -w 'HTTP→HTTPS: %{http_code}\n' http://yourdomain/
# expect: HTTP→HTTPS: 301
curl -sS -o /dev/null -w 'HTTPS root: %{http_code}\n' https://yourdomain/
# expect: HTTPS root: 200
echo | openssl s_client -connect yourdomain:443 -servername yourdomain 2>/dev/null \
  | openssl x509 -noout -issuer -dates
# expect: issuer=...Let's Encrypt..., 90-day validity
```

If the cert hasn't issued after ~30 seconds, check `docker logs traefik` for ACME errors. Most failures are DNS not pointing at the host, port 80 not reachable from the internet, or rate-limit hits if you've been re-issuing during testing (Let's Encrypt caps at 50 certs per registered domain per week).

## Health endpoint

`GET /api/health` is an unauthenticated liveness probe — no family data, just `{ status, version, db }`. It's the one API route that intentionally breaks Kinboard's usual "always return 200, degrade gracefully" convention: a healthcheck needs a real failure signal, so it returns HTTP 503 (`status: "degraded", db: false`) if the database probe fails or times out (3s), and HTTP 200 (`status: "ok", db: true`) otherwise.

The webapp container's `docker-compose.yml` entry wires this in directly:

```yaml
healthcheck:
  test: ["CMD", "curl", "-sf", "http://localhost:3000/api/health"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 30s
```

`docker ps` shows `(healthy)` / `(unhealthy)` for the webapp container accordingly — useful for external monitoring (Uptime Kuma, a simple cron+curl script, Diun-adjacent tooling) without needing to poll a real page. Separately, Settings has its own **Diagnostics** section showing network/live-updates/push/integration status for troubleshooting inside the app — that's a different, family-facing check, not powered by this endpoint.

## Backing up your data

Two options, at different levels:

- **Family-level JSON export** — Settings → **Data & backup** → **Download backup**. Downloads everything the app manages for your family (events, todos, shopping, recipes, meal plans, notes, birthdays, schedules, settings) as one JSON file, excluding credentials and device data. Good for a quick "just in case" snapshot before a risky change, or for migrating a family between installs. Not a full restore mechanism by itself — there's no matching "import" flow yet, so treat it as a reference/manual-recovery backup, not a one-click restore.
- **Full database backup (`pg_dump`)** — see below. This is the complete, restorable backup: every family on the instance, all integration credentials, everything. Use this for real disaster recovery.

## Backups

The bind paths under `${DATA_DIR}` are what need backing up:

```
${DATA_DIR}/db/         # PostgreSQL data dir
${DATA_DIR}/storage/    # Supabase Storage objects (recipe images, avatars)
```

For a clean backup, snapshot the DB with `pg_dump` rather than copying `db/` while Postgres is running:

```bash
docker exec -t kinboard-db pg_dump -U postgres -F c postgres > /backups/kinboard-$(date +%F).pgdump
```

Storage objects can be `tar`'d safely while the stack is up — they're write-once.

Per-family settings live in `public.settings` (JSONB) and come along with the `pg_dump`.

## Updates

Pull the new code, re-run lint, restart the stack:

```bash
git pull
cd webapp/docker
./start.sh restart   # rebuilds webapp + restarts webapp + cron
```

Schema changes ship as new files in `webapp/docker/migrations/` (idempotent — safe to re-apply). Run them:

```bash
cd webapp/docker
./start.sh migrate
```

For a remote deploy, `webapp/deploy.sh` syncs the source tree over SSH and runs the migrations + rebuild on the target. Configure host details in `deploy-config.local.sh` (gitignored) — see `deploy-config.local.sh.example` for the template.

### Live-host migrations

If you're upgrading an existing deployment to the new templated compose layout (the one this repo currently ships), use `webapp/docker/migrate-prod.sh` on the host:

```bash
ssh nas
cd /mnt/user/appdata/kinboard/webapp/docker
./migrate-prod.sh --dry-run    # preview
./migrate-prod.sh               # apply
```

It's idempotent. It appends new templated env keys (`DATA_DIR`, `DOMAIN`, etc.), substitutes Supabase JWTs into `kong.yml`, renders `docker-compose.traefik.yml` from the example, and creates a `docker-compose.override.yml` for any host-specific extras.

### Auto-updates

The recommended path is the **Diun + webhook overlay** (`docker-compose.diun.yml.example`). It runs the FULL upgrade sequence end-to-end whenever a new GHCR image lands:

1. `git pull --ff-only origin main` — picks up new `docker-compose.yml`, `kong.yml`, migrations, `init.sql`, `seed-demo.sql`
2. `./setup.sh --non-interactive` — re-substitutes Kong placeholders if a new release shipped new keys/routes
3. `docker compose pull --ignore-buildable` — pulls the new GHCR image(s); skips the locally-built webhook image
4. `docker compose up -d` (with webhook + diun excluded — see below) — recreates only services whose image changed; the webapp's entrypoint re-applies all `migration_*.sql` on boot (idempotent)
5. `docker restart kinboard-kong` — only when `kong.yml`'s mtime moved during the run

Two containers do this:
- **Diun** (`crazymax/diun`) — image notifier. Polls GHCR every 30 min, detects new digests on services labeled `diun.enable=true`, fires a webhook. Read-only docker socket.
- **Webhook** — locally-built image (`Dockerfile.webhook`, ~70 MB Alpine + git + docker CLI + openssl + the webhook binary from adnanh/webhook). Validates the HMAC token in the `X-Diun-Token` header against `DIUN_WEBHOOK_SECRET`, then executes `kinboard-self-update.sh`. RW docker socket + RW project bind-mount.

Neither container is exposed externally; both sit on the internal `kinboard` docker network.

#### Required `.env` keys

`setup.sh` writes all four on first run (and appends any that are missing on re-run):

| Key | What it is |
|---|---|
| `DIUN_WEBHOOK_SECRET` | HMAC shared between Diun and webhook. Auto-generated. |
| `KINBOARD_PROJECT_DIR` | Absolute host path to the kinboard repo. The webhook bind-mounts this AT THE SAME PATH inside the container so docker-compose's relative paths resolve identically inside and outside. Auto-detected from `setup.sh`'s own location. |
| `COMPOSE_PROJECT_NAME` | Should be `kinboard`. Without this, compose derives the project name from the cwd (`docker` if you `cd webapp/docker` first), which renames the network and breaks subnet reuse if you migrated from an older flat layout. |
| `COMPOSE_FILES` | Space-separated `-f …` overlay flags. **Do NOT wrap in literal `"…"`** — the value gets expanded inside the shell script and embedded quotes break word-splitting. |

#### Bring up the overlay

```bash
cd webapp/docker
cp docker-compose.diun.yml.example docker-compose.diun.yml
# Make sure these are set in .env (setup.sh auto-creates them on first run):
#   DIUN_WEBHOOK_SECRET=<random hex>
#   KINBOARD_PROJECT_DIR=/absolute/host/path/to/kinboard
#   COMPOSE_PROJECT_NAME=kinboard
#   COMPOSE_FILES=-f docker-compose.yml -f docker-compose.image.yml -f docker-compose.traefik.yml -f docker-compose.diun.yml
# Then, from the project root:
./setup.sh --non-interactive
cd webapp/docker
docker compose -f docker-compose.yml -f docker-compose.image.yml -f docker-compose.traefik.yml -f docker-compose.diun.yml up -d --build
```

The overlay adds a `diun.enable=true` label to the kinboard-webapp service so Diun knows to watch its image. Only that container is watched by default — auto-bumping the Postgres image is not safe; if you want Diun to watch additional services, add the same label to them in `docker-compose.override.yml`.

The webhook image gets built locally on first `up --build` from `webapp/docker/Dockerfile.webhook`. The upstream `almir/webhook` image ships only the webhook binary (no git, no docker CLI), so we layer those on top of an Alpine base.

#### Tuning the cadence

Edit `webapp/docker/diun/diun.yml` — `watch.schedule` is a cron expression (default: every 30 min). The GHCR build itself takes ~4 min after a tag push, so polling more aggressively than every 5 min wastes Diun's API budget on GHCR.

#### Tail the update log

Each run of `kinboard-self-update.sh` appends timestamped lines to `/var/lib/kinboard-update/kinboard-update.log` on the host:

```bash
tail -f /var/lib/kinboard-update/kinboard-update.log
```

#### Manually trigger an update (without waiting for Diun)

```bash
docker exec kinboard-webhook /scripts/kinboard-self-update.sh
```

Same script, same code path. Useful right after pushing a hotfix when you don't want to wait for the next 30-min Diun tick.

#### Updating the auto-updater itself

The script intentionally **excludes** the `webhook` and `diun` services from `docker compose up -d` — it's currently executing inside the webhook container, and recreating that container mid-run would SIGKILL the script before it finishes (half-done state, kong restart skipped, etc.). To pick up new versions of `Dockerfile.webhook`, `kinboard-self-update.sh`, `diun.yml`, or `hooks.yaml`, run from the host:

```bash
cd webapp/docker
docker compose -f docker-compose.yml -f docker-compose.image.yml -f docker-compose.traefik.yml -f docker-compose.diun.yml \
  up -d --build webhook diun
```

#### What you give up

- **Surprise restarts.** When an update lands, the webapp container is recreated — ~30 seconds of downtime. Tabs lose their realtime websocket and reconnect.
- **Reading release notes before they apply.** If you want "see what changed → decide → apply" semantics, don't enable the overlay; track the [release notes](https://github.com/svenger87/kinboard/releases) and run `kinboard-self-update.sh` manually after each release you actually want.
- **The trust boundary.** The webhook container has rw access to `/var/run/docker.sock` and the project directory. Anything with that access can effectively run as root on the host. Same blast radius as Watchtower or any other update agent — Diun-the-detector itself only needs read-only socket access.

#### Migrating from a flat appdata layout

If your existing install lives at e.g. `/mnt/user/appdata/kinboard/docker-compose.yml` (compose files at the top level, not under `webapp/docker/`), the self-update flow won't work as-is — the webhook script expects the standard repo layout. To migrate without losing data:

```bash
cd /mnt/user/appdata/kinboard
docker compose down            # graceful stop, bind-mounts unaffected
mkdir -p /tmp/kinboard-preserve
cp .env docker-compose.override.yml /tmp/kinboard-preserve/   # secrets + customizations
find . -maxdepth 1 -type f -delete                             # wipe top-level configs
git init -q && git remote add origin https://github.com/svenger87/kinboard.git
git fetch --depth=1 origin main && git checkout -t origin/main
cp /tmp/kinboard-preserve/.env webapp/docker/.env
cp /tmp/kinboard-preserve/docker-compose.override.yml webapp/docker/docker-compose.override.yml
# DATA_DIR + COMPOSE_PROJECT_NAME both critical here:
sed -i 's|^DATA_DIR=.*|DATA_DIR=/mnt/user/appdata/kinboard|' webapp/docker/.env
grep -q ^COMPOSE_PROJECT_NAME webapp/docker/.env || echo "COMPOSE_PROJECT_NAME=kinboard" >> webapp/docker/.env
./setup.sh --non-interactive   # regenerates kong.yml substitutions, fills new keys
cp webapp/docker/docker-compose.diun.yml.example webapp/docker/docker-compose.diun.yml
cd webapp/docker
docker compose -f docker-compose.yml -f docker-compose.image.yml -f docker-compose.traefik.yml \
              -f docker-compose.override.yml -f docker-compose.diun.yml up -d --build
```

The data dirs (`db/`, `backups/`, `storage/`) stay at `/mnt/user/appdata/kinboard/` because `DATA_DIR` is set absolutely. Only the config files moved.

#### Watchtower migration (deprecated path)

The previous `docker-compose.watchtower.yml.example` overlay still works for backwards compatibility but is **deprecated**: containrrr/watchtower was archived upstream in 2024, and even before that it only updated images — it did NOT git-pull new compose/kong.yml or re-run `setup.sh`, so any release that shipped config alongside the image silently left Watchtower-driven installs in a broken state. To migrate:

```bash
cd webapp/docker
cp docker-compose.watchtower.yml docker-compose.watchtower.yml.disabled  # keep as a backup
cp docker-compose.diun.yml.example docker-compose.diun.yml
# Update your COMPOSE_FILES to swap watchtower → diun
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.image.yml -f docker-compose.diun.yml" \
  ./start.sh up
docker rm -f kinboard-watchtower
```

## Common deployment shapes

### LAN-only on a NAS (no public internet)

- Skip Traefik. Hit `http://<nas-ip>:3001` directly.
- Keep `WEBAPP_PORT=3001` (or expose any port you like).
- No HTTPS — fine inside a trusted network. **Don't expose this to the internet without auth in front.**

> **Trade-off without HTTPS: push notifications and PWA install won't work.** Browsers gate the Service Worker API, Push API, and the install prompt on a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) (HTTPS, or `http://localhost` from the *same* machine). On a phone visiting `http://192.168.x.x:3001`, registering for push silently fails and "Add to Home Screen" produces a regular shortcut without offline support. Everything else (live sync via Supabase Realtime, all integrations, all UI) keeps working — push + PWA install are the only features lost. If you need them on a LAN-only setup, the easiest paths are: (a) issue a self-signed cert and trust it on every device (rough); (b) use a [Cloudflare Tunnel](#reverse-proxied-via-cloudflare-tunnel) which gives you HTTPS without opening ports; or (c) terminate TLS on the NAS itself with Traefik + a private CA you control. See [Notifications → Requirements](Notifications#requirements) for the full constraint list.

### Behind Traefik with Cloudflare DNS-01

- Traefik configured with Cloudflare cert resolver (or whichever you use).
- `DOMAIN` and `TRAEFIK_CERT_RESOLVER` set in `.env`.
- Traefik watches the `proxy` external network (`TRAEFIK_NETWORK=proxy`).

### Reverse-proxied via Cloudflare Tunnel

- Same as the LAN-only setup but with a `cloudflared` tunnel pointing at `http://<nas-ip>:3001`.
- No port-forwarding required.
- Cloudflare Access can add a login layer in front of `/join` if you want public-internet exposure with auth.

## Pitfalls and gotchas

- **`docker-compose up -d --no-deps webapp` won't pick up override files**: Compose only auto-loads `docker-compose.override.yml`, not `docker-compose.traefik.yml`. Always pass `-f` flags explicitly when restarting individual services.
- **The `storage` container's healthcheck is flaky upstream**: it sometimes shows `unhealthy` even while serving requests fine. This is a known Supabase issue, not a Kinboard regression.
- **Internal subnet `10.200.0.0/24`**: collides with some VPNs. Override via `NETWORK_SUBNET` in `.env`.
- **`init.sql` runs once on first DB init**, never again. Subsequent schema changes ship as `webapp/docker/migration*.sql` files; `start.sh up` applies them on every boot (idempotent — guarded with `IF NOT EXISTS`).
- **`kong.yml` placeholders**: if you cloned a fresh repo, kong starts with `REPLACE_WITH_*` literals as JWTs. `setup.sh` (and `migrate-prod.sh`) substitute the real values from `.env`. If you skip that step, every API call returns 401.
- **Browser shows 400 on `/rest/v1/devices?...&hardware_id=eq...`**: the migration that adds `devices.hardware_id` and `devices.fingerprint` didn't run. Run `cd webapp/docker && ./start.sh migrate` to apply all pending migrations + reload PostgREST's schema cache. (Fresh installs since the auto-migrate change shouldn't hit this — `start.sh up` calls `migrate` for you.)

## Related

- [Quick-start](Quick-start) — the bring-up, first family, joining devices
- [Notifications](Notifications) — VAPID + cron details
- [Architecture](Architecture#database-schema) — what's in Postgres
- [Troubleshooting](Troubleshooting) — when it breaks
