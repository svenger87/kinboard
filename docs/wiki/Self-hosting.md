# Self-hosting

This is the deeper deployment guide. If you just want to bring up the stack, see [Quick-start](Quick-start) first.

## What URL should I use?

**Whichever address reaches your server.** Since 1.13 the browser talks to Kinboard's API at the address it opened Kinboard from, so there is nothing to get right in advance: the kitchen tablet can use `http://192.168.1.50:3001`, your phone `https://kinboard.example.com`, and both work against the same stack at the same time.

| Your setup | Open Kinboard at |
|---|---|
| **Just trying it on the same machine** | `http://localhost:3001` |
| **Home server / NAS** (phones and tablets in the house) | `http://<your-server-LAN-IP>:3001` (find it with `hostname -I`, or in your router) |
| **Cloud server with no domain** | `http://<your-server-public-IP>:3001` |
| **A domain, through Traefik or a Cloudflare Tunnel** | `https://kinboard.your-domain.com` |

`setup.sh` no longer asks. It prints the address it expects you to use and stores it as `SITE_URL`, which is only used for links Kinboard hands to other apps (the calendar feed you subscribe to on your phone). `./setup.sh --url https://kinboard.example.com` changes it.

### How it works

Two parts of Kinboard answer a browser: the webapp, and the API gateway (Kong) that every piece of data comes from. Kong is now the front door. It listens on port `3001` and sends `/rest`, `/auth`, `/storage` and `/realtime` to the API, and everything else to the webapp. One address, one port, no CORS, and a tablet at home keeps working when the internet is down, because it never leaves the house.

Two settings in `webapp/docker/.env` decide this:

| Setting | Meaning |
|---|---|
| `KINBOARD_ENTRY=kong` | Kong answers on `WEBAPP_PORT` (3001). The default for new installs. Kong also keeps its own port, `KONG_HTTP_PORT` (8100). |
| `KINBOARD_ENTRY=webapp` | The webapp answers on 3001 itself, as before 1.13, and the browser uses `API_EXTERNAL_URL` for data. |
| `API_EXTERNAL_URL=` (empty) | The browser uses the address the page came from. Leave it empty unless you need the next row. |
| `API_EXTERNAL_URL=https://api.example.com` | A separate API host, for setups that really keep Kong somewhere else. Set it with `./setup.sh --api-url https://api.example.com`; `--api-url same-origin` switches back. |

The front door needs one route in `webapp/docker/kong.yml`, which `setup.sh` adds for you. It's the block whose lines all end in `# kinboard_entry`. Every other line of that file, including your keys, stays exactly as it was.

### Installs from before 1.13

Your install keeps working exactly as it did: until it has been moved, it has no `KINBOARD_ENTRY` line, which means `webapp`, and the browser keeps using your `API_EXTERNAL_URL`.

The move happens on its own, carefully. `setup.sh` adds the route to `kong.yml`. Then the next `./start.sh up`, or the next auto-update, asks Kong for the start page from inside the stack. **Only if the webapp answers through Kong** does it write `KINBOARD_ENTRY=kong` and move port 3001 from the webapp to Kong. If anything about that fails, the install stays on the webapp, `.env` is put back exactly as it was, and the log says why (`entry: staying on webapp: ...`). Your bookmarks keep working either way: the address and port are the same, only the container behind them changes.

What the move costs: the webapp container is recreated (without its port) and Kong is recreated (with it). During an auto-update that is the same restart the new image needs anyway, so it adds nothing; Kinboard is unreachable on 3001 while the new webapp applies its migrations and starts, as on any update. Run on its own, the move takes that one restart.

Not moved automatically:

- an install whose `API_EXTERNAL_URL` names a **different host** than `SITE_URL`, a separate API host. A proxy (Nginx Proxy Manager, Caddy, cloudflared) may send the app's name to the webapp container and only the API's name to Kong, and that would break. Such an install keeps working as it is and can opt in;
- an install behind Traefik (below).

If the move is interrupted, only the `KINBOARD_ENTRY` line is put back; everything else in `.env` stays as it is. A stopped `./start.sh` (Ctrl-C) or a failed `docker compose up` does that on the spot, together with the old layout. When nothing can run (the update container stopped with `docker stop`, a power cut), `webapp/docker/.env.pre-entry` is left behind and nothing answers on 3001 until the next `./start.sh up` or update, which restores it. After a move was undone, no new attempt is made for 24 hours (`webapp/docker/.env.entry-state`; delete it to try again now, or set `ENTRY_RETRY_AFTER` in seconds).

**Firewalls:** after the move, port 3001 belongs to the Kong container. Rules that name the port on the host are unaffected; rules keyed to the webapp container (Docker `DOCKER-USER` rules by container IP, or per-container firewall tools) have to follow it to Kong.

Kong waits up to 10 minutes for the webapp on a request (`read_timeout`/`write_timeout` on the front-door service), so restoring a large backup through *Settings → Backup* is not cut off at Kong's default 60 seconds.

- **To stay as you are**, add `KINBOARD_ENTRY=webapp` to `webapp/docker/.env`. Nothing moves an install that has the line. A value other than `kong` or `webapp` (a typo, `Kong`) is corrected to lower case, or to `webapp`, by `setup.sh` and `./start.sh`.
- **To move by hand**, set `KINBOARD_ENTRY=kong`, run `./setup.sh` (it adds the route if it's missing), then `docker restart kinboard-kong` and `./start.sh up`.
- **Behind Traefik**, nothing moves automatically: Traefik reaches the containers inside the stack, so host ports don't matter to it. See [Behind Traefik](#behind-traefik) for the simpler one-route setup you can opt into.

### Common gotchas

- **The page loads but stays empty, or the console shows `CORS` errors**: the install is still on `KINBOARD_ENTRY=webapp` with an `API_EXTERNAL_URL` that this device can't reach. Open Kinboard at that same host, or move the install to Kong as above.
- **`ERR_CONNECTION_REFUSED` on `/rest/v1/...` from a page on port 3001**: same cause.
- **Don't use `localhost` on other devices.** A phone visiting `localhost` is asking itself, not your server.
- **HTTP vs HTTPS:** plain HTTP is fine on the LAN. Push notifications and "Add to Home Screen" need HTTPS; a [Cloudflare Tunnel](#reverse-proxied-via-cloudflare-tunnel) or [Traefik](#behind-traefik) gives you that.

### Changing the address later

There's nothing to change for the browser. For `SITE_URL` (calendar-feed links), run `./setup.sh --url <address>` from the repo root.

If you use a separate API host (`API_EXTERNAL_URL` set): `./setup.sh --api-url <address>` rewrites it, and Kong's CORS allow-list, the lines marked `# webapp_origin` in `kong.yml`, follows `SITE_URL`. Restart Kong afterwards with `docker restart kinboard-kong` (a `kong reload` is not enough, because DB-less Kong only reads `kong.yml` when it starts) and the webapp with `./start.sh up`.

`./setup.sh` without `--force` is idempotent: it won't regenerate secrets that already exist. `--force` regenerates everything and **invalidates existing device join codes**.

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
| `WEBAPP_PORT` | `3001` | The port the family opens Kinboard at — published by Kong or the webapp, per `KINBOARD_ENTRY` |
| `KINBOARD_ENTRY` | `kong` (new installs) | `kong`: Kong is the front door on `WEBAPP_PORT`. `webapp`: the layout before 1.13. See [What URL should I use?](#what-url-should-i-use) |
| `API_EXTERNAL_URL` | *(empty)* | Empty: the browser uses the address it opened Kinboard from. Set only for a separate API host |
| `KONG_HTTP_PORT` | `8100` | Kong's own host port, kept in both layouts |
| `KONG_TRUSTED_IPS` | private ranges (`127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,::1/128,fc00::/7`) | Whose `X-Forwarded-*` headers Kong believes (https, the client address). Traefik, cloudflared and the LAN are covered. Behind Cloudflare's proxy **without** a tunnel (orange cloud straight to your port), add [Cloudflare's ranges](https://www.cloudflare.com/ips/), or Kinboard sees every request as plain http from Cloudflare |
| | | The private-range default assumes Docker hands Kong the client's own source address. Rootless Docker, IPv6 through the userland proxy and some NAS setups show every client as a Docker-internal address instead; there, set `KONG_TRUSTED_IPS` to the proxies you really have (or `127.0.0.1/32` if none) |
| `KONG_REAL_IP_HEADER` / `KONG_REAL_IP_RECURSIVE` | `X-Forwarded-For` / `on` | How Kong finds the client behind those proxies; it passes the result to the webapp as `X-Real-IP` for its rate limits |
| `KONG_WORKERS` | `2` | nginx worker processes in Kong — nginx would otherwise start one per host CPU |
| `NETWORK_SUBNET` | `10.200.0.0/24` | Internal Docker network subnet (change if it collides) |
| `TZ` | `UTC` | Timezone passed to go2rtc |
| `DOMAIN` | `kinboard.example.com` | Public domain — only consumed by the Traefik overlay |
| `TRAEFIK_CERT_RESOLVER` | `letsencrypt` | Name of your Traefik cert resolver |
| `TRAEFIK_NETWORK` | `proxy` | External network Traefik watches |
| `PHOTON_URL` | *(empty)* | The place search behind the calendar's Location field. Empty: komoot's public [Photon](https://photon.komoot.io) (free, no key). Point it at your own Photon to keep those searches on your network |

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
API_EXTERNAL_URL=
ADDITIONAL_REDIRECT_URLS=https://kinboard.example.com
TRAEFIK_CERT_RESOLVER=letsencrypt
TRAEFIK_NETWORK=proxy
```

`API_EXTERNAL_URL` stays empty: the API is on the same domain as the app, which is exactly what "the address the page was opened from" means.

The override registers two HTTP routers — Kong on `/rest|/auth|/storage|/realtime` and webapp on everything else — both behind `Host(${DOMAIN})` with the same cert resolver. Traefik prefers the longer `PathPrefix` rules first, so Kong wins for the API paths and the webapp serves the rest. Traefik reaches both containers inside the stack, so `KINBOARD_ENTRY` doesn't matter to it, and neither the update nor `./start.sh up` changes a Traefik install's layout on its own.

#### The simpler version: one route to Kong

With Kong as the front door, Traefik needs only one target: everything for your domain goes to Kong, and Kong sends pages on to the webapp. `docker-compose.traefik-one-route.yml.example` is that variant. It is optional; the two-router overlay above keeps working.

```bash
cd webapp/docker
cp docker-compose.traefik-one-route.yml.example docker-compose.traefik.yml
# KINBOARD_ENTRY=kong in .env, then ./setup.sh (adds Kong's route if missing)
docker restart kinboard-kong
./start.sh up
```

It keeps the guard that stops a `service_role` key arriving from the internet on the API paths. Kong passes Traefik's `X-Forwarded-Proto: https` on to the webapp (`KONG_TRUSTED_IPS`), so the session cookie stays `Secure`.

#### A separate API host

If the API has to live on its own host, for example `api.kinboard.example.com`, set `API_EXTERNAL_URL` to it (`./setup.sh --api-url https://api.kinboard.example.com`), route that host to Kong, and keep `KINBOARD_ENTRY=webapp`. The browser then calls that host directly, and Kong's CORS allow-list (the `# webapp_origin` lines in `kong.yml`) has to name `SITE_URL`.

> **Re-run `setup.sh` after editing `.env`.** With a separate API host it re-pins Kong's CORS allow-list to the new `SITE_URL`; without that the browser rejects every API response with `blocked by CORS policy`.

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

**Firewall (UFW):** open 80/tcp and 443/tcp publicly. Close 3001 and 8100 — Traefik fronts both. If you've applied Docker-level firewall rules per [Security-and-Threat-Model → Recommended hardening](Security-and-Threat-Model#recommended-hardening), mirror the port change there too (drop `3001` and `8100`, add `80` and `443`).

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
Supabase image. The `_realtime` schema is split between owners and `pg_dump`
locks every table, so as `postgres` it aborts on the first table it doesn't
own — `permission denied for table _realtime.feature_flags` or similar. Which
tables sit under which owner changes with the realtime image version, so this
can start failing on a setup that had been fine for months.

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
tar --xattrs --xattrs-include='*' -czf /backups/kinboard-storage-$(date +%F).tar.gz \
  -C "${DATA_DIR}" storage
```

**`--xattrs --xattrs-include='*'` is not optional, and leaving it off fails in
the worst possible way.** Storage keeps each object's content type and cache
headers in extended attributes on the file itself, not in the database:

```
user.supabase.content-type="image/jpeg"
user.supabase.cache-control="max-age=3600"
```

A plain `tar -czf` copies the bytes and silently drops those. The restore then
looks perfect — right files, right sizes, right paths, matching rows in the
database — and every image returns **HTTP 500**:

```
{"code":"ENODATA","errno":61}  The extended attribute does not exist.
```

Nothing in the app says what is wrong; the pictures simply do not load. The
same flags are needed again when extracting, so the attributes survive the trip
back.

Objects are write-once, so this can be `tar`'d while the stack is up.

Per-family settings live in `public.settings` (JSONB) and come along with the `pg_dump`.

### Restoring one

Bring the stack up **first**, then restore the data into it:

```bash
# 1. a clean, fully started stack — empty, but with the current schema
cd webapp/docker
./start.sh up
# wait until http://localhost:3000 answers

# 2. put the data back
docker exec -i kinboard-db pg_restore -U supabase_admin -d postgres \
  --data-only --disable-triggers -n public < /backups/kinboard-2026-08-09.pgdump

# 3. put the uploaded files back, and the rows that point at them
docker exec -i kinboard-db pg_restore -U supabase_admin -d postgres \
  --data-only --disable-triggers -n storage -t objects < /backups/kinboard-2026-08-09.pgdump

tar --xattrs --xattrs-include='*' -xzf /backups/kinboard-storage-2026-08-09.tar.gz \
  -C "${DATA_DIR}"

docker restart kinboard-storage
```

**Step 3 is a separate restore on purpose.** `-n public` selects the public
schema and nothing else, so it does not bring back `storage.objects` — the rows
that tell storage which files exist. Restoring only the public schema leaves a
photo library that lists pictures it cannot show. Restoring the whole `storage`
schema is the wrong fix in the other direction: `storage.buckets` has already
been populated by the migrations that ran when the stack started, so a
wholesale restore collides with them. `-t objects` takes the one table that
holds the household's data.

Three things about that are load-bearing, and each of them fails quietly if you
get it wrong.

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

`webapp/docker/test-backup-restore.sh` runs this whole cycle — seed, dump,
destroy, rebuild, restore, compare every table's row count — against the
current schema, so the procedure above is verified rather than remembered.

## Updates

Pull the new code, re-run lint, restart the stack:

```bash
git pull
cd webapp/docker
./start.sh restart   # rebuilds webapp + restarts webapp + cron
```

The scheduler (`cron`, ofelia) reads its jobs from the webapp container's labels only when it starts, so whenever the webapp container is recreated, `cron` has to be recreated after it or a job a release adds never runs. `./start.sh restart` always does this, and `./start.sh up` and the Diun self-update do it whenever they recreated the webapp. If you recreate the webapp some other way (`docker compose up -d webapp`), follow it with `docker compose up -d --no-deps --force-recreate cron`, with the same `-f` files.

Schema changes ship as new files in `webapp/docker/migrations/` (idempotent — safe to re-apply). **You do not normally need to run them**: the webapp container applies every migration when it starts, so pulling a new image and restarting is enough, and it refuses to start rather than serve against a half-applied schema.

The manual path is still there for when the container could not do it — no `POSTGRES_PASSWORD` in the webapp's environment, say:

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

The recommended path is the **Diun + webhook overlay** (`docker-compose.diun.yml.example`). It runs the FULL upgrade sequence end-to-end whenever a new GHCR image lands:

1. `git pull --ff-only origin main` — picks up new compose files, migrations, `init.sql`, `seed-demo.sql`
2. `./setup.sh --non-interactive` — re-substitutes Kong placeholders, and adds routes a release needs to your own `kong.yml` without touching the rest of it
3. `docker compose -f docker-compose.yml -f docker-compose.image.yml pull --ignore-buildable` — pulls the new GHCR image(s); skips the locally-built webhook image.
   **Name both files.** `docker compose` only auto-loads `docker-compose.yml` and `docker-compose.override.yml`; the published image lives in `docker-compose.image.yml`. Leave it out and compose silently falls back to `build:` and rebuilds from whatever source is on disk — which looks like a successful upgrade that changes nothing. `./start.sh up` adds the overlay for you.
4. `docker compose up -d` (with webhook + diun excluded — see below) — recreates only services whose image changed; the webapp's entrypoint re-applies all `migration_*.sql` on boot (idempotent)
5. `docker compose up -d --no-deps --force-recreate cron` — only when step 4 recreated the webapp, because the scheduler reads its jobs from the webapp's labels only when it starts
6. `docker restart kinboard-kong` — only when `kong.yml`'s mtime moved during the run
7. `kinboard-entry.sh` — for an install with no `KINBOARD_ENTRY` in `.env`: asks Kong for the start page from inside the stack and, only if the webapp answers, writes `KINBOARD_ENTRY=kong`. That is decided before step 4, so step 4's single recreate installs the new image and moves port 3001 to Kong together; it is confirmed after step 4, with a standalone move as the fallback. Otherwise the install stays on the webapp and the log says why. See [Installs from before 1.13](#installs-from-before-113)

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

> **Trade-off without HTTPS: push notifications and PWA install won't work.** Browsers gate the Service Worker API, Push API, and the install prompt on a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) (HTTPS, or `http://localhost` from the *same* machine). On a phone visiting `http://192.168.x.x:3001`, registering for push silently fails and "Add to Home Screen" produces a regular shortcut without offline support. Everything else (live sync via Supabase Realtime, all integrations, all UI) keeps working — push + PWA install are the only features lost. If you need them on a LAN-only setup, the easiest paths are: (a) issue a self-signed cert and trust it on every device (rough); (b) use a [Cloudflare Tunnel](#reverse-proxied-via-cloudflare-tunnel) which gives you HTTPS without opening ports; or (c) terminate TLS on the NAS itself with Traefik + a private CA you control. See [Notifications → Requirements](Notifications#requirements-read-this-first) for the full constraint list.

### Behind Traefik with Cloudflare DNS-01

- Traefik configured with Cloudflare cert resolver (or whichever you use).
- `DOMAIN` and `TRAEFIK_CERT_RESOLVER` set in `.env`.
- Traefik watches the `proxy` external network (`TRAEFIK_NETWORK=proxy`).

### Reverse-proxied via Cloudflare Tunnel

A Cloudflare Tunnel makes Kinboard reachable at `https://kinboard.example.com` from anywhere, without opening a port on your router. You get HTTPS for free, and with it push notifications and "Add to Home Screen" as a real app.

Since 1.13 the tunnel needs **one route**, to Kong, which serves the app and its API at the same address. Your screens at home can keep using the LAN address at the same time: every device talks to Kinboard at the address it opened it from.

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

   It joins Kinboard's own Docker network, so it can reach the webapp and Kong by name.

3. Start it. Pass the same `-f` files you always use, plus the override:

   ```bash
   cd webapp/docker
   docker compose -f docker-compose.yml -f docker-compose.override.yml up -d cloudflared
   ```

   If you use `./start.sh`, add `-f docker-compose.override.yml` to `COMPOSE_FILES` in `.env` so the override keeps being used (see [Compose file overlay](#compose-file-overlay)).

4. Back in the Cloudflare dashboard, the tunnel's *Connectors* list should show one connector as **Connected** within a few seconds. Click **Next**.

#### Step 3: Add the route

Check that Kong is your front door: `webapp/docker/.env` should say `KINBOARD_ENTRY=kong`. New installs do. An install from before 1.13 gets there by itself on its next update or `./start.sh up`; to do it now, set the line, run `./setup.sh` from the repo root and `docker restart kinboard-kong`. See [Installs from before 1.13](#installs-from-before-113).

Under **Public Hostname**, add one entry:

| Subdomain / Domain | Path | Service type | URL |
|---|---|---|---|
| `kinboard` / `example.com` | *(empty)* | HTTP | `kinboard-kong:8000` |

Using a config file instead of the dashboard? The same route looks like this:

```yaml
ingress:
  - hostname: kinboard.example.com
    service: http://kinboard-kong:8000
  - service: http_status:404
```

If you changed `PROJECT_NAME` in `.env`, the container is called `<PROJECT_NAME>-kong`. If `cloudflared` runs on another machine, use `http://<server-ip>:3001`.

<details>
<summary>Keeping the webapp on its own port (<code>KINBOARD_ENTRY=webapp</code>)? Then it takes two routes.</summary>

Add **two** entries with the same hostname, **in this order**, because Cloudflare checks them from top to bottom:

| # | Subdomain / Domain | Path | Service type | URL |
|---|---|---|---|---|
| 1 | `kinboard` / `example.com` | `^/(rest\|auth\|storage\|realtime)/` | HTTP | `kinboard-kong:8000` |
| 2 | `kinboard` / `example.com` | *(empty)* | HTTP | `kinboard-webapp:3000` |

```yaml
ingress:
  - hostname: kinboard.example.com
    path: ^/(rest|auth|storage|realtime)/
    service: http://kinboard-kong:8000
  - hostname: kinboard.example.com
    service: http://kinboard-webapp:3000
  - service: http_status:404
```

In this layout the browser calls the API at `API_EXTERNAL_URL`, so set that to `https://kinboard.example.com` as well in step 4, and screens at home have to use the domain too (step 6).
</details>

#### Step 4: Tell Kinboard its new address

From the repo root, run:

```bash
./setup.sh --url https://kinboard.example.com
```

That sets `SITE_URL` (and `ADDITIONAL_REDIRECT_URLS`), the address Kinboard puts into links it hands to other apps, such as the calendar feed. Then restart the webapp so it picks up the new `SITE_URL`: `cd webapp/docker && ./start.sh up`.

`API_EXTERNAL_URL` stays empty **on an install set up with 1.13 or later**. On an install from before 1.13 that still has an API address in `.env`, `--url` keeps its old meaning and sets `API_EXTERNAL_URL` to the domain too. Leave it: it is the address the browser needs while the webapp still answers on 3001, and because it is on the same host as `SITE_URL`, the browser ignores it once Kong is the front door and uses the page's own address. (Setting `same-origin` on such an install changes nothing: `setup.sh` puts a working address back until the move.)

#### Step 5: Check it

1. Open `https://kinboard.example.com` on your phone with Wi-Fi switched off, so the request really comes from outside.
2. Join with the family code. Your calendar, tasks and so on should appear.
3. If something is off:
   - The tunnel shows Kong's `{"message":"no Route matched with those values"}`: Kong doesn't have its front-door route yet. Run `./setup.sh` and `docker restart kinboard-kong`.
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
