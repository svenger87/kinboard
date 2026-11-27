#!/bin/sh
# webapp-entrypoint.sh — applied as the runner stage's ENTRYPOINT.
#
# Applies migrations/NNN_*.sql (through migrate.sh) before exec'ing the
# Next.js server, so pulling a new image with new migrations baked in applies
# them automatically: Diun, Watchtower, a manual pull — anything.
#
# THIS IS THE ONLY THING THAT APPLIES MIGRATIONS AUTOMATICALLY.
#
# start.sh used to apply the same files from the host during `up`, at the same
# time as this ran. The two collided — one creating a table between the other's
# IF NOT EXISTS check and its CREATE, and the storage service taking ownership
# of its tables mid-run (issue #152). Since this path is the one that works
# everywhere (image-only deployments, Watchtower updates, anything that never
# invokes start.sh), it is the one that stayed. `./start.sh migrate` remains as
# an explicit manual escape hatch; `start.sh up` now watches this log instead
# of racing it.
#
# Env vars (passed by docker-compose.yml's webapp service):
#   POSTGRES_HOST     defaults to "db" (the docker service name)
#   POSTGRES_PORT     defaults to "5432"
#   POSTGRES_USER     defaults to "postgres"
#   POSTGRES_DB       defaults to "postgres"
#   POSTGRES_PASSWORD required — from .env, or the secrets store (below)

set -e

# The one-shot steps of a one-file install (RFC-023 §4.1, §4.2), run from this
# image as `command: ["kinboard-init"]` and `command: ["kinboard-db-init"]`.
# They run before any secret exists and start no server, so they go first.
# Without a command (every existing install), nothing here applies.
#
# `kinboard export` / `kinboard import` (RFC-024 §4.4) the same way, for a
# one-off container (`docker compose run … webapp kinboard import -`).
case "${1:-}" in
  kinboard-init | kinboard-db-init | kinboard)
    cmd="$1"
    shift
    exec "${KINBOARD_BIN_DIR:-/usr/local/bin}/$cmd" "$@"
    ;;
esac

# Root for the steps below that own files (moving uploads out of the old
# storage-api layout); the server itself never runs as root. An image run with
# `user:` set skips the file steps and starts as that user.
#
# PUID/PGID (RFC-024 §6.3): the numeric user and group the server runs as and
# the uploaded files belong to, for NAS shares owned by the household's user
# (Unraid's 99:100, 1000:1000 elsewhere). Unset, nothing changes: nextjs:nodejs
# (1001:1001), as before. Only one of them set keeps nextjs's value for the
# other.
RUN_AS="nextjs:nodejs"
RUN_IDS="$(id -u nextjs):$(awk -F: '$1 == "nodejs" { print $3 }' /etc/group)"
if [ -n "${PUID:-}" ] || [ -n "${PGID:-}" ]; then
  for pair in "PUID=${PUID:-}" "PGID=${PGID:-}"; do
    case "${pair#*=}" in
      "" ) ;;
      *[!0-9]* | 0?* )
        # A leading zero too: "000" is not "0" to a string test, but su-exec reads it as root.
        echo "[entrypoint] ${pair%%=*} must be a number (a user or group id) without leading zeros, got '${pair#*=}'; refusing to start." >&2
        exit 1 ;;
    esac
  done
  RUN_AS="${PUID:-${RUN_IDS%%:*}}:${PGID:-${RUN_IDS##*:}}"
  RUN_IDS="$RUN_AS"
  if [ "$(id -u)" = "0" ]; then
    echo "[entrypoint] PUID/PGID set: the server runs as $RUN_AS and owns the uploaded files"
  else
    echo "[entrypoint] PUID/PGID ignored: this container already runs as $(id -u):$(id -g) (user: is set)" >&2
  fi
fi

start_server() {
  if [ "$(id -u)" = "0" ]; then
    exec su-exec "$RUN_AS" node server.js
  fi
  exec node server.js
}

# ---------------------------------------------------------------------------
# The secrets (RFC-023 §4.1), before anything else. Per secret: the
# environment wins; otherwise /kinboard/secrets/<name> from the config volume;
# otherwise, for the anon and service-role keys only, minted from JWT_SECRET.
# Every existing install sets them all in its environment, so for them this
# changes nothing. A required one missing everywhere stops the container here,
# with its name in the log, instead of a server that starts half-configured.
#
# These exports reach the server process only: `docker exec` sees the
# container's configured environment, not them.
# ---------------------------------------------------------------------------
if ! secrets_env="$(node /app/secrets-store.mjs)"; then
  exit 1
fi
eval "$secrets_env"
unset secrets_env

POSTGRES_HOST="${POSTGRES_HOST:-db}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"

export PGPASSWORD="$POSTGRES_PASSWORD"

# Wait for db to be reachable. Cap at ~60s — if it's not up by then,
# something is wrong upstream and we should fail fast rather than spin
# forever in a restart loop.
echo "[entrypoint] waiting for postgres at ${POSTGRES_HOST}:${POSTGRES_PORT} (max 60s)..."
i=0
until pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ $i -gt 30 ]; then
    echo "[entrypoint] postgres still unreachable after 60s; starting webapp anyway (it will retry on its own connections)." >&2
    start_server
  fi
  sleep 2
done
echo "[entrypoint] postgres reachable."

# The migrations. migrate.sh applies each numbered file it has not applied
# before (or whose content changed) and records it in
# kinboard.schema_migrations; a boot with nothing new runs no migration SQL.
MIGRATIONS_DIR="/app/migrations"

# Retained as a backstop for a first boot, where the database may still be
# finishing its own init scripts when this starts. Without a retry the
# container exits, Docker restarts it, and it succeeds anyway by way of a
# crash-loop, which reads exactly like a broken schema.
MIGRATION_ATTEMPTS="${MIGRATION_ATTEMPTS:-6}"

# ---------------------------------------------------------------------------
# The all-in-one image's start guarantees (RFC-024 §4.7). Both are off unless
# the image sets them (webapp/docker/aio/Dockerfile); a compose install never
# does, and for it nothing in this block runs.
#
#   KINBOARD_MIGRATE_BACKUP_DIR  a verified dump (kinboard-backup.sh) before
#       any migration that will run on a database that already has some: no
#       verified dump, no migration, no start, and the log says why. A start
#       that tries the same version on the same pending files again (a
#       restart after a failure) reuses that dump rather than rotating it out
#       with dumps of a half-migrated database.
#   KINBOARD_START_STATE_DIR  `attempt` (the version starting now), `failed`
#       (a version whose migrations failed, and which file), `last-good`
#       (written by the image after its first healthy minute). A failure
#       names the version to go back to; the version that then starts again
#       records the rollback for Settings (instance_settings.update_status,
#       RFC-023 §4.11.4), so the household sees the notice there.
#
# Exit status 100 means "stop the container": the all-in-one image's s6
# service halts on it instead of restarting into the same refusal.
# ---------------------------------------------------------------------------
SELF_VERSION="$(node -p 'require("/app/package.json").version' 2>/dev/null || echo unknown)"
START_STATE="${KINBOARD_START_STATE_DIR:-}"
# The records and the dumps live in the data folder, which belongs to the
# user the server runs as. Root never reads, writes, moves or removes a file
# there itself: a symlink that user (or a compromised server) planted under
# one of these names would otherwise make root write or read wherever it
# points. Every access goes through that user instead, who can reach nothing
# through a link that they could not reach anyway.
as_run_user() {
  if [ "$(id -u)" = "0" ]; then su-exec "$RUN_AS" "$@"; else "$@"; fi
}
# state_get <name> <key>; state_write <name> (stdin); state_rm <name>...
state_get() { as_run_user sed -n "s/^$2=//p" "$START_STATE/$1" 2>/dev/null | head -n 1; }
state_write() {
  as_run_user sh -c 'umask 077; t="$1/.$2.tmp.$$"; rm -f "$t" && cat >"$t" && mv -f "$t" "$1/$2"' sh "$START_STATE" "$1"
}
state_rm() { for n in "$@"; do as_run_user rm -f "$START_STATE/$n"; done; }
if [ -n "$START_STATE" ]; then
  as_run_user mkdir -p "$START_STATE" 2>/dev/null || true
fi

if [ -n "${KINBOARD_MIGRATE_BACKUP_DIR:-}" ] && [ -d "$MIGRATIONS_DIR" ]; then
  attempt=1
  until pending="$(MIGRATIONS_DIR="$MIGRATIONS_DIR" sh /app/migrate.sh --pending)"; do
    if [ "$attempt" -ge "$MIGRATION_ATTEMPTS" ]; then
      echo "[entrypoint] REFUSING to start: could not ask the database which migrations are pending, so no backup could be taken first." >&2
      exit 100
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
  if [ -n "$pending" ]; then
    # "Nothing to back up" only when no migration is recorded AND no family
    # exists: a database restored by hand without its bookkeeping still gets a dump.
    recorded="$(psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq -v ON_ERROR_STOP=1 \
                  -c "SELECT (SELECT count(*) FROM kinboard.schema_migrations) + (SELECT count(*) FROM public.families)" 2>/dev/null || echo error)"
    count="$(printf '%s\n' "$pending" | wc -l | tr -d ' ')"
    case "$recorded" in
      0)
        echo "[entrypoint] a new database: $count migration(s) to apply, nothing to back up yet" ;;
      "" | *[!0-9]*)
        echo "[entrypoint] REFUSING to migrate: could not read which migrations this database has, so no backup could be verified first." >&2
        exit 100 ;;
      *)
        key="$SELF_VERSION $(printf '%s' "$pending" | sha256sum | cut -c1-16)"
        reuse=""
        if [ -n "$START_STATE" ] && [ "$(state_get pre-migrate key)" = "$key" ]; then
          reuse="$(state_get pre-migrate file)"
          case "$reuse" in "$KINBOARD_MIGRATE_BACKUP_DIR"/pre-migrate-*.sql.gz) ;; *) reuse="" ;; esac
          [ -n "$reuse" ] && as_run_user gzip -t "$reuse" 2>/dev/null || reuse=""
        fi
        if [ -n "$reuse" ]; then
          echo "[entrypoint] $count migration(s) pending; the verified backup taken before the last try is still the one to go back to: $reuse"
        else
          echo "[entrypoint] $count migration(s) pending ($(printf '%s' "$pending" | head -n 3 | tr '\n' ' ')...): taking a verified backup first"
          if ! backup="$(PGHOST="$POSTGRES_HOST" PGPORT="$POSTGRES_PORT" PGUSER=supabase_admin PGDATABASE="$POSTGRES_DB" \
                         as_run_user sh /app/kinboard-backup.sh "$KINBOARD_MIGRATE_BACKUP_DIR" pre-migrate)"; then
            echo "[entrypoint] REFUSING to migrate without a verified backup: no migration ran and the server is not started. Free space in $KINBOARD_MIGRATE_BACKUP_DIR, or fix what the line above says, then start again." >&2
            exit 100
          fi
          if [ -n "$START_STATE" ]; then
            printf 'key=%s\nfile=%s\nat=%s\n' "$key" "$backup" "$(date -u +%FT%TZ)" | state_write pre-migrate
          fi
        fi
        ;;
    esac
  fi
fi
# migrate.sh runs as root (it is the same runner compose uses) and names a
# failed file in a fresh root-only temporary file, never in the data folder.
failed_note=""
if [ -n "$START_STATE" ]; then
  printf 'version=%s\nat=%s\n' "$SELF_VERSION" "$(date -u +%FT%TZ)" | state_write attempt || true
  failed_note="$(mktemp)"
fi

if [ -d "$MIGRATIONS_DIR" ]; then
  attempt=1
  until MIGRATIONS_DIR="$MIGRATIONS_DIR" MIGRATE_FAILED_FILE="$failed_note" sh /app/migrate.sh; do
    if [ "$attempt" -ge "$MIGRATION_ATTEMPTS" ]; then
      echo "[entrypoint] GIVING UP after $attempt attempts — refusing to start webapp with stale schema." >&2
      if [ -n "$START_STATE" ]; then
        failed_file="$(head -n 1 "$failed_note" 2>/dev/null | tr -cd 'a-z0-9_.')"
        rm -f "$failed_note"
        printf 'version=%s\nmigration=%s\nbackup=%s\nat=%s\n' "$SELF_VERSION" "$failed_file" \
          "$(state_get pre-migrate file)" "$(date -u +%FT%TZ)" | state_write failed
        good="$(state_get last-good version)"
        if [ -n "$good" ] && [ "$good" != "$SELF_VERSION" ]; then
          echo "[entrypoint] $SELF_VERSION did not start here${failed_file:+ (migration $failed_file failed)}. The last version that ran healthy on this data is $good: set the image tag back to $good to run it again. The migrations are additive, so it runs on this schema. The verified backup from before this try: $(state_get pre-migrate file)" >&2
        fi
        exit 100
      fi
      exit 1
    fi
    echo "[entrypoint] migration attempt $attempt failed; retrying in 5s (the database may still be initialising)" >&2
    attempt=$((attempt + 1))
    sleep 5
  done

  # The migrations went through: the dump taken for them is no longer "the one
  # to retry with", so the next pending migration always gets a dump of its own.
  [ -z "$failed_note" ] || rm -f "$failed_note"
  if [ -n "$START_STATE" ]; then state_rm pre-migrate; fi

  # A version that failed here before this one started (RFC-024 §4.7): this
  # one ran its migrations, so the household went back. Settings shows the
  # rollback notice from this record, as after kinboard-updater's rollback.
  failed_version=""
  if [ -n "$START_STATE" ]; then failed_version="$(state_get failed version)"; fi
  if [ -n "$failed_version" ]; then
    if [ -n "$failed_version" ] && [ "$failed_version" != "$SELF_VERSION" ]; then
      record="$(FROM="$SELF_VERSION" TO="$failed_version" MIG="$(state_get failed migration)" \
        BK="$(state_get failed backup)" AT="$(state_get failed at)" node -e '
        const e = process.env, b = e.BK || "";
        process.stdout.write(JSON.stringify({ status: "rolled_back", at: e.AT || new Date().toISOString(), from: e.FROM, to: e.TO,
          services: "kinboard-aio", backup: b.split("/").pop(), backup_dir: b ? b.slice(0, b.lastIndexOf("/")) : "", backup_at: "",
          migration: e.MIG || "", severe: Boolean(e.MIG), log_file: "", log: "" }));')"
      if printf '%s\n' "INSERT INTO public.instance_settings (key, value) VALUES ('update_status', :'v')
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();" \
         | psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q -v ON_ERROR_STOP=1 -v "v=$record" >/dev/null; then
        echo "[entrypoint] $failed_version did not start here before; $SELF_VERSION runs again, and Settings says so"
      else
        echo "[entrypoint] could not record for Settings that $failed_version did not start" >&2
      fi
    fi
    state_rm failed
  fi

  # The server's own time zone, for the database's "today" when a family has
  # not picked one (#341) -- the zone the rest of the server already falls
  # back to. Passed as a psql variable, never pasted into the SQL; kept only
  # when Postgres knows the zone, and cleared when TZ is unset or unknown, so
  # the database falls back exactly where lib/family-time.ts does.
  if ! psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
            -v ON_ERROR_STOP=1 -v tz="${TZ:-}" -q >/dev/null <<'SQL'
DELETE FROM public.instance_settings
 WHERE key = 'server_timezone' AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = :'tz');
INSERT INTO public.instance_settings (key, value)
SELECT 'server_timezone', :'tz' WHERE EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = :'tz')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
SQL
  then
    echo "[entrypoint] could not record the server's time zone; the database falls back to Europe/Berlin" >&2
  fi

  # The push key (RFC-023 §6.4): which VAPID public key this install runs
  # with, against the one its push subscriptions were made with. A different
  # one (a restore without the config folder, regenerated keys) means those
  # subscriptions can never receive a push again: they are switched off, the
  # log says so, and Settings asks the family to turn push on again on each
  # device (migrations/095, src/lib/push-key.ts, which computes the same
  # fingerprint: SHA-256 of the public key's bytes; nothing secret).
  push_fp="$(PUSH_PUBLIC_KEY="${VAPID_PUBLIC_KEY:-${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}}" node -e '
    const s = (process.env.PUSH_PUBLIC_KEY || "").trim();
    const b = Buffer.from(s, "base64url");
    if (s && b.length) process.stdout.write("sha256:" + require("node:crypto").createHash("sha256").update(b).digest("hex"));
  ' 2>/dev/null || true)"
  if [ -n "$push_fp" ]; then
    if push_out="$(PGOPTIONS="-c client_min_messages=warning" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
                     -v ON_ERROR_STOP=1 -v fp="$push_fp" -tAq -F ' ' 2>&1 <<'SQL'
SELECT coalesce(previous, '-'), backfilled, deactivated, removed FROM kinboard.push_key_check(:'fp');
SQL
)"; then
      read -r push_prev push_backfilled push_off push_removed <<EOF
$push_out
EOF
      if [ "${push_off:-0}" != 0 ]; then
        echo "[entrypoint] push: the VAPID key changed (was ${push_prev}, now ${push_fp}); ${push_off} device subscription(s) made with the old key can't receive notifications any more and were switched off (and ${push_removed:-0} inactive one(s) of that key removed). Push needs to be turned on again on each device; Settings lists them." >&2
      elif [ "$push_prev" = "-" ]; then
        echo "[entrypoint] push: recorded the VAPID key's fingerprint (${push_fp}); ${push_backfilled:-0} existing subscription(s) marked with it"
      elif [ "$push_prev" != "$push_fp" ]; then
        echo "[entrypoint] push: the VAPID key changed (was ${push_prev}, now ${push_fp}); no device had notifications on with the old key"
      fi
    else
      echo "[entrypoint] could not check the push key against the subscriptions: $push_out" >&2
    fi
  fi
else
  echo "[entrypoint] no migrations directory at $MIGRATIONS_DIR; skipping."
fi

# ---------------------------------------------------------------------------
# Realtime's replication slots (1.15).
#
# The supabase/realtime container held logical replication slots. A slot
# keeps every byte of WAL its consumer has not read, and with the consumer gone
# nothing reads it again: pg_wal grows until the disk is full and Postgres
# stops. So any slot realtime left behind is dropped once nothing is attached
# to it. One still in use (a stack whose compose file still runs realtime) is
# left alone. supabase_admin, because dropping a slot needs REPLICATION, which
# `postgres` lacks in this image; it shares POSTGRES_PASSWORD.
# ---------------------------------------------------------------------------
slots="$(psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U supabase_admin -d "$POSTGRES_DB" -tAq -v ON_ERROR_STOP=1 <<'SQL' 2>&1
SELECT slot_name || ' ' || pg_drop_replication_slot(slot_name)::text
  FROM pg_replication_slots
 WHERE slot_name LIKE 'supabase_realtime%' AND NOT active;
SQL
)" || echo "[entrypoint] could not check for realtime's replication slots: $slots" >&2
for slot in $slots; do
  case "$slot" in supabase_realtime*) echo "[entrypoint] dropped replication slot $slot (realtime is gone)" ;; esac
done

# ---------------------------------------------------------------------------
# Files from storage-api (1.15).
#
# Uploaded files now live at $FILES_DIR/<bucket>/<key> (lib/files/store.ts).
# storage-api kept each object at <volume>/stub/stub/<bucket>/<key>/<version>,
# with the version recorded in storage.objects. FILES_DIR sits inside that same
# volume, so each object is hard-linked across: no copy, no extra disk, and
# the old tree stays as it was in case anything has to be rolled back. Only
# when a link is impossible is the file copied.
#
# Once, then never again: a marker file records the move (see below for when
# it is written). Objects already at their new path are skipped, so an
# interrupted run simply continues. An
# object whose file is missing is reported and skipped — it was already a
# broken image before the move.
# ---------------------------------------------------------------------------
migrate_files() {
  [ -n "${FILES_DIR:-}" ] || return 0
  if [ "$(id -u)" != "0" ]; then
    [ -d "$FILES_DIR" ] || echo "[entrypoint] FILES_DIR $FILES_DIR does not exist and this container is not root; uploads will fail" >&2
    return 0
  fi
  # The folder and everything under it belongs to the server's user, who may
  # have put a symlink anywhere in it: root follows none. A symlinked folder is
  # left alone, chown -h changes links themselves, and a file is placed only
  # where no part of its path is a link.
  if [ -L "$FILES_DIR" ]; then
    echo "[entrypoint] FILES_DIR $FILES_DIR is a symlink; not touched (uploads may fail)" >&2
    return 0
  fi
  mkdir -p "$FILES_DIR"
  # Owned by whoever the server runs as. When that changed (PUID/PGID set,
  # changed or removed, or a restore copied the directory in as root), the
  # whole tree is handed over once; on every later start the owner matches
  # and nothing is touched.
  if [ "$(stat -c %u:%g "$FILES_DIR")" != "$RUN_IDS" ]; then
    chown -R -h "$RUN_AS" "$FILES_DIR"
    echo "[entrypoint] uploaded files now belong to $RUN_AS ($RUN_IDS)"
  fi

  marker="$FILES_DIR/.moved-from-storage-api"
  [ -f "$marker" ] && return 0

  legacy="$(dirname "$FILES_DIR")"
  has_objects="$(psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq \
                 -c "SELECT to_regclass('storage.objects') IS NOT NULL" 2>/dev/null || true)"
  if [ "$has_objects" = "f" ]; then
    # No storage schema: nothing to move. No marker either, so a pre-1.15
    # backup restored into this install later is still moved on its next start.
    return 0
  fi
  list="$(mktemp)"
  if [ "$has_objects" != "t" ] || ! psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
       -tAq -F "$(printf '\t')" -v ON_ERROR_STOP=1 >"$list" <<'SQL'
SELECT bucket_id, name, coalesce(version, '')
  FROM storage.objects
 WHERE name NOT LIKE '%/.emptyFolderPlaceholder' AND name <> '.emptyFolderPlaceholder';
SQL
  then
    # No marker: the next start tries again.
    echo "[entrypoint] could not list storage-api's objects; uploaded files not moved yet (retried on the next start)" >&2
    rm -f "$list"
    return 0
  fi

  # The move itself runs as the server's user (storage-api-move.sh): root
  # would follow a link anywhere in either tree. Root's part is only to hand
  # the old tree to that user first, without following links (-h; -R never
  # descends into a linked folder).
  if [ -d "$legacy/stub" ] && [ ! -L "$legacy/stub" ]; then
    chown -R -h "$RUN_AS" "$legacy/stub"
  fi
  counts="$(su-exec "$RUN_AS" sh /app/storage-api-move.sh "$FILES_DIR" "$legacy" <"$list" | tail -n 1)"
  rm -f "$list"
  moved="$(echo "$counts" | cut -d' ' -f1)"; present="$(echo "$counts" | cut -d' ' -f2)"; missing="$(echo "$counts" | cut -d' ' -f3)"
  case "$moved$present$missing" in "" | *[!0-9]*) moved=0; present=0; missing=0 ;; esac

  chown -R -h "$RUN_AS" "$FILES_DIR"
  # The marker only once there was something to move. An install without
  # uploads keeps checking an empty table (one query per start), so a pre-1.15
  # backup restored into it later is still moved. Once written, objects
  # deleted after the move are never brought back from the old tree.
  if [ $((moved + present + missing)) -gt 0 ]; then
    printf '%s moved=%s present=%s missing=%s\n' "$(date -u +%FT%TZ)" "$moved" "$present" "$missing" \
      | su-exec "$RUN_AS" sh -c 'cat >"$1"' sh "$marker"
  fi
  echo "[entrypoint] uploaded files moved out of storage-api: $moved moved, $present already there, $missing missing"
}
migrate_files

unset PGPASSWORD

echo "[entrypoint] starting Next.js server"
start_server
