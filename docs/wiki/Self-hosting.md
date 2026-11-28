# Self-hosting

This is the deeper deployment guide. If you just want to bring up the stack, see [Quick-start](Quick-start) first. To run Kinboard from a Compose UI (OpenMediaVault, Portainer, Unraid, Dockge) with the one-file install, from 1.18, see [Compose UIs](Compose-UIs).

## What URL should I use?

**Whichever address reaches your server.** The browser talks to Kinboard's API at the address it opened Kinboard from, so there is nothing to get right in advance: the kitchen tablet can use `http://192.168.1.50:3001`, your phone `https://kinboard.example.com`, and both work against the same stack at the same time.

| Your setup | Open Kinboard at |
|---|---|
| **Just trying it on the same machine** | `http://localhost:3001` |
| **Home server / NAS** (phones and tablets in the house) | `http://<your-server-LAN-IP>:3001` (find it with `hostname -I`, or in your router) |
| **Cloud server with no domain** | `http://<your-server-public-IP>:3001` |
| **A domain, through Traefik or a Cloudflare Tunnel** | `https://kinboard.your-domain.com` |

`setup.sh` no longer asks. It prints the address it expects you to use and stores it as `SITE_URL`, which is only used for links Kinboard hands to other apps (the calendar feed you subscribe to on your phone). `./setup.sh --url https://kinboard.example.com` changes it.

### How it works

Everything a browser needs comes from one container, the webapp, on one port (`WEBAPP_PORT`, 3001): the pages, the database API at `/rest/v1` (which the webapp forwards to PostgREST inside the stack), uploaded files at `/storage/v1/object/…`, and the live-update feed that keeps every screen in sync. One address, one port, no CORS, and a tablet at home keeps working when the internet is down, because it never leaves the house.

There is nothing to configure for this. The webapp also refuses the `service_role` key on `/rest/v1` from outside, on every install — that key bypasses row-level security and is only ever used by server code talking to PostgREST directly.

### Installs from before 1.15

Until 1.15 a separate API gateway (Kong) sat in the stack, and some installs had it answering on port 3001 (`KINBOARD_ENTRY=kong`) or kept the API on its own port and address (`API_EXTERNAL_URL`, port 8100). Those settings are ignored now: a line left in `.env` does no harm, and an old `API_EXTERNAL_URL` pointing at port 8100 is simply not used, because the browser no longer goes there. If a reverse proxy sent `/rest`, `/storage` or `/realtime` to Kong, send everything to the webapp instead. [UPGRADING.md](https://github.com/svenger87/kinboard/blob/main/UPGRADING.md#115--one-container-serves-everything) has the full upgrade notes.

### Common gotchas

- **Don't use `localhost` on other devices.** A phone visiting `localhost` is asking itself, not your server.
- **HTTP vs HTTPS:** plain HTTP is fine on the LAN. Push notifications, the barcode scanner's live camera and "Add to Home Screen" need HTTPS. [HTTPS](HTTPS) lists what needs it and the ways to get it, shortest first: Tailscale, a reverse proxy, a [Cloudflare Tunnel](#reverse-proxied-via-cloudflare-tunnel) or [Traefik](#behind-traefik).

### Changing the address later

There's nothing to change for the browser. For `SITE_URL` (calendar-feed links), run `./setup.sh --url <address>` from the repo root, then `cd webapp/docker && ./start.sh up` so the webapp picks it up.

`./setup.sh` without `--force` is idempotent: it won't regenerate secrets that already exist, and fills in only what is missing. `--force` regenerates everything, passwords included, and an existing database accepts only the password it was created with, so `--force` stops when `DATA_DIR` holds one. `--force --new-passwords` goes ahead anyway; the database then needs the new password ([Troubleshooting](Troubleshooting#startsh-up-says-env-is-missing-or-env-keeps-disappearing)).

## Compose file overlay

The repo ships a base compose file and a few overlays; you opt into them as your environment requires:

| File | Purpose | Default? |
|---|---|---|
| `compose.yml` (repository root) | **From 1.18.** The one-file install: the whole stack in one file for a Compose UI or `docker compose up -d`, with no git checkout and no `.env`. Not an overlay, and not read by `start.sh`; see [Compose UIs](Compose-UIs). The Traefik overlay applies to it too. | For one-file installs |
| `webapp/docker/docker-compose.yml` | Base stack: `db`, `db-init`, `rest`, `webapp`, `cron`, `go2rtc`. Runs the published image `ghcr.io/svenger87/kinboard:${KINBOARD_TAG:-latest}`; ports forwarded directly to the host. | Yes |
| `webapp/docker/docker-compose.traefik.yml` | Traefik labels: one router, everything on `DOMAIN` to the webapp (go2rtc optional). | No |
| `webapp/docker/docker-compose.build.yml` | Builds the webapp from this checkout instead of pulling it (tagged `kinboard-webapp:local`). | No |
| `webapp/docker/docker-compose.image.yml` | Optional since 1.15: only adds `pull_policy: always`. Kept so `COMPOSE_FILES` lines that name it keep working. | No |
| `webapp/docker/docker-compose.override.yml` | Host-specific extras (GPU device pins, custom volumes, a `cloudflared` container, etc.). Gitignored. | No |

To run with Traefik and an override:

```bash
export COMPOSE_FILES="-f docker-compose.yml -f docker-compose.traefik.yml -f docker-compose.override.yml"
./start.sh up
```

Or directly:

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml -f docker-compose.override.yml up -d --remove-orphans
```

## Environment variables

In a git install, all driven from `webapp/docker/.env`. The shipped `.env.example` has comments explaining each. A one-file install reads only the few in [Compose UIs → Variables](Compose-UIs#variables). Selected ones:

| Variable | Default | What |
|---|---|---|
| `PROJECT_NAME` | `kinboard` | Container name prefix (e.g. `kinboard-db`) |
| `DATA_DIR` | `./data` | Bind path root for db + storage volumes |
| `WEBAPP_PORT` | `3001` | The port the family opens Kinboard at — the app, its API, uploaded files and live updates all answer here |
| `KINBOARD_TAG` | `latest` | Which published image to run: `latest` (stable), `next` (release candidates) or an exact version. See [Pre-release channel](#pre-release-channel) |
| `NETWORK_SUBNET` | `10.200.0.0/24` | Internal Docker network subnet (change if it collides) |
| `TZ` | `UTC` | Timezone passed to go2rtc |
| `DOMAIN` | `kinboard.example.com` | Public domain — only consumed by the Traefik overlay |
| `TRAEFIK_CERT_RESOLVER` | `letsencrypt` | Name of your Traefik cert resolver |
| `TRAEFIK_NETWORK` | `proxy` | External network Traefik watches |
| `PHOTON_URL` | *(empty)* | The place search behind the calendar's Location field. Empty: komoot's public [Photon](https://photon.komoot.io) (free, no key). Point it at your own Photon to keep those searches on your network |
| `PUID`, `PGID` | *(empty)* | The numeric user and group the webapp runs as and the uploaded files (`DATA_DIR/storage/files`) belong to, for a NAS share owned by your own user: `99`/`100` on Unraid, usually `1000`/`1000` elsewhere. Empty keeps `1001:1001`. After a change, the next start hands the uploaded files over once. PostgreSQL and PostgREST keep their images' own users |

### Secrets

Where they live depends on how Kinboard was installed.

| Install | Secrets in | Made by |
|---|---|---|
| **Git install** (`git clone`, `setup.sh`, `webapp/docker/docker-compose.yml`) | `webapp/docker/.env` | `setup.sh` |
| **One-file install** (`compose.yml`, from 1.18) | one file each in the config volume or folder, under `secrets/` | `kinboard-init`, at every start |
| **Git install moved to `compose.yml`** ([how](Compose-UIs#moving-a-git-install-to-this-file)) | `config/secrets/` next to `db/` and `storage/` in its data folder, copied there from the `KINBOARD_` variables at the first start | `kinboard-init` |

**In a git install**, `POSTGRES_PASSWORD`, `JWT_SECRET`, `CRON_SECRET`, `VAPID_*` are generated by `setup.sh`. `ANON_KEY` and `SERVICE_ROLE_KEY` are JWTs signed with `JWT_SECRET`, and `setup.sh` mints those too. `ANON_KEY` is what the browser sends before it has a family token; `SERVICE_ROLE_KEY` is for server code only, and the webapp refuses it on `/rest/v1` from outside.

**In a one-file install** (from 1.18), the `kinboard-init` step runs before anything else at every start and fills in what is missing. The files:

| File | Holds |
|---|---|
| `postgres_password` | the database password |
| `jwt_secret` | the key that signs the tokens screens read their data with, and links to uploaded files |
| `db_uri` | PostgREST's connection string, kept in step with `postgres_password` at every start |
| `cron_secret` | what the scheduled jobs authenticate with |
| `presence_sensor_token` | the presence sensor's token, until a family sets its own in Settings |
| `vapid_public_key`, `vapid_private_key` | the push notification key pair |

The anon and service-role keys are not stored: the webapp works them out from `jwt_secret` every time it starts, so they can't disagree with it. The folder is mode `0750` and the files `0640`, owned by `root` and group `0` (PostgREST runs as uid 1000 in group 0 and has to read two of them). On a share that ignores permissions, `kinboard-init` warns and names the files.

For each secret, `kinboard-init` takes the first of:

1. a value passed in under its `KINBOARD_` name (`KINBOARD_JWT_SECRET` for `jwt_secret`, and so on). Only an install moved over from git sets these. It is written into the file, and a different file that was there is kept as `<name>.previous-<time>`;
2. the file that is already there;
3. a new random value (32 random bytes as hex; for push, a new key pair).

It logs one line per secret, `kept`, `generated`, `taken from .env` or `replaced from .env (previous kept)`, and never a value. Two cases make it refuse, and then nothing starts, because the database takes its password at its first start and never reads it again:

- `KINBOARD_POSTGRES_PASSWORD` differs from the stored `postgres_password`. The log says which to remove.
- `postgres_password` is missing while the database already exists (a database restored without its config). Restore `config/secrets/postgres_password` from the backup, or set `KINBOARD_POSTGRES_PASSWORD` to the database's password.

**What a file may contain.** One value. Its value is the content without a leading byte-order mark and without trailing line breaks (`\n`, `\r\n`); spaces and tabs count, wherever they are. A file saved by Windows Notepad, with a byte-order mark or a Windows line ending, is rewritten without them at the next start, because the database would read it differently from the webapp. A value passed in that starts with a byte-order mark or ends in a line break is refused. Symlinks and anything else that isn't a plain file are refused. Half a push key pair passed in, with the other half neither passed in nor stored, is refused; half a pair on disk makes `kinboard-init` generate both again, and every device then has to turn notifications on again.

**A new value for a secret:** delete its file in `secrets/`, then stop the stack and start it again (Down, then Up), so every container reads the new one. Not `postgres_password`: `kinboard-init` refuses to replace that while the database exists. A new `jwt_secret` costs nothing lasting; a new push key pair means every device turns notifications on again (Settings lists which); a new presence token has to go to the sensor.

**Either way**, the webapp reads each of `POSTGRES_PASSWORD`, `JWT_SECRET`, `CRON_SECRET`, `PRESENCE_SENSOR_TOKEN` and the two `VAPID_*` keys from its environment first, and only when one isn't set, from `/kinboard/secrets/<name in lower case>`; a value in `.env` always wins. When `ANON_KEY` and `SERVICE_ROLE_KEY` are not set, the webapp works them out from `JWT_SECRET`.

**The service-role key's names.** Inside the webapp it is `KINBOARD_SERVICE_ROLE_KEY`, which is what `compose.yml` passes from the `KINBOARD_SERVICE_ROLE_KEY` variable. The git install's `docker-compose.yml` passes `.env`'s `SERVICE_ROLE_KEY` as `SUPABASE_SERVICE_ROLE_KEY`, the name from before 1.18; that keeps working, with nothing to change. The webapp takes the first of `KINBOARD_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SERVICE_ROLE_KEY` that is set, and otherwise works the key out from `JWT_SECRET`. A key from an older name is logged once at start as `from SUPABASE_SERVICE_ROLE_KEY in the environment`; the value never is. Without a `POSTGRES_PASSWORD` or a `JWT_SECRET` from either place, the webapp does not start, and its log names the one that is missing.

API keys for integrations (OpenWeatherMap, the Google Calendar client, the presence sensor's token) can be set per family in Settings, which wins over `.env`. See [OpenWeatherMap](OpenWeatherMap), [Google Calendar](Google-Calendar) and [Presence sensor](Presence-Sensor).

`SECRET_KEY_BASE`, `API_EXTERNAL_URL`, `KINBOARD_ENTRY`, `ADDITIONAL_REDIRECT_URLS` and the `KONG_*` settings belonged to containers that were retired in 1.15. Nothing reads them any more; a line left in `.env` is harmless.

## Behind Traefik

The repo ships a Traefik overlay that wires the webapp + (optional) go2rtc into an external Traefik instance. **It assumes Traefik is already running on the host with a cert resolver configured.** If you don't have Traefik yet, follow [From scratch: Traefik + Let's Encrypt](#from-scratch-traefik--lets-encrypt) below first.

### Wiring kinboard into your existing Traefik

Set in `.env`:

```
DOMAIN=kinboard.example.com
SITE_URL=https://kinboard.example.com
TRAEFIK_CERT_RESOLVER=letsencrypt
TRAEFIK_NETWORK=proxy
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.traefik.yml"
```

then `./start.sh up`.

The overlay registers **one** HTTP router: everything for `Host(${DOMAIN})` goes to the webapp, which serves the app, the database API at `/rest/v1`, uploaded files and live updates itself. The guard that stops a `service_role` key arriving from the internet is in the webapp, so it applies here as on every install.

> **Upgrading from an older overlay?** Until 1.15 the overlay had a second router sending `/rest`, `/auth`, `/storage` and `/realtime` to Kong, behind a forward-auth "rest-gate". If you keep your own copy of `docker-compose.traefik.yml` (or the old `docker-compose.traefik-one-route.yml.example`), replace it with the shipped one. An old copy still carries a `kong:` block, and compose refuses a service with labels but no image (`service "kong" has neither an image nor a build context specified`), so the stack would not come up.

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

**Firewall (UFW):** open 80/tcp and 443/tcp publicly. Close 3001 — Traefik fronts it. If you've applied Docker-level firewall rules per [Security-and-Threat-Model → Recommended hardening](Security-and-Threat-Model#recommended-hardening), mirror the port change there too (drop `3001`, add `80` and `443`).

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

## Resource needs

Measured on an amd64 machine on 2026-11-26, the compose install on the image after 1.17.0 (the webapp, PostgreSQL, PostgREST, go2rtc and the scheduler), one family with demo data, no screen open:

| | Download | On disk | Memory, idle |
|---|---|---|---|
| webapp (`ghcr.io/svenger87/kinboard`) | 108 MB | 348 MB | 78 MiB |
| database (`supabase/postgres:15.14.1.159`) | 367 MB | 1.24 GB | 70 MiB |
| PostgREST (`postgrest/postgrest:v14.16`) | 6 MB | 21 MB | 28 MiB |
| go2rtc (`alexxit/go2rtc:1.9.14`, cameras) | 95 MB | 255 MB | 3 MiB |
| scheduler (`mcuadros/ofelia`) | 12 MB | 26 MB | 44 MiB |
| **Total** | **about 590 MB** | **about 1.9 GB** | **about 225 MiB** |

- **Disk, data:** the database was 13 MB here and 24 MB on a development install with a year of use; uploaded photos are what grows. Leave room for backups, which copy both.
- **arm64 (Raspberry Pi):** the webapp image is the same 108 MB download for arm64 (the published 1.17.0: 107.9 MB arm64, 107.8 MB amd64). Memory on a Pi has not been measured yet: an emulated arm64 container on amd64 runs Node under a CPU translator, whose memory and CPU say nothing about a real Pi. Measurements on a Pi 4 (4 GB) and a Pi 5 will be added here.
- **CPU:** idle, all five together stay under 1 % of one core here. A calendar sync or a page load is a short burst.
- **A source build** (`docker-compose.build.yml`) needs about 4 GB of memory while it builds, and about 3 GB of disk.

How it was measured: download is the sum of the image's compressed layers in the registry manifest; on disk is `du -sxm /` inside the image; memory is `docker stats --no-stream` a few minutes after the start.

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

The image carries the same check as its own `HEALTHCHECK` (every 30 s, 10 s timeout, unhealthy after three misses, with the first 120 s not counted while a first start runs its migrations), so a `docker run` or a Portainer container without this compose file is health-checked too. Where a compose file sets `healthcheck:`, as this one does, its values win.

`docker ps` shows `(healthy)` / `(unhealthy)` for the webapp container accordingly — useful for external monitoring (Uptime Kuma, a simple cron+curl script, Diun-adjacent tooling) without needing to poll a real page. Separately, Settings has its own **Diagnostics** section showing network/live-updates/push/integration status for troubleshooting inside the app — that's a different, family-facing check, not powered by this endpoint.

## Backing up your data

Two options, at different levels:

- **Family-level JSON export** — Settings → **Data & backup** → **Download backup**. Downloads everything the app manages for your family (events, todos, shopping, recipes, meal plans, notes, birthdays, schedules, settings) as one JSON file, excluding credentials and device data. Good for a quick "just in case" snapshot before a risky change, or for migrating a family between installs. Not a full restore mechanism by itself — there's no matching "import" flow yet, so treat it as a reference/manual-recovery backup, not a one-click restore.
- **Full backup (`pg_dump` + the storage directory)** — see below. This is the restorable backup: every family on the instance, all integration credentials, everything. It is **two** things, and the second one is easy to miss: uploaded files — photos your family has added, recipe pictures, vehicle images — are not in the database. They sit on disk under `${DATA_DIR}/storage/`, and a `pg_dump` alone will not bring them back.

## Backups

The bind paths under `${DATA_DIR}` are what need backing up:

```
${DATA_DIR}/db/         # PostgreSQL data dir
${DATA_DIR}/storage/    # Uploaded files: family photos, recipe images, vehicle pictures
```

For a clean backup, snapshot the DB with `pg_dump` rather than copying `db/` while Postgres is running:

```bash
docker exec kinboard-db pg_dump -U supabase_admin -F c postgres > /backups/kinboard-$(date +%F).pgdump
```

Two details in that line are load-bearing.

**`-U supabase_admin`, not `postgres`.** `postgres` is not a superuser in the
Supabase Postgres image, and `pg_dump` locks every table it dumps, so as
`postgres` it aborts on the first table it doesn't own — on an install that
ran the old realtime container, `permission denied for table
_realtime.feature_flags` or similar.

**No `-t`.** `-F c` is a binary format, and `docker exec -t` allocates a TTY
that rewrites line endings in the stream. The dump still *looks* fine — right
order of magnitude, no error — but it is corrupt and `pg_restore` rejects it.
Use `-i` if you need stdin, never `-t` for binary output.

Verify every backup. Both failure modes above produce a file, and neither says
anything is wrong:

```bash
docker exec -i kinboard-db pg_restore -l < /backups/kinboard-$(date +%F).pgdump | head
```

A good dump prints a table of contents (`; Archive created at …`, `TOC
Entries: …`). A bad one prints `input file does not appear to be a valid
archive`. That single command catches both the permission failure and the TTY
corruption — checking the file size does not, since a TTY-mangled dump is
*larger* than a correct one.

If you script this, don't pipe the dump straight into `gzip`. A shell pipeline
reports the *last* command's exit status, so `pg_dump | gzip > file` reports
success even when the dump failed. Write the dump first, check the exit status,
then compress.

### The storage directory

The dump above covers the database. It does not contain a single uploaded byte,
so on its own it is half a backup — and the half that is missing is the one
nobody can recreate. A family's photographs are only ever in `${DATA_DIR}/storage/`.

```bash
tar -czf /backups/kinboard-storage-$(date +%F).tar.gz -C "${DATA_DIR}" storage
```

Since 1.15 uploaded files are plain files at
`${DATA_DIR}/storage/files/<bucket>/<path>`, and the content type comes from the
file name, so any `tar` will do — GNU tar and `--xattrs` are no longer needed.
(Until 1.15 the storage container kept each file's content type in an extended
attribute, and a backup without `--xattrs` restored pictures that would not
load. A backup of that era still wants `--xattrs` when you extract it.)

On an install that was upgraded to 1.15, the same directory also still holds
the old layout (`storage/stub/stub/…`): the upgrade hard-linked each file into
`storage/files/` rather than copying it, so the two share their bytes on disk
and the archive is not twice the size. Leave the old tree where it is; it is
what a [rollback](https://github.com/svenger87/kinboard/blob/main/UPGRADING.md#115--one-container-serves-everything) would use.

Files are write-once, so this can be `tar`'d while the stack is up.

Per-family settings live in `public.settings` (JSONB) and come along with the `pg_dump`.

### The config folder (installs that have one)

An install on the one-file layout (`compose.yml`, from 1.18) keeps its
secrets as files instead of in `.env`: the database password, the JWT secret, the cron and presence tokens,
and the push (VAPID) key pair, under `secrets/` in the config folder
(`KINBOARD_CONFIG_DIR`, or `${DATA_DIR}/config` for an install moved over from
the git layout). For such an install that folder is the third part of a backup:

- a restored **database folder** does not start without it: the start step
  refuses, because the database exists and its password file does not;
- a **dump** restored into a new install starts with new secrets, but the push
  keys are new too, so every device has to turn notifications on again.

Archive it as root, so owners and modes are kept, and keep the archive where
only root can read it, since it holds every secret of the install:

```bash
umask 077
sudo tar --numeric-owner -czf /backups/kinboard-config-$(date +%F).tar.gz -C "${DATA_DIR}/config" .
sudo chmod 600 /backups/kinboard-config-$(date +%F).tar.gz
```

With named volumes instead of a folder, the same through a container:

```bash
docker run --rm -v kinboard-config:/config:ro -v /backups:/out --entrypoint sh supabase/postgres:15.14.1.159 \
  -c 'umask 077; tar --numeric-owner -czf /out/kinboard-config-'"$(date +%F)"'.tar.gz -C /config .'
```

A git install on the legacy compose file (`webapp/docker/docker-compose.yml`
with a full `.env`) has no config folder: its secrets are in `.env`, which you
back up with the checkout as before.

[Compose UIs → Backups](Compose-UIs#backups) has the whole backup and restore
of a one-file install with Docker volumes: the dump, the uploaded files and
the config, each through a container.

### Restoring one

Bring the stack up **first**, then restore the data into it:

```bash
# 1. a clean, fully started stack — empty, but with the current schema
cd webapp/docker
./start.sh up
# wait until http://localhost:3001/api/health answers

# 2. put the data back. The new stack has already written its own
#    instance settings (the server's time zone) on start, and its
#    scheduler a heartbeat; the backup's replace them (otherwise pg_restore
#    stops on the heartbeat's row), and the next start records the time
#    zone again.
docker exec -i kinboard-db psql -U supabase_admin -d postgres -c "TRUNCATE public.instance_settings, public.system_heartbeats"
docker exec -i kinboard-db pg_restore -U supabase_admin -d postgres \
  --data-only --disable-triggers -n public < /backups/kinboard-2026-08-09.pgdump

# 3. put the uploaded files back
tar -xzf /backups/kinboard-storage-2026-08-09.tar.gz -C "${DATA_DIR}"
```

**An install with a config folder** puts that folder back **before the first
`up`**, so that the stack starts with its old secrets rather than generating
new ones. As root, so the archive's owners and modes (`0750`/`0640`, `root:0`)
come back as they were and never wider:

```bash
sudo mkdir -p "${DATA_DIR}/config"
sudo tar --numeric-owner -xzpf /backups/kinboard-config-2026-08-09.tar.gz -C "${DATA_DIR}/config"
```

The automatic update's own archive (`pre-upgrade-<timestamp>-config.tar.gz`,
below) restores the same way. Without the config folder the database folder
cannot be restored (see above), and a dump restored into a fresh install
works but has new push keys: Settings then lists the devices that need
notifications turned on again, and the webapp's log says so at start.

The files are served straight from `${DATA_DIR}/storage/files/`, so once they
are back the pictures load; there is nothing to restart.

**A backup taken before 1.15** has the files only in the old layout, and the
rows describing them in the `storage` schema of the dump. Restore it into the
version it was taken with (`KINBOARD_TAG=<that version>` and that version's
compose file, `git checkout v<that version>`), following the restore steps of
that version's documentation, and then upgrade: the upgrade moves the files
across exactly as it does on a running install.

Three things about the database restore are load-bearing, and each of them
fails quietly if you get it wrong.

**Start the stack before restoring, not after.** Kinboard's schema arrives in
two halves: the baseline is mounted into the database image and runs when the
data directory is first created, and every migration on top of it is applied by
the *webapp* container as it starts. Restore into a database that has only had
the first half and you are writing into a schema that predates soft delete and
device sessions — `pg_restore` reports `column "deleted_at" does not exist` and
drops those tables on the floor.

**`--data-only`.** The schema already exists by the time you restore, because
the steps above created it. A full schema-and-data restore collides with it,
and the `COPY` steps fail alongside the `CREATE` statements — leaving a
database that looks restored, reports hundreds of "already exists" errors you
might reasonably dismiss, and contains no rows.

**`--disable-triggers`.** Otherwise the data has to arrive in foreign-key
order, which it does not. This needs superuser, which is the other reason for
`-U supabase_admin`.

A good restore prints nothing and exits 0. Check that, then check the data:

```bash
docker exec kinboard-db psql -U postgres -d postgres \
  -c "SELECT count(*) FROM families;" -c "SELECT count(*) FROM events;"
```

A developer test in the repository, `scripts/rigs/test-backup-restore.sh`, runs this whole cycle — seed, dump,
destroy, rebuild, restore, compare every table's row count — against the
current schema, so the procedure above is verified rather than remembered.

### Installs on stock PostgreSQL

Every install so far, the git install and the one-file `compose.yml`, runs the
database image `supabase/postgres` 15, and keeps it: nothing moves an existing
install to another database (RFC-024 §11.4). New installs from the app-store
listings (planned) run `ghcr.io/svenger87/kinboard-postgres:17` instead: plain
PostgreSQL 17 plus the one extension Kinboard relies on, `safeupdate`, which
makes the database refuse an `UPDATE` or `DELETE` that has no `WHERE`. The
first start creates the roles Kinboard's row-level security needs, and every
start checks them; a database whose roles are wrong is refused with the reason.

For backups, nothing changes: the superuser is called `supabase_admin` there
too, so the `pg_dump` and restore commands above work as written. One thing
does: there is no `auth` schema (nor `storage` or `realtime`), so a backup
script of your own that checks a dump for `CREATE SCHEMA auth` rejects every
good dump of such an install. Check for Kinboard's own tables instead:

```bash
docker exec -i kinboard-db pg_restore -l < /backups/kinboard-$(date +%F).pgdump | grep -cE '^[0-9]+; [0-9]+ [0-9]+ TABLE public '
# a healthy dump lists about 63; a failed one, none
```

A database folder belongs to the image that created it. `kinboard-postgres`
refuses a folder written by `supabase/postgres` (another PostgreSQL version,
built against another C library, whose text indexes would be silently out of
order) and says so in the database container's log, changing nothing.
`supabase/postgres` refuses a PostgreSQL 17 folder the same way.

### Moving an install to PostgreSQL 17

Not needed, and nothing will make you: `supabase/postgres` 15 stays supported
for every install that has it. If you want to move anyway, the move is a dump
and a restore into a new install, never the same folder:

1. On the old install, take the three backups above: the database dump, the
   uploaded files and, for a one-file install, the config folder.
2. Set up the new install with an **empty** database folder (a new volume, or
   a new `KINBOARD_DB_DIR`), the database image
   `ghcr.io/svenger87/kinboard-postgres:17`, and the old config folder put
   back before the first start, so the secrets (and with them the push keys)
   stay the same.
3. Start it and wait until `/api/health` answers, then restore the dump and
   the files exactly as in [Restoring one](#restoring-one).

If the database container instead logs `REFUSED: the database folder was
created by PostgreSQL 15`, the new install is pointing at the old folder:
nothing in it was changed, and step 2 wants an empty one. To move to the
all-in-one image instead (PostgreSQL 17 in the same container), there is one
step: `kinboard export` on this install and `kinboard import` on the new one,
see [All-in-one: Moving between the compose file and the all-in-one
image](All-in-one#moving-between-the-compose-file-and-the-all-in-one-image).

## Updates

**A one-file install** (`compose.yml`, from 1.18): **Pull**, then **Up**, in whatever runs it; in a terminal, in the folder with `compose.yml`:

```bash
docker compose pull && docker compose up -d
```

That is the whole update: the database updates, the scheduled jobs and everything else a release changes ship in the image. [Compose UIs](Compose-UIs#updating-pull-then-up) has each tool's buttons. `git pull` and `./start.sh` have nothing to do with such an install. It updates itself with `COMPOSE_PROFILES=autoupdate`: see [Automatic updates of a one-file install](#automatic-updates-of-a-one-file-install). The Diun overlay described under Auto-updates is for git installs.

**A git install:** pull the new code and bring the stack up again:

```bash
git pull
cd webapp/docker
./start.sh up        # pulls/recreates what changed, removes retired containers
```

That is the whole update. `webapp/docker/test-upgrade.sh` is not an updater: it only says so and points here. The test it used to be lives in `scripts/rigs/` with the other developer tests, which build a separate throwaway copy of Kinboard and refuse to run unless a developer asks for one.

`./start.sh restart` pulls (or, with `docker-compose.build.yml`, rebuilds) just the webapp and restarts it and `cron`.

The scheduler (`cron`, ofelia) reads its jobs from the webapp container's labels only when it starts, so whenever the webapp container is recreated, `cron` has to be recreated after it or a job a release adds never runs. `./start.sh restart` always does this, and `./start.sh up` and the Diun self-update do it whenever they recreated the webapp. If you recreate the webapp some other way (`docker compose up -d webapp`), follow it with `docker compose up -d --no-deps --force-recreate cron`, with the same `-f` files.

### The scheduler: ofelia or internal

Kinboard has 18 scheduled jobs: calendar syncs, reminders and notifications, pocket-money interest, emptying the recycle bin and the like. Two things can run them, never both:

| | Git install (`webapp/docker/docker-compose.yml`) | One-file install (`compose.yml`, from 1.18) |
|---|---|---|
| Runs the jobs | the `kinboard-cron` container (ofelia), which calls into the webapp | the webapp itself (`KINBOARD_SCHEDULER=internal`, set in the file) |
| Where the job list comes from | labels on the webapp container, read when `cron` starts | the image |
| After an update | `cron` has to be recreated after the webapp (above) | nothing: a new image is a new job list |
| Docker socket | `cron` has it | no container has it |
| Its log | `docker logs kinboard-cron` | `docker logs kinboard-webapp 2>&1 \| grep internal-scheduler` |

Both run the jobs at the same times: the fixed-time ones (`todo-reminders` at 08:00, `birthday-reminders` at 07:00) in UTC, whatever `TZ` says. The internal scheduler never starts a job while its previous run is still going, and after the server was down it does not make up the runs it missed; a job that fails is logged and runs again at its next time.

**Never set `KINBOARD_SCHEDULER=internal` in a git install while `kinboard-cron` runs**: every job would run twice, and every reminder arrive twice.

Schema changes ship as numbered files in `webapp/docker/migrations/` (`NNN_topic.sql`). **You do not normally need to run them**: the webapp container applies every migration it has not applied before when it starts, records it (with a checksum) in `kinboard.schema_migrations`, and refuses to start rather than serve against a half-applied schema. Pulling a new image and restarting is enough.

The manual path is still there for when the container could not do it — no `POSTGRES_PASSWORD` in the webapp's environment, say:

```bash
cd webapp/docker
./start.sh migrate
```

### Still the old version after updating

Settings still shows the old version after the update. In almost every case the update did run, just not where the running containers come from. Three commands tell you which case you are in:

```bash
docker ps --format '{{.Names}}  {{.Image}}' | grep kinboard
docker inspect kinboard-webapp --format '{{.Config.Image}}'
docker inspect kinboard-webapp --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}  {{ index .Config.Labels "com.docker.compose.project.config_files" }}'
```

| What they show | What it means | What to do |
|---|---|---|
| `kinboard-webapp` with a bare image id (such as `9ce8c0e45da6`) instead of `ghcr.io/svenger87/kinboard:…` | The new image was pulled, but the container still runs the old one: nothing recreated it | Up again in the place it came from (next row). From the git folder: `cd webapp/docker && docker compose up -d --force-recreate webapp`, then `docker compose up -d --no-deps --force-recreate cron`, with your `-f` files |
| The folder in the third line is not the one you updated, or the file is not the one you think (an OpenMediaVault, Portainer, Dockge or Unraid folder, say) | The containers were started from somewhere else, and `git pull` or `./start.sh` in another folder doesn't touch them | Update where they come from: in a Compose UI, Pull, then Up there ([Compose UIs](Compose-UIs)). A git folder next to it is a second, unused copy |
| The second line ends in a version (`:1.16.0`) or a `sha-…` tag | The tag is pinned, and a pinned tag never moves | Set `KINBOARD_TAG=latest` (in `.env`, or your tool's variables), or remove it, then Up |
| `.env` in `webapp/docker` has `PROJECT_NAME=kbupg` (or `kbinstall`, `kbbak`), or `kbupg-…` containers run | A developer test (`test-upgrade.sh` before 1.18) rewrote `.env` to point at its own throwaway copy. Your data is untouched, but `docker compose` and `./start.sh` there act on the test copy, and a fresh start would come up empty | Remove the test copy: `docker compose -p kbupg down -v --remove-orphans` (only the test's containers go). Put your own values back into `.env`; from 1.18 `./start.sh up` stops on such an `.env` and lists the lines. Then update as usual |
| `kinboard-webapp:local` | The webapp is built from the source checkout | See [Troubleshooting](Troubleshooting#the-version-in-settings-doesnt-change-after-an-upgrade) |

To check the result, read the version off the running container:

```bash
docker inspect kinboard-webapp --format '{{ index .Config.Labels "org.opencontainers.image.version" }}'
```

A Kinboard on another machine updates the same way, on that machine: the published image, pulled there by the steps above or by the auto-update below. Don't build an image from a working copy and copy it across: Next.js bakes the `NEXT_PUBLIC_*` values of a `webapp/.env.local` into the page at build time, and such a page loads and then never gets past "Loading…". To build from source on purpose, use `docker-compose.build.yml` from a clean checkout.

### Auto-updates

> **Auto-update takes its own backup.** Every release note says to back up
> before upgrading, which is advice nobody on this overlay can act on — Diun
> polls every 30 minutes and the upgrade has happened by the time you read
> anything. So the update dumps the database and archives the storage
> directory immediately before it recreates anything, verifies both, and
> **refuses to upgrade if either cannot be verified**. Backups land in
> `${DATA_DIR}/backups` as `pre-upgrade-<timestamp>.sql.gz` and
> `pre-upgrade-<timestamp>-storage.tar.gz`; set `KINBOARD_BACKUP_DIR` to put
> them elsewhere, and `BACKUP_KEEP` (default 5) for how many to keep. Nothing
> is dumped on a run where no image changed.
>
> An install that keeps its secrets in a [config folder](#the-config-folder-installs-that-have-one)
> gets a third file, `pre-upgrade-<timestamp>-config.tar.gz`: readable by root
> only (`0600`), with each file's owner and mode kept, checked file by file
> against the folder before the update goes on, and kept and pruned with the
> other two. If the backup folder can't keep that mode (a network share that
> ignores permissions), the update stops rather than leave the secrets
> readable there; point `KINBOARD_BACKUP_DIR` at a folder that keeps them. An install without one (every git install on the legacy compose
> file) gets exactly the two files it always has. `.env` is never copied into
> a backup.
>
> **If your auto-update overlay predates 1.11, recreate the webhook once:**
>
> ```bash
> cd webapp/docker
> docker compose $COMPOSE_FILES up -d --force-recreate --no-deps webhook
> ```
>
> Until 1.11 the webhook ran a copy of the update script that was mounted as
> a single file, and a single-file mount stays at whatever version was on
> disk when the container started — `git pull` replaces the file, the
> container keeps the old one. The update never recreates its own webhook, so
> nothing refreshed it, and changes to the update script — the pre-upgrade
> backup included — did not run on an existing install until this was done.
> Your update log shows which one you have: a current script writes either
> `taking a backup before recreating anything` or `skipping the pre-upgrade
> backup` on every run. Neither line means the old copy is still running.

The recommended path is the **Diun + webhook overlay** (`docker-compose.diun.yml`). It runs the FULL upgrade sequence end-to-end whenever a new GHCR image lands:

1. `git pull --ff-only origin main` — picks up new compose files, migrations, `init.sql`, `seed-demo.sql`
2. `./setup.sh --non-interactive` — adds any `.env` key a release needs; does nothing when none are missing
3. `docker compose $COMPOSE_FILES pull --ignore-buildable` — pulls the new GHCR image(s); the webhook's own image is pulled after them, on its own, so a webhook image that can't be pulled never holds up the release
4. the pre-upgrade backup (above) — only when step 3 brought a new image
5. `docker compose up -d --remove-orphans` (with webhook + diun excluded — see below) — recreates only services whose image or definition changed, and removes containers of services a release retired; the webapp's entrypoint applies new migrations on boot
6. **the health wait** — every recreated service must come up healthy within 10 minutes (the webapp's health check, then its smoke check, `/api/health?deep=1`: the tables and columns this version needs are there, and a write goes through). If one doesn't, the recreated services go back to the exact images they ran before, that version is held back until a newer one is published, and Settings says so (see [When an update doesn't start](#when-an-update-doesnt-start))
7. `docker compose up -d --no-deps --force-recreate cron` — whenever the webapp container is a new one, because the scheduler reads its jobs from the webapp's labels only when it starts
8. `docker restart kinboard-diun` — only when `diun/diun.yml` changed during the run
9. **the webhook follows its image** — when the webhook runs another image than the compose files name (a newer one under its tag, another `KINBOARD_TAG`, or the old locally built `kinboard-webhook:local`), a short-lived container (`kinboard-webhook-refresh`) recreates it once the run has ended. The run can't do that itself: it runs inside the webhook. If the new webhook doesn't stay up for 30 seconds, it goes back to the image it ran before

Besides Diun's call, the webhook container runs a **reconciliation tick** every 30 minutes: no `git pull`, only "does each running container use the image reference that `.env` and the compose files name?". A newer image under the same tag stays Diun's to announce. Diun watches the tag the running container was created from, so if you deploy a pinned `KINBOARD_TAG=sha-…` and later set `KINBOARD_TAG=next` again, Diun sees nothing; the tick applies it, with the same backup and health wait. Its first run only records a baseline. A pinned tag never moves, so it never changes anything there, and a service you stopped stays stopped. When the registry or the network is down it touches nothing and waits, longer each time, up to 6 hours. `KINBOARD_UPDATE_TICK=off` in `.env` switches it off (read at every tick). A webhook container created before this ran starts the tick after its next update run, or at once with `up -d webhook`.

Two containers do this:
- **Diun** (`crazymax/diun`) — image notifier. Polls GHCR every 30 min, detects new digests on services labeled `diun.enable=true`, fires a webhook. Read-only docker socket.
- **Webhook** — `ghcr.io/svenger87/kinboard-webhook`, published with every Kinboard build from `Dockerfile.webhook` (~70 MB Alpine + git + docker CLI + openssl + the webhook binary from adnanh/webhook) and pulled under your `KINBOARD_TAG`, so it follows the webapp's channel or pin. Nothing is built on your machine. Validates the HMAC token in the `X-Diun-Token` header against `DIUN_WEBHOOK_SECRET`, then executes the checkout's `kinboard-self-update.sh` — never a copy inside the image, so the update logic is always the one `git pull` brought, whichever image runs. RW docker socket + RW project bind-mount.

Neither container is exposed externally; both sit on the internal `kinboard` docker network.

#### Required `.env` keys

`setup.sh` writes all four on first run (and appends any that are missing on re-run):

| Key | What it is |
|---|---|
| `DIUN_WEBHOOK_SECRET` | HMAC shared between Diun and webhook. Auto-generated. |
| `KINBOARD_PROJECT_DIR` | Absolute host path to the kinboard repo. The webhook bind-mounts this AT THE SAME PATH inside the container so docker-compose's relative paths resolve identically inside and outside. Auto-detected from `setup.sh`'s own location. |
| `COMPOSE_PROJECT_NAME` | Should be `kinboard`. Without this, compose derives the project name from the cwd (`docker` if you `cd webapp/docker` first), which renames the network and breaks subnet reuse if you migrated from an older flat layout. |
| `COMPOSE_FILES` | Space-separated `-f …` overlay flags, such as `COMPOSE_FILES="-f docker-compose.yml -f docker-compose.diun.yml"`. Quotes around the whole value are optional: `.env` is read the way Docker Compose reads it, so the line works with or without them (before 1.18, `./start.sh` needed them). Don't put quotes *inside* the value (`-f "docker-compose.yml"`): those reach `docker compose` as part of the file name. |

#### Bring up the overlay

```bash
cd webapp/docker
# docker-compose.diun.yml is used as it is: don't edit or replace it (see below).
# Make sure these are set in .env (setup.sh auto-creates them on first run):
#   DIUN_WEBHOOK_SECRET=<random hex>
#   KINBOARD_PROJECT_DIR=/absolute/host/path/to/kinboard
#   COMPOSE_PROJECT_NAME=kinboard
#   COMPOSE_FILES="-f docker-compose.yml -f docker-compose.traefik.yml -f docker-compose.diun.yml"
# Then, from the project root:
./setup.sh --non-interactive
cd webapp/docker
docker compose -f docker-compose.yml -f docker-compose.traefik.yml -f docker-compose.diun.yml up -d
```

The overlay adds a `diun.enable=true` label to the kinboard-webapp service so Diun knows to watch its image. Only that container is watched by default — auto-bumping the Postgres image is not safe; if you want Diun to watch additional services, add the same label to them in `docker-compose.override.yml`.

**Use `docker-compose.diun.yml` as it is.** It is a tracked file, and git refuses an update that changes a file with local edits, so an edited copy stops the self-update's `git pull` (Kinboard then keeps updating the image, but not the compose files). Settings of your own go in an overlay of your own, named after it in `COMPOSE_FILES`.

**If you copied `docker-compose.diun.yml.example` over it** (as this page, the overlay's header and some replies said before 1.18): 1.18 deleted the example, because `docker-compose.diun.yml` now has everything it had, the log limits included. An install on 1.17 or older still runs the old self-update when 1.18 arrives, and that one cannot get past the copy: its log says `git still behind`, and the stack keeps running the new image on the old compose files. Put the tracked file back once, then run the update by hand:

```bash
cd /path/to/kinboard
git checkout -- webapp/docker/docker-compose.diun.yml
docker exec kinboard-webhook sh -c 'sh "$PROJECT_DIR/webapp/docker/kinboard-self-update.sh"'
```

From 1.18 on, the self-update does this itself: a tracked file whose content is exactly a version Kinboard shipped (at that path, or the old `.example` beside it) is put back before the pull, with a copy in `.git/kinboard-local-copies/`. An edit of your own is left as it is, and the log names the file and the command.

The webhook's image is pulled, never built: `ghcr.io/svenger87/kinboard-webhook`, under `KINBOARD_TAG` (`latest`, `next`, a version, a `sha-…` build). The upstream `almir/webhook` image ships only the webhook binary (no git, no docker CLI), so `Dockerfile.webhook` layers those on an Alpine base, and Kinboard's own build publishes it for amd64 and arm64.

- **No webhook image under your tag** (before 1.18 is out, or `KINBOARD_TAG=1.17.0` pinned): that version has no `kinboard-webhook` of its own. `./start.sh up` then runs the published `latest`, the `kinboard-webhook:local` built here before, or a published build of main, in that order, says which, and writes nothing; the webhook moves to its own image once there is one. `KINBOARD_WEBHOOK_TAG=latest` (or `next`) in `.env` names one for good. A plain `docker compose up` has no such fallback and stops on the missing image.
- **To build it on this machine anyway** (a host that can reach Alpine's mirrors but not ghcr.io, or a change to `Dockerfile.webhook` you're trying out), add `-f docker-compose.webhook-build.yml` after `docker-compose.diun.yml` in `COMPOSE_FILES`. It builds `kinboard-webhook:local` at `up`, as every install did until 1.18. The self-update never builds it.
- **Until 1.18 every install built it on its first `up`.** An install from before keeps its `kinboard-webhook:local` until the first update after 1.18 (or its next `./start.sh up`) moves it to the published image by itself; nothing to do by hand. The old local image can be removed afterwards with `docker rmi kinboard-webhook:local`.

#### A git checkout that runs `compose.yml`

A git install that moved to the root `compose.yml` ([RFC-023 §5.2](../rfc/023-one-file-install.md)) keeps this overlay. Bring it up from the checkout's root, naming the overlay by its absolute path, with `KINBOARD_PROJECT_DIR` and `DIUN_WEBHOOK_SECRET` (the value already in `webapp/docker/.env` and `diun/diun.yml`) in the root's `.env`:

```bash
cd /absolute/host/path/to/kinboard
docker compose -f compose.yml -f "$PWD/webapp/docker/docker-compose.diun.yml" up -d
```

The overlay names its own files from `KINBOARD_PROJECT_DIR`, so it works whichever compose file comes first. `COMPOSE_FILES` needs no change: the self-update reads which files, which project and which `.env` the stack was started with from its containers' Compose labels, and runs every step against those. On such a stack it does not run `setup.sh` (which writes `webapp/docker/.env`, a file `compose.yml` doesn't read), and its pre-update backup finds the data from the containers' mounts: the uploaded files from the webapp's `/var/lib/storage`, the config folder from `/kinboard`, and puts the archives beside the storage folder: into `backups` next to a folder called `storage` (the same place as `$DATA_DIR/backups` with §5.2's layout), into `<folder>-backups` next to any other folder, or into the Docker volume `kinboard-backups` when the files are in a named volume. `KINBOARD_BACKUP_DIR` in the root's `.env` names another folder. A git checkout that is not Kinboard's (a Compose UI's own stacks repository) is left alone in the same way as a folder without git.

A `compose.yml` in a folder **without** a git checkout (pasted into a Compose UI) is never updated by the Diun overlay: it says so in its log and changes nothing. Such an install has its own updater, below.

#### Automatic updates of a one-file install

A one-file install (`compose.yml`, no git checkout) turns on automatic updates with one variable, `COMPOSE_PROFILES=autoupdate`, in its UI's variables or in `.env` beside the file, and **Up**; or `docker compose --profile autoupdate up -d`. That starts `kinboard-updater` (`ghcr.io/svenger87/kinboard-updater`, published with the same tags as Kinboard), the file's `updater` service. Without the variable the service never starts, and no container of the stack has the Docker socket. [Compose UIs → Automatic updates](Compose-UIs#automatic-updates) says it in each tool's words; in short:

- **No Diun, no git, no `setup.sh`.** The updater checks the registry itself, 2 minutes after it starts and then every 30 minutes (plus up to 5 minutes of jitter): one manifest `HEAD` for the Kinboard image under `KINBOARD_TAG`. Its first check only records what runs.
- **What it compares:** the digest the registry serves for the tag against the digest the running image was pulled as, and the image reference the file and its variables name against the one the container was created from (a `KINBOARD_TAG` changed without Up). A pinned tag (`1.18.0`, `sha-…`, a digest) never moves and is never asked about. Only the Kinboard image is the updater's: the database, PostgREST and go2rtc images are pins in the file, and a changed pin is applied by the household's own Up, never by the updater (it logs the difference). A 401 or 404 for the tag is a warning about that tag, not a reason to back off.
- **What it refuses:** a stack whose webapp declares no `KINBOARD_COMPOSE_REVISION` (not the one-file file); a stack that also runs the Diun overlay's webhook (a git install on `compose.yml`: that one updates it); a webapp someone stopped (init and db-init wait with it); and a recreate that would give a container other folders or volumes than it has, which happens when the stack was started with variables the updater can't see (typed in a shell rather than kept in `.env` or the UI). Each is logged, and nothing is touched.
- **Then the same steps as the git install's update:** pull, a verified backup of the database, the uploaded files and the config volume, recreating only `init`, `db-init` and `webapp`, the health wait and smoke check, the rollback to the exact previous image, the record Settings shows. The backups go where a git install on `compose.yml` puts them (above): the volume `kinboard-backups`, or beside the storage folder; `KINBOARD_BACKUP_DIR` and `BACKUP_KEEP` work as there.
- **The compose revision.** The image carries the compose file revision it ships (the label `app.kinboard.compose-revision`). The updater applies a release only when that equals the file's `KINBOARD_COMPOSE_REVISION`. Otherwise it holds: the tag goes back to what runs (when the webapp runs that tag), nothing is backed up or recreated, its log says so at every check, and Settings shows *"Your compose file is older than this version of Kinboard expects"* until the household replaces the file and starts it. That record has its own key (`update_hold`), so a rollback notice still showing stays, and the updater removes it once the hold is over.
- **Registry trouble** (no network, HTTP 429): nothing pulled or touched; the next check waits 30 minutes, then twice as long each time, up to 6 hours.
- **Where it keeps things:** its state, lock and log in `updater/` of the config volume (`kinboard-config`, or `KINBOARD_CONFIG_DIR`); the pre-update backup of that volume leaves `updater/` out. Its log is also the container's: `docker logs kinboard-updater`.
- **How it reaches the stack:** from its own container's Compose labels (project, folder, files, `.env`). It runs each check in a short-lived sibling container of its own image that mounts the stack's folder read-only at the same path, so every `docker compose` call sees the files exactly as your UI does.
- **Container mode, when the file is not on the host's disk** (Portainer's web editor keeps it in `/data/compose/<id>/` inside its own volume; a stack started from stdin, or whose file was deleted, has none either). Docker refuses to mount the folder, so the updater works from the containers: it reads each Kinboard container's configuration through the Docker API and creates its replacement with that configuration and only the image changed. What the old image itself supplied (its `ENV` lines, labels, entrypoint and command, health check, user, working directory) is left for the new image to supply; everything the stack set is copied: variables, mounts (an unnamed volume is mounted again by its name), networks with their aliases and fixed addresses, ports, labels including Compose's (so the UI still owns the container), restart policy, health check, user, command, log options and the rest of the host configuration. Compose's `com.docker.compose.image` label gets the new image, so a later redeploy from the UI doesn't recreate anything. The order is `init` (must exit 0), then `db-init` (must exit 0), then `webapp`; the database, PostgREST, go2rtc and the updater are never touched. Each swap renames the old container to `<name>-before-update`, creates the new one under the real name, sets the old one's restart policy to `no`, stops it and starts the new one; a refused create or start puts the old one back at once. After the health wait and smoke check the old containers are removed (`docker rm`, never their volumes); on a failure they are renamed back and started, so the exact containers from before run again, and the release is held as usual. A journal (`updater/swap`) records each swap first: if the updater is killed or the host reboots in the middle, its next check (at once when the updater starts again) puts the originals back, or, when the update had already come up healthy, removes them. It only ever removes a container the update itself made: if the stack was redeployed from the UI in the meantime, it leaves what the UI made alone and says so in its log. The check runs in a sibling container (as in compose-file mode, without the folders), so a Pull and redeploy that recreates the updater itself does not cut an update short. The reference a container runs never changes in this mode, so a pinned stack stays pinned and a `KINBOARD_TAG` changed in the UI arrives with the UI's own redeploy. Needs `jq` and `curl` in the updater image (both are there) and the socket (or a plain `tcp://` `DOCKER_HOST`, without TLS). What the copy cannot tell apart from the old image's defaults it leaves to the new image: a variable, label, command, user or working directory the stack set to exactly the old image's own value, and a fixed `mac_address`, which Docker reports like an assigned one. `compose.yml` sets none of these.
- **The socket.** It is the one container with `/var/run/docker.sock`, only under the profile; it opens no port and accepts no request. Anything with the socket is root on the host, as with the Diun overlay's webhook.
- `KINBOARD_UPDATE_TICK=off` in the variables pauses it (read at every check). It never recreates its own container: Pull and Up update it.
- `docker exec kinboard-updater kinboard-updater --check-now` runs a check now, through the same lock as the loop's (`kinboard-self-update.sh` there does the same). `kinboard-updater --help` lists the options; only the container's own start runs the loop.

#### Tuning the cadence

Edit `webapp/docker/diun/diun.yml` — `watch.schedule` is a cron expression (default: every 30 min). The GHCR build itself takes ~4 min after a tag push, so polling more aggressively than every 5 min wastes Diun's API budget on GHCR.

#### Tail the update log

Each run of `kinboard-self-update.sh` appends timestamped lines to `/var/lib/kinboard-update/kinboard-update.log` on the host. The file is readable by root only (mode 0600), hence `sudo`:

```bash
sudo tail -f /var/lib/kinboard-update/kinboard-update.log
```

#### When an update doesn't start

If a new version doesn't come up healthy, the self-update puts back the images that ran before, on its own, and the top of Settings says *"The update to … didn't start, so Kinboard went back to …"*, with the backup it took and the log under **Details**. Your data is as it was: the backup is from just before the update, and any database change the new version made stays, because migrations are additive and the older version runs on them. If a migration failed partway, the notice names it and the log says so in plain words.

The notice is shown to the install's household: the one family on the install (remembered the first time it opens Settings), or, on an install with several families, the family whose id you put in `INSTANCE_ADMIN_FAMILY_ID` in `.env`; nobody else sees it. The log excerpt and folders show only with the settings unlocked, and passwords, tokens, keys and database rows are taken out of the excerpt before it is stored. When the update cannot read where those secrets are (the containers' settings, say), it stores no excerpt at all, only a line saying so; the full log is still on the host.

That version is then skipped. Kinboard tries again when a newer one is published, or at its next check after **Try again now** in Settings (the 30-minute tick, or the next update Diun announces). The log has every step:

```bash
sudo grep -E 'ERROR|ROLLED BACK|held' /var/lib/kinboard-update/kinboard-update.log
```

#### Manually trigger an update (without waiting for Diun)

```bash
docker exec kinboard-webhook sh -c 'sh "$PROJECT_DIR/webapp/docker/kinboard-self-update.sh"'
```

Same script, same code path. Useful right after pushing a hotfix when you don't want to wait for the next 30-min Diun tick.

#### Updating the auto-updater itself

The script intentionally **excludes** the `webhook` and `diun` services from its own `docker compose up -d` — it's currently executing inside the webhook container, and recreating that container mid-run would SIGKILL the script before it finishes (half-done state, scheduler not recreated, etc.). Most of the auto-updater updates itself anyway:

- `kinboard-self-update.sh` and `hooks.yaml` are read from the checkout, so the next run after a `git pull` uses the new ones.
- The webhook's image is pulled with each update, and when it changed, a short-lived container recreates the webhook after the run (step 9 above).
- `diun.yml`: Diun is restarted when it changed (step 8).

A changed definition of the `webhook` or `diun` service itself (new mounts, a new variable) still takes one `up` from the host:

```bash
cd webapp/docker
./start.sh up
```

#### What you give up

- **Surprise restarts.** When an update lands, the webapp container is recreated — ~30 seconds of downtime. Tabs lose their live-update connection and reconnect.
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
./setup.sh --non-interactive   # fills any missing .env keys
cd webapp/docker
docker compose -f docker-compose.yml -f docker-compose.traefik.yml \
              -f docker-compose.override.yml -f docker-compose.diun.yml up -d
```

The data dirs (`db/`, `backups/`, `storage/`) stay at `/mnt/user/appdata/kinboard/` because `DATA_DIR` is set absolutely. Only the config files moved.

#### Watchtower (removed in 1.18)

The Watchtower overlay was deprecated for a long time and its template, `docker-compose.watchtower.yml.example`, is gone in 1.18: containrrr/watchtower was archived upstream in 2024, and it only ever updated images, never the compose files, migrations and `.env` keys a release brings. **A copy you made of it keeps working:** `docker-compose.watchtower.yml` is your own file, which no update touches, and it names nothing that moved. It still has the same gap, though, so replace it with the Diun overlay:

```bash
cd webapp/docker
mv docker-compose.watchtower.yml docker-compose.watchtower.yml.disabled  # keep as a backup
# In .env, swap the overlay in COMPOSE_FILES:
#   COMPOSE_FILES="-f docker-compose.yml -f docker-compose.diun.yml"
./start.sh up
docker rm -f kinboard-watchtower
```

## Pre-release channel

Kinboard publishes release candidates ahead of stable releases. Running one is how you try a fix before it ships — and how you help catch the problem it *didn't* fix.

Add one line to `webapp/docker/.env`:

```bash
KINBOARD_TAG=next
```

then bring the stack up:

```bash
cd webapp/docker
./start.sh up
```

`next` always points at the newest release candidate, so you set it once. If you run the [Diun auto-update overlay](#updates), each new candidate arrives automatically.

**Going back to stable** — delete the line (or set `KINBOARD_TAG=latest`) and `./start.sh up` again.

> **Back up first.** Release candidates can contain schema migrations that a later stable release changes. Migrations are forward-only: downgrading the image does **not** undo a migration that has already run. Take a backup (Settings → Data & backup, or copy `DATA_DIR`) before switching to `next`, and keep it until you're back on stable.

**Reporting a problem:** quote the exact version from Settings (e.g. `1.6.0-rc.1`), not "next" — `next` moves, so a report against it can't be reproduced later.

Pinning one specific candidate works too, and is worth doing if you want a stable target while you investigate something:

```bash
KINBOARD_TAG=1.6.0-rc.1
```

## Common deployment shapes

### LAN-only on a NAS (no public internet)

- Skip Traefik. Hit `http://<nas-ip>:3001` directly.
- Keep `WEBAPP_PORT=3001` (or expose any port you like).
- No HTTPS — fine inside a trusted network. **Don't expose this to the internet without auth in front.**

> **Trade-off without HTTPS: push notifications and PWA install won't work.** Browsers gate the Service Worker API, Push API, and the install prompt on a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) (HTTPS, or `http://localhost` from the *same* machine). On a phone visiting `http://192.168.x.x:3001`, registering for push silently fails and "Add to Home Screen" produces a regular shortcut without offline support. Everything else (live sync between screens, all integrations, all UI) keeps working — push + PWA install are the only features lost. If you need them on a LAN-only setup, the shortest path is Tailscale Serve, which gives an `https://` address reachable only from your own devices; [HTTPS](HTTPS) has it and the other ways (a reverse proxy on the NAS, a [Cloudflare Tunnel](#reverse-proxied-via-cloudflare-tunnel)). See [Notifications → Requirements](Notifications#requirements-read-this-first) for the full constraint list.

### Behind Traefik with Cloudflare DNS-01

- Traefik configured with Cloudflare cert resolver (or whichever you use).
- `DOMAIN` and `TRAEFIK_CERT_RESOLVER` set in `.env`.
- Traefik watches the `proxy` external network (`TRAEFIK_NETWORK=proxy`).

### Reverse-proxied via Cloudflare Tunnel

A Cloudflare Tunnel makes Kinboard reachable at `https://kinboard.example.com` from anywhere, without opening a port on your router. You get HTTPS for free, and with it push notifications and "Add to Home Screen" as a real app.

The tunnel needs **one route**, to the webapp, which serves the app and its API at the same address. Your screens at home can keep using the LAN address at the same time: every device talks to Kinboard at the address it opened it from.

You need a domain whose DNS is managed by Cloudflare (a free plan is enough) and a running Kinboard.

#### Step 1: Create the tunnel

1. Open the [Cloudflare dashboard](https://one.dash.cloudflare.com/) → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**.
2. Choose **Cloudflared**, give it a name such as `kinboard`, and click **Save tunnel**.
3. Under *Choose your environment*, pick **Docker**. Cloudflare shows a command with a long token after `--token`. **Copy only the token.** You need it in step 2. Don't run the command, and leave this page open.

#### Step 2: Run cloudflared next to Kinboard

1. In `webapp/docker/.env`, add the token:

   ```
   TUNNEL_TOKEN=eyJhIjoi...   # the token from step 1
   ```

2. Create `webapp/docker/docker-compose.override.yml`, or add to it if you already have one:

   ```yaml
   services:
     cloudflared:
       image: cloudflare/cloudflared:latest
       container_name: kinboard-cloudflared
       restart: unless-stopped
       command: tunnel --no-autoupdate run
       environment:
         TUNNEL_TOKEN: ${TUNNEL_TOKEN}
       networks:
         - kinboard
   ```

   It joins Kinboard's own Docker network, so it can reach the webapp by name.

3. Start it. Pass the same `-f` files you always use, plus the override:

   ```bash
   cd webapp/docker
   docker compose -f docker-compose.yml -f docker-compose.override.yml up -d cloudflared
   ```

   If you use `./start.sh`, add `-f docker-compose.override.yml` to `COMPOSE_FILES` in `.env` so the override keeps being used (see [Compose file overlay](#compose-file-overlay)).

4. Back in the Cloudflare dashboard, the tunnel's *Connectors* list should show one connector as **Connected** within a few seconds. Click **Next**.

#### Step 3: Add the route

Under **Public Hostname**, add one entry:

| Subdomain / Domain | Path | Service type | URL |
|---|---|---|---|
| `kinboard` / `example.com` | *(empty)* | HTTP | `kinboard-webapp:3000` |

Using a config file instead of the dashboard? The same route looks like this:

```yaml
ingress:
  - hostname: kinboard.example.com
    service: http://kinboard-webapp:3000
  - service: http_status:404
```

If you changed `PROJECT_NAME` in `.env`, the container is called `<PROJECT_NAME>-webapp`. If `cloudflared` runs on another machine, use `http://<server-ip>:3001`.

> **Set up before 1.15?** Your route may point at `kinboard-kong:8000`, or you may have two routes (`^/(rest|auth|storage|realtime)/` to Kong, the rest to the webapp). Kong is gone: replace them with the single route above, or the tunnel answers with a 502.

#### Step 4: Tell Kinboard its new address

From the repo root, run:

```bash
./setup.sh --url https://kinboard.example.com
```

That sets `SITE_URL`, the address Kinboard puts into links it hands to other apps, such as the calendar feed. Then restart the webapp so it picks up the new `SITE_URL`: `cd webapp/docker && ./start.sh up`.

#### Step 5: Check it

1. Open `https://kinboard.example.com` on your phone with Wi-Fi switched off, so the request really comes from outside.
2. Join with the family code. Your calendar, tasks and so on should appear.
3. If something is off:
   - The tunnel shows a 502 or "Bad gateway": the route still points at `kinboard-kong`, or at a container name that doesn't match your `PROJECT_NAME`. Point it at `kinboard-webapp:3000`.
   - Nothing loads at all: check `docker logs kinboard-cloudflared`.

#### Step 6: Screens at home

Nothing to do. A wall display can stay on `http://<server-ip>:3001` and keeps working when the internet is down; a phone outside uses the domain. Each one talks to Kinboard at the address it opened it from.

#### Optional: a login in front (Cloudflare Access)

With Access, anyone opening Kinboard first has to log in to Cloudflare or present a client certificate. This works because the webapp and the API share one address, and so one Access cookie.

1. **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**, for `kinboard.example.com`, with a policy that allows your family's email addresses.
2. Some callers can't log in. Add a second application for these paths with a **Bypass** policy:

   | Path | Who calls it |
   |---|---|
   | `/api/integration/*` | Home Assistant and other Integration API clients (they bring their own `kbi_` token) |
   | `/api/mcp`, `/api/oauth/*`, `/.well-known/*` | AI assistants such as ChatGPT and Claude, which bring their own OAuth |
   | `/api/health` | uptime checks |

   The consent page an assistant opens, `/oauth/consent`, stays behind the login, because you open it yourself.
3. **Wall displays:** an Access login expires (after 24 hours by default), and the screen then shows Cloudflare's login page instead of the board. Give your kiosks a long session duration, a client certificate (mTLS), or keep them on the LAN address (step 6).

#### What doesn't go through a tunnel

Live WebRTC camera streams use UDP, which a tunnel doesn't carry, so they only play on the LAN.

## Pitfalls and gotchas

- **`docker-compose up -d --no-deps webapp` won't pick up override files**: Compose only auto-loads `docker-compose.override.yml`, not `docker-compose.traefik.yml`. Always pass `-f` flags explicitly when restarting individual services.
- **Internal subnet `10.200.0.0/24`**: collides with some VPNs. Override via `NETWORK_SUBNET` in `.env`.
- **`init.sql` runs once on first DB init**, never again. Subsequent schema changes ship as `webapp/docker/migrations/NNN_topic.sql` files; the webapp container applies the ones it hasn't applied yet on every start and records them in `kinboard.schema_migrations`.
- **`webapp/docker/kong.yml` is unused since 1.15.** It stays in the repo so that `git pull --ff-only` keeps working on installs whose copy holds real keys. Leave it alone; nothing reads it.
- **Browser shows 400 on `/rest/v1/devices?...&hardware_id=eq...`**: the migration that adds `devices.hardware_id` and `devices.fingerprint` didn't run. Run `cd webapp/docker && ./start.sh migrate` to apply all pending migrations + reload PostgREST's schema cache. (Normally the webapp does this on start; check `docker logs kinboard-webapp` for `[migrate]` lines if it didn't.)

## Related

- [Quick-start](Quick-start) — the bring-up, first family, joining devices
- [Notifications](Notifications) — VAPID + cron details
- [Architecture](Architecture#database-schema) — what's in Postgres
- [Troubleshooting](Troubleshooting) — when it breaks
