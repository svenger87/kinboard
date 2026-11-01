# Troubleshooting

A growing list of common breakages and fixes. This page is an **index**: genuinely cross-cutting issues (stack won't start, ports, reachability, real-time sync, deployment, performance, data) are documented here in full. Per-integration issues live on that integration's own page — this page links to them. If your problem isn't here, open an issue with reproduction steps.

## Setup / first run

### `npm ci` fails with "Missing: @swc/helpers from lock file"

npm 10 and npm 11 disagree about how a lockfile records a transitively-nested dependency, and `npm ci` refuses to install rather than guessing. Kinboard's lockfile is generated with npm 11; run `npm ci` with npm 10 (which is what Node 20 bundles) and you get:

```
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json ... are in sync.
npm error Missing: @swc/helpers@0.5.23 from lock file
```

The lockfile is not stale — regenerating it with npm 11 reproduces it byte for byte. It's the npm version that's wrong.

The repo pins the package manager in `webapp/package.json`:

```json
"packageManager": "npm@11.19.0"
```

Activate it with Corepack, which ships with Node:

```bash
cd webapp
corepack enable npm   # the explicit `npm` matters — plain `corepack enable` only shims yarn/pnpm
npm ci
```

Or install it directly if you'd rather not use Corepack:

```bash
npm install -g npm@11.19.0
```

This is also worth doing if you develop on more than one machine (a Windows laptop and a Linux box, say): mismatched npm versions rewrite parts of the lockfile on every install, producing diff noise that has nothing to do with your change.

### `setup.sh` errors on macOS — "command not found: bash"

The script uses bash 4-isms (associative arrays, `[[ ... ]]`). macOS ships bash 3.2 by default. Install via Homebrew:

```bash
brew install bash
```

Then re-run with the new shell:

```bash
/usr/local/bin/bash ./setup.sh
```

### The version in Settings doesn't change after an upgrade

You pull, you restart, everything comes up clean — and Settings still shows the old version.

Check what compose actually resolved:

```bash
docker compose $COMPOSE_FILES config | grep -A1 "^  webapp:"
```

Since 1.15 `docker-compose.yml` runs the published image (`image: ghcr.io/svenger87/kinboard:...`) on its own. If you see `image: kinboard-webapp:local` and a `build:` section instead, `docker-compose.build.yml` is in your `COMPOSE_FILES`, and compose is **building the webapp from the source checkout in that directory**. A checkout that hasn't been `git pull`ed rebuilds the version it was already on, so the upgrade appears to do nothing. Drop that file from `COMPOSE_FILES` to run the published image again.

If you genuinely want to build from source, that's fine — just `git pull --ff-only origin main` first, or you will rebuild the version you already have.

Also check `KINBOARD_TAG` in `.env`: a pinned version (`KINBOARD_TAG=1.14.0`) stays where it is however often you pull.

### Stack starts but webapp returns 404 on every URL

Most common cause: you ran `docker compose up -d` against the **base** compose file but you actually need the **Traefik override** loaded too (the base file has no Traefik labels). Either:

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d
```

Or use the helper:

```bash
export COMPOSE_FILES="-f docker-compose.yml -f docker-compose.traefik.yml"
./start.sh up
```

If you're hitting Kinboard directly (no Traefik), check that `WEBAPP_PORT` in `.env` matches the URL you're using.

### Logs show `password authentication failed for user "authenticator"` (rest crash-loops)

PostgREST's login role (`authenticator`) ships with an empty password in the Supabase Postgres image and needs aligning to `POSTGRES_PASSWORD`. The one-shot `db-init` service does that before `rest` starts, so a plain `docker compose up -d` works. If you see this, check `docker logs kinboard-db-init`: it must end with `authenticator password aligned.` A `POSTGRES_PASSWORD` changed in `.env` after the database was created is the usual cause — the database keeps the password it was created with.

### The page loads, but photos or uploads fail (503)

The webapp keeps uploaded files in `${DATA_DIR}/storage/files/`, mounted into the container at `/var/lib/storage`. An image from 1.15 on running with an older `docker-compose.yml` (typically an install that Watchtower updates without a `git pull`) has no such mount: existing pictures still load through the old storage container, but every upload answers 503. `git pull`, then `cd webapp/docker && ./start.sh up` (or `docker compose ... up -d --remove-orphans`). See [UPGRADING.md](https://github.com/svenger87/kinboard/blob/main/UPGRADING.md#115--one-container-serves-everything).

### `docker compose up` fails with `service "kong" has neither an image nor a build context specified`

An overlay of yours (`docker-compose.override.yml`, an old `docker-compose.traefik.yml`, …) still adds labels or settings to `kong`, `storage`, `realtime`, `auth` or `imgproxy`. Those services were removed from `docker-compose.yml` in 1.15, so the overlay's block is now a service with no image. Delete those blocks and run `./start.sh up` again. Until you do, the install stays on the version it was on, untouched.

### `crypto.randomUUID is not a function` — setup wizard (or other pages) crash on a LAN HTTP address

`crypto.randomUUID` only exists in a **secure context** (HTTPS, or `http://localhost`). On a plain-HTTP LAN address (e.g. `http://192.168.1.50:3001`) it's undefined, which used to crash the setup wizard's People step. **Fixed in current images** (a `safeRandomUUID()` fallback). To resolve: update to the latest image, or — the better long-term fix for push notifications and PWA install too — serve Kinboard over HTTPS (Traefik + Let's Encrypt; see [Self-hosting](Self-hosting)).

### Can't open Kinboard from phones / tablets — only works on the machine running it

Every device talks to Kinboard at the address it opened it from, so this is a reachability problem, not a setting: the phone has to reach the server on `WEBAPP_PORT` (3001). Check that you're opening `http://<server-LAN-IP>:3001` and not `localhost`, and that no firewall on the server blocks the port. Under WSL, see [Windows (WSL) as a host](Windows-WSL-Host).

An old `API_EXTERNAL_URL=http://localhost:8100` in `.env` is not the cause any more: since 1.15 nothing reads it.

### "Database is empty / can't load" on dashboard

Either:
- The DB volume bind path changed when you upgraded to the templated `docker-compose.yml`. Check `DATA_DIR` in `.env` matches your existing data path.
- Cookies are stale. Clear cookies for the site (specifically the `family-store` cookie) and rejoin via `/join`.

## Real-time sync

### Edits on one device don't appear on the other

1. Check that both devices are connected to the same family — Settings → top of page → join code matches
2. Open the browser dev tools → Network and look for the request to `/api/realtime`. It is a long-lived Server-Sent Events stream (type `eventsource`) that should stay open. If it keeps failing, check the webapp's log (`docker logs kinboard-webapp`), and if you're behind a reverse proxy, make sure it doesn't buffer responses or cut long-lived connections short.
3. If the stream is open but nothing arrives when you edit on the other device, see [Architecture → Real-time invalidation](Architecture#real-time-invalidation). Reloading the page always fetches the current data.

## Integrations

Per-integration issues are documented on each integration's own page:

- **Google Calendar** — redirect URI mismatch, "Reconnect" banner, no calendars listed: [Google-Calendar → Troubleshooting](Google-Calendar#troubleshooting)
- **CalDAV** — authentication failed, wrong server URL, self-signed certificates, a calendar that stopped updating: [CalDAV → Troubleshooting](CalDAV#troubleshooting)
- **Home Assistant** — connection failed, CORS, mixed content, token revocation: [Home-Assistant → Troubleshooting](Home-Assistant#troubleshooting)
- **Bring!** — login failed, sync issues: [Bring → Troubleshooting](Bring#troubleshooting)
- **Cameras** — black tile, auth dialogs, WebRTC ICE failures: [Cameras → Troubleshooting](Cameras#troubleshooting)

## Notifications

Test notification doesn't arrive, iOS push not working, subscription issues: [Notifications → Troubleshooting](Notifications#troubleshooting)

## Kiosk

- **Edge doesn't auto-launch, on-screen keyboard, Task Scheduler error codes**: [Kiosk-Windows-11-Mele-4C → Troubleshooting](Kiosk-Windows-11-Mele-4C#troubleshooting)
- **Presence sensor no data / watchdog reconnecting**: [Presence-Sensor → Troubleshooting](Presence-Sensor#troubleshooting)

## Deployment

### `./deploy.sh` step 3 fails on Docker build

The Docker build step does `next build` which runs `tsc --noEmit`. If you have type errors locally that lint didn't catch (the project uses lint-only as default policy), they surface here.

To preempt this: run `npx tsc --noEmit` from `webapp/` before deploying.

### After deploy, all routes 404

If `deploy.sh` recreated the webapp container with only the base compose file (no Traefik override), Traefik dropped the route. Restart with all overlays:

```bash
cd webapp/docker
docker compose -f docker-compose.yml -f docker-compose.traefik.yml -f docker-compose.override.yml up -d --no-deps webapp
```

## Performance

### Dashboard slow to load on the kiosk

- First load fetches a lot of state (events for the next month, todos, shopping items, weather, HA entity states, etc.). Subsequent loads are cached. If chronically slow, profile via the browser dev tools.
- The Mele 4C runs Kinboard fine. Cheaper boxes (Raspberry Pi 4 with browser kiosk) may struggle — the bottleneck is Chromium's React runtime, not the network.

### Edge eats RAM on the kiosk

Set Edge to start with limited tab discarding via Group Policy:

```
HKLM\SOFTWARE\Policies\Microsoft\Edge
  AutomaticFullscreenAllowedForUrls = ["[*.]your-kinboard-domain"]  (REG_MULTI_SZ)
```

Or simpler: schedule a daily Edge restart at 03:00 via a separate scheduled task that kills Edge and re-launches it.

## Database / data

### "Settings lost after deploy"

Almost always a cookie issue, not actual data loss. Verify the `family-store` cookie still points at the right family ID:

```js
// browser console
document.cookie
```

If the cookie is missing, you'll be on `/join` and creating a new family looks like data loss. The original family's data is still in the DB; rejoin with the original code.

### `pg_dump` errors with permission denied

```
pg_dump: error: query failed: ERROR:  permission denied for table feature_flags
pg_dump: detail: Query was: LOCK TABLE _realtime.feature_flags IN ACCESS SHARE MODE
```

You're dumping as `postgres`, which is **not** a superuser in the Supabase
image — `supabase_admin` is. Some schemas belong to `supabase_admin` (on an
install that ran the old realtime container, `_realtime` is one of them), and
`pg_dump` takes an `ACCESS SHARE` lock on every table, so it aborts on the
first one `postgres` doesn't own. Dump as `supabase_admin` instead:

```bash
docker exec kinboard-db pg_dump -U supabase_admin -F c postgres > /backups/kinboard.pgdump
```

The same applies to `pg_dumpall`.

**Check any backups taken since your last upgrade.** The failure is quiet: the
dump aborts, but the redirect has already created the file, leaving a couple of
hundred bytes that looks like a backup until you need it.

### A backup is the right size but won't restore

```
pg_restore: error: input file does not appear to be a valid archive
```

If the dump was taken with `docker exec -t`, that's the cause. `-F c` is a
binary format and `-t` allocates a TTY, which rewrites line endings in the
stream and corrupts the archive. The damage is invisible by size — a mangled
dump comes out *larger* than a correct one, so it passes every "is the file
plausible" check.

Drop the `-t`. Use `-i` only when you actually need to pipe something in, as
`pg_restore` does:

```bash
docker exec -i kinboard-db pg_restore -l < /backups/kinboard.pgdump | head
```

That prints a table of contents for a good dump and errors on a bad one, and is
worth running on every backup — it catches both this and the permission failure
above.

## When all else fails

```bash
# Capture the state for an issue report
cd webapp/docker
./start.sh status > /tmp/kinboard-status.txt
docker logs kinboard-webapp --tail 200 > /tmp/kinboard-webapp.log
docker logs kinboard-rest --tail 100 > /tmp/kinboard-rest.log

# File an issue with all three attached
```

[Open a bug report on GitHub](https://github.com/svenger87/kinboard/issues/new?template=bug_report.yml).
