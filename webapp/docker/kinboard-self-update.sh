#!/bin/sh
# kinboard-self-update.sh
#
# Runs the FULL Kinboard upgrade path. Triggered by the webhook
# container when Diun detects a new ghcr.io/svenger87/kinboard:* image,
# or run by hand from the host for one-off updates.
#
# Steps (in order, halting on first error):
#   1. git fetch + git pull origin main  — pulls new compose files,
#      kong.yml, migrations, init.sql, seed-demo.sql.
#   2. ./setup.sh --non-interactive       — re-substitutes kong.yml
#      placeholders if a new release shipped new keys/routes. No-ops
#      when nothing's stale.
#   3. docker compose pull                — pulls new GHCR images.
#   3b. BACKUP                             — a verified database dump and
#      the storage directory, taken only when the pull actually brought a
#      new image, and before anything is recreated. See below.
#   4. docker compose up -d                — recreates only services
#      whose image changed. The webapp's entrypoint re-applies all
#      migration_*.sql on boot (idempotent).
#   5. docker restart kinboard-kong        — Kong's DB-less mode doesn't
#      fully reload from `kong reload`. Only kicked if kong.yml's mtime
#      is newer than kong's container start time.
#
# Logs to /var/log/kinboard-update.log inside the webhook container —
# bind-mount that path on the host if you want persistent logs.
#
# WHY THIS TAKES A BACKUP
#
# Every release note says "take a backup before upgrading". On an install
# running this overlay that is advice nobody can act on: Diun polls every 30
# minutes and fires this script, so the upgrade has already happened by the
# time anyone reads the release. 1.10.0 added a table and a storage bucket to
# households that were asleep at the time.
#
# So the upgrade takes its own backup, immediately before it recreates
# anything, and refuses to proceed if that backup cannot be verified. A daily
# job — if there is one at all — leaves up to 24 hours of exposure; this
# leaves none.
#
# Idempotent: re-running when nothing changed is a fast no-op, backup
# included — nothing is dumped unless the pull actually changed an image.
#
# Required env / mounts (configured by docker-compose.diun.yml.example):
#   PROJECT_DIR    project root (bind-mounted from host)
#   COMPOSE_FILES  space-separated -f flags for the host's stack overlay
#                  set, e.g. "-f docker-compose.yml -f docker-compose.image.yml -f ..."
#   /var/run/docker.sock  bind-mounted so we can talk to the host docker

set -eu

LOG_FILE="${LOG_FILE:-/var/log/kinboard-update.log}"
PROJECT_DIR="${PROJECT_DIR:-/project}"
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml}"

# Ensure the log file is writable. If the host-side bind-mount target
# wasn't pre-created (typical), Docker auto-creates it as root:755 —
# which may or may not be writable by the webhook container's user.
# Probe and fall back to stderr-only logging on permission failure so
# `set -e` doesn't abort the script on its first log line.
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
if ! touch "$LOG_FILE" 2>/dev/null; then
  LOG_FILE=/dev/null
fi

log() {
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  msg="[$ts] $*"
  echo "$msg"
  printf '%s\n' "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Pre-upgrade backup.
#
# This script runs INSIDE the webhook container, which mounts the project and
# the docker socket and nothing else — it cannot see DATA_DIR, where both the
# database files and the uploaded photos live. It can, however, ask the host
# daemon to run a container with those paths mounted, and host paths resolve
# on the host. Everything below goes through that.
#
# Two helper images are needed, and they are not the same one.
#
# Anything with a shell will do for streaming a file out or pruning old ones,
# so the database's image serves. The archive is fussier: it needs GNU tar for
# --xattrs, because storage keeps each object's content type in an extended
# attribute and busybox tar drops them silently — the photos then restore
# looking perfect, right sizes and paths, and every one fails to load with
# ENODATA. See docs/wiki/Self-hosting.md.
#
# supabase/postgres carries busybox tar, which is what makes this worth
# probing rather than assuming: of the images a Kinboard stack already has,
# kong, imgproxy and realtime carry GNU tar and the rest do not. Probed rather
# than hardcoded so a base-image change upstream cannot quietly turn the
# archive into one that restores unusable photos.
# ---------------------------------------------------------------------------

BACKUP_KEEP="${BACKUP_KEEP:-5}"

# One dump + one archive, both verified, or a non-zero exit.
take_backup() {
  stamp="$(date -u +%Y%m%d-%H%M%S)"

  # Absolute, not relative: by the time this runs the script has already
  # cd'd into webapp/docker, so a relative path here would find nothing and
  # abort every upgrade.
  data_dir="$(grep -E '^DATA_DIR=' "$PROJECT_DIR/webapp/docker/.env" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '"')"
  if [ -z "$data_dir" ]; then
    log "ERROR: no DATA_DIR in webapp/docker/.env — cannot locate the data to back up"
    return 1
  fi
  backup_dir="${KINBOARD_BACKUP_DIR:-${data_dir}/backups}"

  db_cid="$(docker compose $COMPOSE_FILES ps -q db 2>/dev/null | head -n1)"
  if [ -z "$db_cid" ]; then
    log "ERROR: the database container is not running — refusing to upgrade without a backup"
    return 1
  fi
  helper_image="$(docker inspect -f '{{.Config.Image}}' "$db_cid" 2>/dev/null)"
  if [ -z "$helper_image" ]; then
    log "ERROR: could not determine a helper image — refusing to upgrade"
    return 1
  fi

  # An image from this stack that has GNU tar.
  tar_image=""
  for svc in kong imgproxy realtime webapp db; do
    # shellcheck disable=SC2086
    cid="$(docker compose $COMPOSE_FILES ps -q "$svc" 2>/dev/null | head -n1)"
    [ -n "$cid" ] || continue
    img="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null)"
    [ -n "$img" ] || continue
    if docker run --rm --entrypoint sh "$img" -c 'tar --version 2>/dev/null | grep -q "GNU tar"' >/dev/null 2>&1; then
      tar_image="$img"
      break
    fi
  done
  if [ -z "$tar_image" ]; then
    log "ERROR: no image in this stack has GNU tar; an archive without --xattrs"
    log "       restores photos that cannot be read. Refusing to upgrade."
    return 1
  fi
  log "backup: using $tar_image for the storage archive"

  docker run --rm -v "$backup_dir":/out "$helper_image" \
    sh -c 'mkdir -p /out' >>"$LOG_FILE" 2>&1 || {
      log "ERROR: cannot create $backup_dir"
      return 1
    }

  # --- the database ---
  # Written to a file first and its exit status checked, never piped into
  # gzip: a pipeline reports gzip's status, so a failed dump becomes a
  # plausible-looking 1.7KB archive and the upgrade sails on believing it has
  # a backup. -U supabase_admin because postgres is not a superuser in this
  # image and pg_dumpall dies on the _realtime tables it does not own.
  tmp_sql="/tmp/kinboard-pre-upgrade-$stamp.sql"
  if ! docker exec "$db_cid" pg_dumpall -U supabase_admin > "$tmp_sql" 2>>"$LOG_FILE"; then
    log "ERROR: pg_dumpall failed — refusing to upgrade"
    rm -f "$tmp_sql"
    return 1
  fi

  tables="$(grep -cE '^CREATE TABLE' "$tmp_sql" 2>/dev/null || echo 0)"
  if ! grep -qm1 'CREATE SCHEMA auth' "$tmp_sql"; then
    log "ERROR: the dump has no auth schema — it is not a backup; refusing to upgrade"
    rm -f "$tmp_sql"
    return 1
  fi
  if [ "$tables" -lt 50 ]; then
    log "ERROR: the dump has only $tables tables — refusing to upgrade"
    rm -f "$tmp_sql"
    return 1
  fi

  # Streamed into a container that has the backup directory mounted, because
  # this one does not.
  if ! gzip -c "$tmp_sql" | docker run --rm -i -v "$backup_dir":/out "$helper_image" \
       sh -c "cat > /out/pre-upgrade-$stamp.sql.gz" 2>>"$LOG_FILE"; then
    log "ERROR: could not write the dump to $backup_dir"
    rm -f "$tmp_sql"
    return 1
  fi
  rm -f "$tmp_sql"
  log "backup: pre-upgrade-$stamp.sql.gz ($tables tables)"

  # --- the uploaded files ---
  # Not in the dump, and the half nobody can recreate: family photos, recipe
  # pictures, vehicle images. --xattrs on create is load-bearing; storage
  # keeps each object's content type in an extended attribute on the file.
  # --user 0:0 because the image that has GNU tar is not necessarily one that
  # runs as root — kong does not — and both the source directory and the
  # backup directory belong to root on the host.
  if ! docker run --rm --user 0:0 -v "$data_dir":/data:ro -v "$backup_dir":/out "$tar_image" \
       tar --xattrs --xattrs-include='*' -czf "/out/pre-upgrade-$stamp-storage.tar.gz" \
       -C /data storage >>"$LOG_FILE" 2>&1; then
    log "ERROR: could not archive the storage directory — refusing to upgrade"
    return 1
  fi

  # `--entrypoint sh` already makes sh the command, so the argument list starts
  # at -c; a second `sh` here would be read as a script filename and the count
  # would come back empty. And `grep -c` exits non-zero when it counts zero, so
  # the `|| true` keeps that from looking like a failed command.
  files="$(docker run --rm --user 0:0 --entrypoint sh -v "$backup_dir":/out:ro "$tar_image" \
    -c "tar -tzf /out/pre-upgrade-$stamp-storage.tar.gz | grep -vc '/\$' || true" 2>/dev/null)"
  [ -n "$files" ] || files=0
  log "backup: pre-upgrade-$stamp-storage.tar.gz ($files file(s))"

  # An archive that holds no files while the storage directory does is the
  # failure this is here to catch — it is invisible in a size check.
  on_disk="$(docker run --rm --user 0:0 --entrypoint sh -v "$data_dir":/data:ro "$tar_image" \
    -c 'find /data/storage -type f 2>/dev/null | wc -l' 2>/dev/null)"
  [ -n "$on_disk" ] || on_disk=0
  if [ "$files" -lt "$on_disk" ]; then
    log "ERROR: the storage archive holds $files file(s), the directory has $on_disk — refusing to upgrade"
    return 1
  fi

  # Keep the last few, and never prune to empty.
  docker run --rm -v "$backup_dir":/out "$helper_image" sh -c "
    cd /out 2>/dev/null || exit 0
    ls -1t pre-upgrade-*.sql.gz 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | while read -r f; do
      rm -f \"\$f\" \"\${f%.sql.gz}-storage.tar.gz\"
    done
  " >>"$LOG_FILE" 2>&1 || true

  return 0
}

cd "$PROJECT_DIR"

log "=== self-update fired ==="
log "PROJECT_DIR=$PROJECT_DIR"
log "COMPOSE_FILES=$COMPOSE_FILES"

# 1. git fetch + pull
log "git fetch origin main"
git fetch origin main >>"$LOG_FILE" 2>&1
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/main)"
KONG_BEFORE="$(stat -c %Y webapp/docker/kong.yml 2>/dev/null || echo 0)"
DIUN_BEFORE="$(stat -c %Y webapp/docker/diun/diun.yml 2>/dev/null || echo 0)"

if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  log "pulling $LOCAL_SHA → $REMOTE_SHA"
  # The git pull brings new compose/kong files. The IMAGE pull below (steps 3-4)
  # is what carries the actual release, and it must not be held hostage to the
  # working tree being clean — so a git failure here logs loudly and continues,
  # rather than aborting under `set -e` and leaving the container on the old,
  # possibly-vulnerable image. This is exactly how the demo silently stalled on
  # an old build while `latest` moved three releases ahead.
  if ! git pull --ff-only origin main >>"$LOG_FILE" 2>&1; then
    log "WARN: git pull failed — attempting to clear collisions and retry"
    # The common cause: files that used to be created locally (compose
    # overlays, the diun runtime db) are now tracked upstream, so an untracked
    # local copy blocks the merge. Remove ONLY untracked paths that origin/main
    # actually tracks — git is about to replace each with its own version, so
    # nothing local-only is lost. Everything else is left untouched.
    git ls-files --others --exclude-standard 2>/dev/null | while IFS= read -r f; do
      if git cat-file -e "origin/main:$f" 2>/dev/null; then
        log "  removing stale untracked (now tracked upstream): $f"
        rm -f "$f"
      fi
    done
    if git pull --ff-only origin main >>"$LOG_FILE" 2>&1; then
      log "pulled $REMOTE_SHA after clearing collisions"
    else
      # Still stuck (local commits, real conflicts). Do not abort — the image
      # pull is the point, and new migrations ride in the image regardless.
      log "WARN: git still behind at $LOCAL_SHA; continuing to image pull anyway"
    fi
  else
    log "pulled $REMOTE_SHA"
  fi
else
  log "git up-to-date at $LOCAL_SHA"
fi

# 2. setup.sh — idempotent. Re-substitutes kong.yml placeholders if new
#    ones landed; does nothing if everything is already substituted.
if [ -x ./setup.sh ]; then
  log "running setup.sh --non-interactive"
  ./setup.sh --non-interactive >>"$LOG_FILE" 2>&1 || {
    log "ERROR: setup.sh failed; aborting before touching containers"
    exit 1
  }
fi

# 3. + 4. compose pull + up -d
cd webapp/docker
log "docker compose $COMPOSE_FILES pull --ignore-buildable"
# `--ignore-buildable` skips services that have a `build:` directive
# (the webhook service is locally-built from Dockerfile.webhook, has no
# pullable registry counterpart).
# The image ids before the pull, so the backup below can tell a real upgrade
# from a no-op run. `config --images` lists what the stack resolves to;
# inspecting each gives the id actually on disk now.
images_now() {
  # Sorted, because `config --images` returns the images in a different order
  # on every call: three consecutive calls on a production host gave three
  # different checksums with every image id unchanged. Unsorted, this compared
  # two shuffles of the same list and nearly always reported a change, so the
  # backup ran on runs that had nothing to upgrade.
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES config --images 2>/dev/null | sort -u | while read -r ref; do
    docker image inspect -f '{{.Id}}' "$ref" 2>/dev/null || echo "absent:$ref"
  done
}
IMAGES_BEFORE="$(images_now)"

# shellcheck disable=SC2086
docker compose $COMPOSE_FILES pull --ignore-buildable >>"$LOG_FILE" 2>&1

IMAGES_AFTER="$(images_now)"

# 3b. Back up, but only when something is actually about to change, and
# before `up -d` recreates anything or the webapp's entrypoint runs a
# migration over the data.
#
# A failure here aborts the upgrade. That is the whole point: staying on the
# current image is recoverable, and discovering after the fact that a
# migration ran with no backup is not. The pulled image stays on disk, so the
# next run picks up where this one stopped.
if [ "$IMAGES_BEFORE" != "$IMAGES_AFTER" ]; then
  log "new image(s) pulled — taking a backup before recreating anything"
  if ! take_backup; then
    log "=== self-update ABORTED: no verified backup, nothing was recreated ==="
    exit 1
  fi
else
  log "no image changed; skipping the pre-upgrade backup"
fi

# Changes to THIS script do not need that out-of-band step any more: the hook
# runs it through the project directory mount (diun/hooks.yaml), so the next
# run after a `git pull` executes the new version. It used to run a copy
# mounted as a single file, which stayed at the version on disk when the
# webhook started — and since the webhook is excluded below, that was forever.
#
# Exclude webhook + diun from the recreate. The script is currently
# executing INSIDE the webhook container — if compose recreates it, the
# script gets SIGKILL'd mid-flight and can't finish (half-done state,
# kong restart skipped, etc.). Self-updating those two services is
# done out-of-band via `docker compose build webhook && docker compose
# up -d webhook diun` from the host when their definitions change.
# shellcheck disable=SC2086
SERVICES=$(docker compose $COMPOSE_FILES config --services 2>/dev/null \
            | grep -vE '^(webhook|diun)$' \
            | tr '\n' ' ')
log "docker compose $COMPOSE_FILES up -d --no-build $SERVICES"
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES up -d --no-build $SERVICES >>"$LOG_FILE" 2>&1

# 5. Kong restart — only if kong.yml changed during this run.
KONG_AFTER="$(stat -c %Y kong.yml 2>/dev/null || echo 0)"
if [ "$KONG_AFTER" != "$KONG_BEFORE" ]; then
  log "kong.yml changed (mtime $KONG_BEFORE → $KONG_AFTER); restarting kinboard-kong"
  docker restart kinboard-kong >>"$LOG_FILE" 2>&1 || log "WARN: kong restart failed (kong may not be running)"
else
  log "kong.yml unchanged; skipping kong restart"
fi

# 6. Diun restart — only if diun/diun.yml changed during this run.
# Diun reads its config once at startup; a substituted secret or any
# other live edit won't take effect until the container restarts. We
# skip Diun in the compose-up above (self-kill protection — Diun is
# the one that fired this whole update), so the restart has to be a
# separate explicit step here.
DIUN_AFTER="$(stat -c %Y diun/diun.yml 2>/dev/null || echo 0)"
if [ "$DIUN_AFTER" != "$DIUN_BEFORE" ]; then
  log "diun.yml changed (mtime $DIUN_BEFORE → $DIUN_AFTER); restarting kinboard-diun"
  docker restart kinboard-diun >>"$LOG_FILE" 2>&1 || log "WARN: diun restart failed (diun may not be running)"
else
  log "diun.yml unchanged; skipping diun restart"
fi

log "=== self-update done ==="
