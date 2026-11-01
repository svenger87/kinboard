# Upgrading Kinboard

Most upgrades need nothing from you: pull the new image, restart, and the
entrypoint applies any new database migrations on boot.

The releases below are the exceptions.

---

## 1.15 — one container serves everything

**With the Diun auto-update, there is nothing to do.** Read on if you upgrade by
hand, use Watchtower, keep your own compose overlays, or put a reverse proxy in
front of Kinboard.

### What changes

The stack shrinks from eleven services to six: `db`, `db-init` (a one-shot),
`rest` (PostgREST), `webapp`, `cron` and `go2rtc`. Five are retired:

| Retired | What happens to its job |
|---|---|
| `kong` (API gateway) | The webapp forwards `/rest/v1` to PostgREST itself |
| `realtime` | Live updates come from the webapp, as Server-Sent Events backed by Postgres `LISTEN`/`NOTIFY` |
| `storage` (storage-api) | The webapp stores and serves uploaded files from disk |
| `auth` (GoTrue), `imgproxy` | Nothing — Kinboard never used them |

Everything the browser needs is now on one address and one port,
`WEBAPP_PORT` (3001): the app, the database API at `/rest/v1`, uploaded files at
`/storage/v1/object/public/<bucket>/<path>` (family photos through short-lived
signed links at `/storage/v1/object/sign/…`), and the live-update feed. The
webapp refuses the `service_role` key on `/rest/v1` from outside on every
install; until now that guard (the "rest-gate") only existed behind Traefik.

**Uploaded files** move to `${DATA_DIR}/storage/files/<bucket>/<path>` — inside
the same `storage` directory as before. On its first start the new webapp
hard-links each existing file from the old layout
(`storage/stub/stub/<bucket>/<path>/<version>`) into the new one. Nothing is
copied and the old tree is left exactly where it was; the marker file
`storage/files/.moved-from-storage-api` records that the move ran and what it
found. A backup of the `storage` directory therefore covers both layouts, and
because the content type now comes from the file name, it no longer needs GNU
tar or `--xattrs`.

**Realtime's replication slots** are dropped by the webapp on start once nothing
is attached to them. Left alone, a slot nobody reads holds on to every byte of
WAL until the disk is full. The old chore of restarting `realtime` after a
migration that publishes a table is gone with it.

**Migrations** are now numbered (`webapp/docker/migrations/NNN_topic.sql`) and
recorded with a checksum in `kinboard.schema_migrations`, so each runs once
instead of on every start. The first start on 1.15 applies every file once (as
every start did before) and records them. `./start.sh migrate` runs the same
runner; there is no "run it twice" any more.

**Settings that are now ignored** — a line left in `webapp/docker/.env` does no
harm: `KINBOARD_ENTRY`, `API_EXTERNAL_URL`, `KONG_HTTP_PORT`, `KONG_HTTPS_PORT`,
`KONG_WORKERS`, `KONG_TRUSTED_IPS`, `SECRET_KEY_BASE`, `ADDITIONAL_REDIRECT_URLS`.
`setup.sh --api-url` is accepted and ignored. `webapp/docker/kong.yml` stays in
the repository, unused, so that `git pull --ff-only` keeps working on installs
whose copy holds real keys; leave it alone.

**Compose files.** `docker-compose.yml` now runs the published image,
`ghcr.io/svenger87/kinboard:${KINBOARD_TAG:-latest}`, on its own.
`docker-compose.image.yml` is optional (it only adds `pull_policy: always`) and
can stay in your `COMPOSE_FILES`. To build from source, use
`-f docker-compose.build.yml` (tagged `kinboard-webapp:local`). The Traefik
overlay has a single router to the webapp. Removed:
`docker-compose.entry-kong.yml`, `docker-compose.entry-webapp.yml`,
`docker-compose.traefik.yml.example`,
`docker-compose.traefik-one-route.yml.example` and `test-entry-switch.sh`.

### With the Diun auto-update

Nothing to do. The first run still executes the previous version of the update
script, which `git pull`s and then calls `kinboard-entry.sh prepare` just before
its `docker compose up`. On 1.15 that step removes the retired containers, so
the `up` can give their port to the webapp. The pre-upgrade backup (database
dump and `storage` archive) is taken first, as on every update. From then on the
new update script runs `up` with `--remove-orphans` itself.

### By hand

```bash
git pull --ff-only
./setup.sh --non-interactive
cd webapp/docker
./start.sh up
```

`./start.sh up` removes the retired containers and runs `up` with
`--remove-orphans`. With plain compose, add the flag yourself:

```bash
docker compose $COMPOSE_FILES up -d --remove-orphans
```

Without it the old containers keep running beside the new stack — and Kong, on
installs where it answered on port 3001, keeps the port the webapp now needs.

### With Watchtower (image only, no `git pull`)

The new image keeps working on the old compose file: it reads existing pictures
through the old storage container, and forwards the browser's API requests to
`rest`. Uploads, however, answer **503** until the compose file is updated,
because the old file does not mount the directory the webapp now writes to.
`git pull`, then `docker compose $COMPOSE_FILES up -d --remove-orphans`.
(Watchtower is deprecated; the [Diun overlay](https://github.com/svenger87/kinboard/wiki/Self-hosting#auto-updates)
does the `git pull` for you.)

### If you keep your own compose overlays

An overlay that adds labels or settings to `kong`, `storage`, `realtime`,
`auth` or `imgproxy` — Traefik labels in an old copy of
`docker-compose.traefik.yml`, extras in `docker-compose.override.yml` — now
describes a service with no image, and compose refuses to start:

```
service "kong" has neither an image nor a build context specified
```

The install then stays on the version it was on, untouched; the auto-update
logs the failure and backs off. Delete those blocks, then `./start.sh up`.

### If a reverse proxy sits in front

A proxy (Traefik, Nginx Proxy Manager, Caddy, a Cloudflare Tunnel) that sent
`/rest`, `/auth`, `/storage` or `/realtime` to Kong should now send
**everything** to the webapp (`kinboard-webapp:3000` inside the stack, or
`WEBAPP_PORT` on the host). The shipped Traefik overlay already does. Make sure
the proxy does not buffer responses on long-lived connections, or live updates
arrive late.

### Rolling back

Set the previous image tag (`KINBOARD_TAG=<previous version>` in
`webapp/docker/.env`). The old tree of uploaded files is untouched, so the old
storage service finds every file it had — but the services it needs are only
defined in the previous compose file. Bring that back too:

```bash
git checkout v<previous version>
cd webapp/docker
./start.sh up
```

Migrations are additive, so the older image runs on the newer schema. Files
uploaded while on 1.15 exist only in the new layout and will not show on the
older version.

---

## 1.6.0 — row-level security (**every device must re-join**)

**Before you upgrade, write down your family join code.** Settings → Family, or
see [Recovering a lost join code](#recovering-a-lost-join-code) if you have
already upgraded.

### What changes

Kinboard's browser client talks to PostgREST directly. Until 1.6.0, row-level
security was disabled and every query was filtered in application code
instead — which works, right up until the instance is reachable from outside
your network. The anon key ships in the browser bundle, so with RLS off anyone
who could reach the API could read and write every table, including the one
holding join codes.

From 1.6.0 the database enforces isolation itself:

- a device joins with the family code and gets a server-issued, HttpOnly
  session cookie;
- that cookie is exchanged at `/api/session/token` for a short-lived token
  carrying a `family_id` claim;
- every row-level security policy resolves the caller's family from that claim.

The old `family-calendar-storage` cookie was never a credential — it was the
client's own state, written by JavaScript, unsigned, and never checked by the
server. It is not upgraded to a session, deliberately: honouring it would mean
honouring anything a browser chose to write.

### What you will see

After the upgrade every device shows the join screen. Nothing is lost — the
data is all there, and each device just needs the family code entered once.

Do the kiosk first if you have one, since it is the one that needs someone
standing in front of it.

### Recovering a lost join code

The join code lives in Settings, which you cannot reach while logged out. If
you upgraded without noting it down:

```bash
docker exec kinboard-db psql -U postgres -d postgres \
  -c "SELECT name, join_code FROM public.families;"
```

Adjust the container name if you changed `PROJECT_NAME`. This works because
`psql` connects as a superuser, which bypasses row-level security.

### If you publish Kinboard to the internet

This release is what makes that defensible. Before it, publishing the stack
meant publishing your data — the `/rest`, `/auth`, `/storage` and `/realtime`
paths all reach Supabase with the public anon key.

Verify it yourself after upgrading, from a machine outside your network:

```bash
curl -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  "https://your-kinboard.example/rest/v1/families?select=id,name,join_code"
```

An upgraded instance returns `[]`. Anything else means the migration did not
apply — check the webapp container logs on boot.

### Requirements

`JWT_SECRET` must reach the **webapp** container, not only PostgREST (and,
before 1.15, Kong and GoTrue). It is what signs the family-scoped tokens, and it must be the same
secret PostgREST verifies with. `setup.sh` and the bundled compose file handle
this; if you maintain your own compose file, add it:

```yaml
  webapp:
    environment:
      JWT_SECRET: ${JWT_SECRET}
```

Without it, joining still works but no data loads — the app cannot mint a token
the database will accept.

### Rolling back

If something goes wrong, RLS can be turned off again to restore the previous
behaviour:

```bash
docker exec kinboard-db psql -U postgres -d postgres -c "
DO \$\$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t); END LOOP;
END \$\$;"
```

This restores service immediately, and restores the exposure with it. Treat it
as a way to buy time, not a resting state — and do not publish the instance
while it is in that state.

Until 1.15 the next boot re-applied the migration, so a rollback lasted until
you restarted. Since 1.15 migrations are recorded and run once, so the rollback
stays until you undo it: delete the migration's record and restart the webapp,
which applies it again.

```bash
docker exec kinboard-db psql -U postgres -d postgres \
  -c "DELETE FROM kinboard.schema_migrations WHERE name = '049_row_level_security.sql';"
docker restart kinboard-webapp
```
