#!/bin/sh
# kinboard-self-update.sh
#
# Runs the FULL Kinboard upgrade path. Triggered by the webhook
# container when Diun detects a new ghcr.io/svenger87/kinboard:* image,
# or run by hand from the host for one-off updates.
#
# Steps (in order, halting on first error):
#   1. git fetch + git pull origin main  — pulls new compose files,
#      migrations, init.sql, seed-demo.sql.
#   2. ./setup.sh --non-interactive       — adds any .env key a new release
#      needs. No-ops when nothing's missing. Not for a stack on the root
#      compose.yml, whose secrets kinboard-init keeps.
#   3. docker compose pull                — pulls new GHCR images.
#   3b. BACKUP                             — a verified database dump and
#      the storage directory (and the config folder, where the install has
#      one), taken only when the pull brought a new image or a service is
#      about to be recreated, and before anything is. See below.
#   4. docker compose up -d --no-recreate --remove-orphans, then
#      up -d --no-deps --force-recreate <changed> — recreates only services
#      whose image or definition changed in this run (decided here, not by
#      Compose: see "What to recreate" below), and removes containers of
#      services a release retired (1.15: kong, auth, realtime, storage,
#      imgproxy). The webapp's entrypoint applies new migrations on boot
#      (migrate.sh).
#   4b. docker compose up -d --force-recreate cron — only when step 4
#      recreated the webapp: ofelia reads job labels only at start.
#   4c. HEALTH WAIT                        — every recreated service must come
#      up healthy (or running, without a health check) within 10 minutes. If
#      one does not, the recreated services go back to the image ids they ran
#      before this run, that version is held back until a newer one appears,
#      and Settings says so. See "Health and rollback" below.
#   5. docker restart kinboard-diun        — only if diun.yml changed.
#
# `--tick` (RFC-023 §4.11.5) is the reconciliation run the webhook container
# starts every 30 minutes on its own: no git, no setup.sh, only "does what
# runs match what .env names, and what the registry has under it". It catches
# a KINBOARD_TAG changed in .env, which Diun cannot see. `--tick-loop` is the
# loop that runs it. See "The reconciliation tick" below.
#
# A git install that moved to the root compose.yml (RFC-023 §5.2) runs the
# same steps against that file and its overlays, found from the running
# stack's own Compose labels: see "Which files the stack runs". A folder with
# no git checkout is left alone: see "No git checkout".
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
# Required env / mounts (configured by docker-compose.diun.yml):
#   PROJECT_DIR    project root (bind-mounted from host), a git checkout
#   COMPOSE_FILES  space-separated -f flags for the host's stack overlay
#                  set, e.g. "-f docker-compose.yml -f docker-compose.traefik.yml -f ..."
#                  (relative to webapp/docker). A stack started from the root
#                  compose.yml needs none: see "Which files the stack runs".
#   /var/run/docker.sock  bind-mounted so we can talk to the host docker
#
# A PROJECT_DIR without .git (a compose.yml pasted into a folder) is never
# updated from here: see "No git checkout" below.

set -eu

# KINBOARD_UPDATER=1: this is the published kinboard-updater (RFC-023
# §4.11.3), the `updater` service of compose.yml's `autoupdate` profile, on an
# install with no git checkout: image-only updates. See "The updater" below.
UPDATER="${KINBOARD_UPDATER:-}"
# The two values the Diun overlay interpolates into the webhook's own
# environment, as this container got them: a webhook recreated after the run
# (see "The webhook's own image") gets them back unchanged, whatever the shell
# that ran `up` had exported. Read before anything below changes them.
WEBHOOK_ENV_COMPOSE_FILES="${COMPOSE_FILES-}"
WEBHOOK_ENV_SECRET="${DIUN_WEBHOOK_SECRET-}"
if [ -n "$UPDATER" ]; then
  # Its state, lock and log live in the config volume, which exists without
  # git and survives a recreated updater.
  UPDATER_DIR="${KINBOARD_UPDATER_DIR:-/kinboard/updater}"
  LOG_FILE="${LOG_FILE:-$UPDATER_DIR/update.log}"
  PROJECT_DIR="$UPDATER_DIR"
  COMPOSE_FILES="${COMPOSE_FILES:-}"
else
  LOG_FILE="${LOG_FILE:-/var/log/kinboard-update.log}"
  PROJECT_DIR="${PROJECT_DIR:-/project}"
  COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml}"
fi

MODE=update
case "${1:-}" in
  "") ;;
  --tick) MODE=tick ;;
  --tick-loop) MODE=loop ;;
  *) echo "usage: $0 [--tick | --tick-loop]" >&2; exit 2 ;;
esac
# The updater has no git and no setup.sh to run: every run of it is a tick
# (`docker exec kinboard-updater kinboard-self-update.sh` runs one now).
if [ -n "$UPDATER" ] && [ "$MODE" = update ]; then MODE=tick; fi
if [ -n "$UPDATER" ]; then
  ( umask 077; mkdir -p "$UPDATER_DIR" ) 2>/dev/null || true
  # One log per install, kept from growing without end: the previous one is
  # kept beside it.
  if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt "${KINBOARD_LOG_MAX:-2000000}" ]; then
    mv -f "$LOG_FILE" "$LOG_FILE.1" 2>/dev/null || true
  fi
fi

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
# Anything with a shell, tar and gzip will do, so the database's own image
# serves for all of it.
#
# Until 1.15 the archive needed GNU tar for --xattrs, because storage-api kept
# each object's content type in an extended attribute, and only Kong, imgproxy
# and realtime carried GNU tar. Those containers are gone, and so is the
# reason: uploaded files now live as plain files (FILES_DIR) whose type comes
# from their name. The busybox tar every remaining image has is enough.
# ---------------------------------------------------------------------------

BACKUP_KEEP="${BACKUP_KEEP:-5}"

# Which compose file the stack runs: "legacy" (webapp/docker/docker-compose.yml
# and COMPOSE_FILES, as every git install before RFC-023) or "compose" (the
# root compose.yml). Decided by resolve_stack below; until then, legacy.
# "container": kinboard-updater on a stack whose compose file it cannot read
# (Portainer's web editor), which it updates from the containers themselves
# (see "Container mode").
STACK_MODE=legacy
# The .env the stack's compose files are interpolated from.
STACK_ENV_FILE="$PROJECT_DIR/webapp/docker/.env"
# Container mode only: the Compose project the containers carry in their labels.
STACK_PROJECT=""
# The all-in-one image (see "The all-in-one image"): AIO=1, its container's
# name, and the one service it stands for. KB_SVC is the service that runs the
# webapp: `webapp` in every stack, `aio` for the all-in-one container.
AIO=""
AIO_NAME=""
AIO_SVC=aio
KB_SVC=webapp

# The value of $1 in the stack's .env, as written there (quotes removed), or
# nothing.
env_value() {
  grep -E "^$1=" "$STACK_ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"' || true
}

# The container of service $1, in any state; with $2 = running, only a running
# one. Nothing when there is none. Through `docker compose ps` (the files), or
# in container mode from the containers' Compose labels.
svc_container() {
  if [ "$STACK_MODE" = container ]; then
    cm_containers "$1" "${2:-}" | head -n1
    return 0
  fi
  if [ -n "${2:-}" ]; then
    # shellcheck disable=SC2086
    docker compose $COMPOSE_FILES ps -q "$1" 2>/dev/null | head -n1 || true
  else
    # shellcheck disable=SC2086
    docker compose $COMPOSE_FILES ps -aq "$1" 2>/dev/null | head -n1 || true
  fi
}

# The stack's services, one per line.
stack_services() {
  if [ "$STACK_MODE" = container ]; then
    cm_list | awk '{ print $2 }' | awk '!seen[$0]++'
    return 0
  fi
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES config --services 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# The config folder (RFC-023 §4.1, §6.5).
#
# An install on the one-file layout keeps its secrets in files under
# config/secrets/: the database password, the JWT secret, the VAPID pair. A
# restored database directory cannot start without them (kinboard-init refuses,
# because the cluster exists and its password file doesn't), and a restored
# dump with new VAPID keys silently ends every device's push subscription. So
# where that folder exists, the backup has a third archive.
#
# Git installs on the legacy compose file have no config folder: nothing mounts
# /kinboard and $DATA_DIR/config does not exist, and for them the backup is
# exactly what it was. The .env stays out of the backup (RFC-023 §11.7).
#
# Both scripts below run inside the helper container (the database image), as
# root, through `sh -c`. They are variables rather than inline strings so that
# e2e/self-update-config-backup.spec.ts runs the same text against real files.
# Paths come from KB_SRC / KB_OUT so the spec can point them at a temporary
# folder; in the container they default to the mount points.
# ---------------------------------------------------------------------------

# $1: the archive's file name. Prints "files=<n>". Exits non-zero, with the
# archive removed, unless every file came back identical and the archive is
# readable by its owner only.
#
# - umask 077 from the first byte: the archive is never readable by anyone but
#   root, not even while it is being written, and it holds the database
#   password. It is written under a dot-name and renamed only once verified,
#   so a cut-short run never leaves something that looks like a backup.
# - The archive keeps each entry's mode and owner (tar does; root extracts
#   them as stored), so a restore puts back 0750/0640 root:0 and never wider.
# - Verified by extracting it into a private folder (in memory: the caller
#   mounts a tmpfs at /tmp) and comparing every entry
#   with the source: type, mode, owner, group and, for files, the bytes. A
#   count alone would pass an archive of empty files.
# - Only folders and plain files. kinboard-init writes nothing else; a symlink
#   would be archived as a link, and the backup would hold no secret at all.
# - A backup folder that does not keep mode 0600 (a share that ignores chmod)
#   is a refusal: the archive holds every secret of the install, and leaving
#   it readable to others is worse than updating later. KINBOARD_BACKUP_DIR
#   points the backup at a folder that keeps modes.
CONFIG_ARCHIVE_SH='
set -u
src="${KB_SRC:-/config}"
out="${KB_OUT:-/out}"
name="$1"
part="$out/.$name.partial"
chk=""
umask 077
fail() {
  echo "config backup: $*" >&2
  rm -f "$part"
  [ -z "$chk" ] || rm -rf "$chk"
  exit 1
}
[ -d "$src" ] || fail "no folder at $src"
rm -f "$part"
# updater/ holds the state, lock and log of kinboard-updater (RFC-023
# §4.11.3), written while this runs; not a secret, and not something to
# restore.
tar --numeric-owner --exclude=./updater -czf "$part" -C "$src" . || fail "tar could not write the archive"
chmod 0600 "$part" 2>/dev/null || true
chk="$(mktemp -d)" || fail "no temporary folder to verify in"
tar --numeric-owner -xzpf "$part" -C "$chk" || fail "the archive does not extract"
n=0
list="$(cd "$src" && find . -path ./updater -prune -o -print)" || fail "cannot list $src"
while IFS= read -r e; do
  case "$e" in "" | .) continue ;; esac
  if [ -L "$src/$e" ] || { [ ! -f "$src/$e" ] && [ ! -d "$src/$e" ]; }; then
    fail "$e is not a plain file or folder; only those are backed up"
  fi
  a="$(stat -c "%F %a %u %g" "$src/$e" 2>/dev/null)" || fail "cannot read $e"
  b="$(stat -c "%F %a %u %g" "$chk/$e" 2>/dev/null)" || fail "$e is missing from the archive"
  [ "$a" = "$b" ] || fail "$e differs in the archive ($a on disk, $b restored)"
  if [ -f "$src/$e" ]; then
    cmp -s "$src/$e" "$chk/$e" || fail "$e differs in the archive (its contents)"
    n=$((n + 1))
  fi
done <<EOF
$list
EOF
rm -rf "$chk"
chk=""
mode="$(stat -c %a "$part" 2>/dev/null || echo unknown)"
[ "$mode" = 600 ] || fail "the archive is mode $mode, not 600: $out does not keep file modes (a share?), and the archive would be readable by others"
mv "$part" "$out/$name" || fail "could not rename the archive into place"
echo "files=$n"
'

# $1: how many backups to keep. Keeps the newest $1 dumps and, with each one it
# removes, that run's storage and config archives. A half-written config
# archive left by a run that was killed is removed too.
PRUNE_SH='
cd "${KB_OUT:-/out}" 2>/dev/null || exit 0
ls -1t pre-upgrade-*.sql.gz 2>/dev/null | tail -n +$(($1 + 1)) | while read -r f; do
  rm -f "$f" "${f%.sql.gz}-storage.tar.gz" "${f%.sql.gz}-config.tar.gz"
done
rm -f .pre-upgrade-*.partial
'

# What service $1's container mounts at $2, as something `docker run -v` can
# mount: a named volume's name or a host path. Nothing when the service has no
# container or no such mount.
mount_source() {
  cid="$(svc_container "$1")"
  [ -n "$cid" ] || return 0
  container_mount "$cid" "$2"
}

# The same for container $1.
container_mount() {
  [ -n "$1" ] || return 0
  docker inspect -f '{{range .Mounts}}{{if eq .Destination "'"$2"'"}}{{if eq .Type "volume"}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}' "$1" 2>/dev/null || true
}

# Where the install keeps its config folder, as something `docker run -v` can
# mount (a host folder or a named volume), or nothing. In order: what the
# running stack mounts at /kinboard (any compose file that has a config
# volume), then $DATA_DIR/config (RFC-023 §5.2's layout for an install that
# moved its secrets into files). $1: DATA_DIR, $2: the helper image.
config_source() {
  for svc in webapp db; do
    src="$(mount_source "$svc" /kinboard)"
    if [ -n "$src" ]; then
      printf '%s\n' "$src"
      return 0
    fi
  done
  # A stack on compose.yml has no DATA_DIR: what its containers mount is all
  # there is.
  [ -n "$1" ] || return 0
  # Printed, not an exit status: a container that fails to start must not read
  # as "the folder exists".
  found="$(docker run --rm --user 0:0 --entrypoint sh -v "$1":/data:ro "$2" \
    -c 'if [ -d /data/config ]; then echo present; fi' 2>/dev/null || true)"
  if [ "$found" = present ]; then
    printf '%s\n' "$1/config"
  fi
  return 0
}

# One dump + one archive (+ the config archive where there is a config
# folder), all verified, or a non-zero exit.
take_backup() {
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  # The all-in-one image takes its own dump (see aio_backup).
  if [ -n "$AIO" ]; then
    aio_backup
    return $?
  fi

  if [ "$STACK_MODE" = compose ] || [ "$STACK_MODE" = container ]; then
    # compose.yml has no DATA_DIR. The uploaded files are wherever the webapp
    # mounts /var/lib/storage (KINBOARD_STORAGE_DIR, or the kinboard-storage
    # volume), read from the container, not from a file (RFC-023 §4.11.3
    # step 6). The backups go next to that folder: beside a folder called
    # storage, into backups (as $DATA_DIR/backups is beside $DATA_DIR/storage,
    # which is also where they land for a git install that moved to
    # compose.yml with RFC-023 §5.2's layout, and for install.sh's
    # ./data/storage); beside any other folder, into <that folder>-backups,
    # never a parent's generic backups/ shared with other apps; for a named
    # volume, into the volume kinboard-backups.
    data_dir=""
    storage_src="$(mount_source webapp /var/lib/storage)"
    if [ -z "$storage_src" ]; then
      log "ERROR: the webapp container mounts nothing at /var/lib/storage — cannot locate the uploaded files to back up"
      return 1
    fi
    backup_dir="${KINBOARD_BACKUP_DIR:-$(env_value KINBOARD_BACKUP_DIR)}"
    if [ -z "$backup_dir" ]; then
      storage_src="${storage_src%/}"
      case "$storage_src" in
        /*/storage) backup_dir="${storage_src%/storage}/backups" ;;
        /*) backup_dir="$storage_src-backups" ;;
        *) backup_dir=kinboard-backups ;;
      esac
    fi
    storage_mount="$storage_src:/data/storage:ro"
  else
    # Absolute, not relative: by the time this runs the script has already
    # cd'd into webapp/docker, so a relative path here would find nothing and
    # abort every upgrade.
    data_dir="$(grep -E '^DATA_DIR=' "$PROJECT_DIR/webapp/docker/.env" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '"')"
    if [ -z "$data_dir" ]; then
      log "ERROR: no DATA_DIR in webapp/docker/.env — cannot locate the data to back up"
      return 1
    fi
    backup_dir="${KINBOARD_BACKUP_DIR:-${data_dir}/backups}"
    storage_mount="$data_dir:/data:ro"
  fi

  db_cid="$(svc_container db running)"
  if [ -z "$db_cid" ]; then
    log "ERROR: the database container is not running — refusing to upgrade without a backup"
    return 1
  fi
  helper_image="$(docker inspect -f '{{.Config.Image}}' "$db_cid" 2>/dev/null)"
  if [ -z "$helper_image" ]; then
    log "ERROR: could not determine a helper image — refusing to upgrade"
    return 1
  fi

  tar_image="$helper_image"

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
  tmp_sql="${TMPDIR:-/tmp}/kinboard-pre-upgrade-$stamp-$$.sql"
  if ! docker exec "$db_cid" pg_dumpall -U supabase_admin > "$tmp_sql" 2>>"$LOG_FILE"; then
    log "ERROR: pg_dumpall failed — refusing to upgrade"
    rm -f "$tmp_sql"
    return 1
  fi

  # Kinboard's own core table, not supabase/postgres's auth schema: the
  # app-store listings run stock PostgreSQL (kinboard-postgres), which has
  # no auth schema, and every good dump of such an install would be refused.
  tables="$(grep -cE '^CREATE TABLE' "$tmp_sql" 2>/dev/null || echo 0)"
  if ! grep -qm1 '^CREATE TABLE public\.families (' "$tmp_sql"; then
    log "ERROR: the dump has no families table — it is not a backup of Kinboard; refusing to upgrade"
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
  # pictures, vehicle images. --user 0:0 because both the source directory and
  # the backup directory belong to root on the host. --entrypoint: the
  # database image's own would start Postgres.
  if ! docker run --rm --user 0:0 --entrypoint tar -v "$storage_mount" -v "$backup_dir":/out "$tar_image" \
       -czf "/out/pre-upgrade-$stamp-storage.tar.gz" \
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
  on_disk="$(docker run --rm --user 0:0 --entrypoint sh -v "$storage_mount" "$tar_image" \
    -c 'find /data/storage -type f 2>/dev/null | wc -l' 2>/dev/null)"
  [ -n "$on_disk" ] || on_disk=0
  if [ "$files" -lt "$on_disk" ]; then
    log "ERROR: the storage archive holds $files file(s), the directory has $on_disk — refusing to upgrade"
    return 1
  fi

  # --- the config folder, where there is one (see CONFIG_ARCHIVE_SH) ---
  config_src="$(config_source "$data_dir" "$tar_image")"
  if [ -n "$config_src" ]; then
    # --tmpfs: the verification extracts the secrets once more; into memory,
    # not into a container layer on disk.
    if ! config_out="$(docker run --rm --user 0:0 --entrypoint sh --tmpfs /tmp:rw,mode=0700 -v "$config_src":/config:ro -v "$backup_dir":/out "$tar_image" \
         -c "$CONFIG_ARCHIVE_SH" sh "pre-upgrade-$stamp-config.tar.gz" 2>>"$LOG_FILE")"; then
      log "ERROR: could not archive and verify the config folder ($config_src) — refusing to upgrade. The reason is in $LOG_FILE; if the backup folder does not keep file modes, set KINBOARD_BACKUP_DIR to one that does"
      return 1
    fi
    config_files="$(printf '%s\n' "$config_out" | sed -n 's/^files=//p' | head -n1)"
    if [ -z "$config_files" ]; then
      log "ERROR: the config archive was not confirmed — refusing to upgrade"
      return 1
    fi
    log "backup: pre-upgrade-$stamp-config.tar.gz ($config_files file(s) from $config_src, readable by root only)"
    if [ "$config_files" = 0 ]; then
      log "WARN: the config folder $config_src holds no files; the backup has no secrets to restore"
    fi
  fi

  # Keep the last few, and never prune to empty.
  docker run --rm -v "$backup_dir":/out --entrypoint sh "$helper_image" \
    -c "$PRUNE_SH" sh "$BACKUP_KEEP" >>"$LOG_FILE" 2>&1 || true

  # For the status record Settings shows (see write_status).
  BACKUP_FILE="pre-upgrade-$stamp.sql.gz"
  BACKUP_DIR="$backup_dir"
  BACKUP_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  return 0
}
BACKUP_FILE=""
BACKUP_DIR=""
BACKUP_AT=""

# ---------------------------------------------------------------------------
# The scheduler follows a new webapp.
#
# ofelia (the `cron` service) reads its jobs from the webapp container's
# labels once, when it starts, and never looks again. `up -d` recreates the
# webapp when its image changes, but not `cron`, whose own definition did
# not -- so a job a release adds is never scheduled, and nothing says so
# (RFC-014's weekly school-holiday sync, v1.13). So whenever the webapp
# container is a new one, the scheduler is recreated after it.
#
# Idempotent: a run that left the webapp alone leaves the scheduler alone,
# and recreating it twice is the same as once. A stack without `cron` is
# skipped.
# ---------------------------------------------------------------------------

webapp_container() {
  svc_container "$KB_SVC"
}

# $1: the webapp container id from before `up -d` (empty if none ran).
recreate_scheduler_if_webapp_changed() {
  before="$1"
  after="$(webapp_container)"
  if [ -z "$after" ] || [ "$before" = "$after" ]; then
    log "webapp not recreated; scheduler left as it is"
    return 0
  fi
  # compose.yml has no cron service: its jobs run inside the webapp.
  if [ "$STACK_MODE" = container ]; then
    log "webapp recreated; the scheduler runs inside it"
    return 0
  fi
  if ! stack_services | grep -x cron >/dev/null; then
    log "webapp recreated; this stack has no cron service to refresh"
    return 0
  fi
  log "webapp recreated; recreating cron so the scheduler reads its job labels again"
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES up -d --no-deps --no-build --force-recreate cron >>"$LOG_FILE" 2>&1 \
    || log "WARN: could not recreate cron; run: docker compose \$CF up -d --force-recreate cron"
}

# ---------------------------------------------------------------------------
# What to recreate is decided here, not by `docker compose up`.
#
# Compose treats a container as out of date when the hash of its service's
# definition differs from the hash it stored on the container when it created
# it (the com.docker.compose.config-hash label). That hash depends on the
# Compose version computing it: 2.29 stopped hashing depends_on, 5.0
# serialises bind mounts differently, and 5.4 stores another image digest in
# com.docker.compose.image, which it compares too. This script runs the
# Compose installed in the webhook image (2.27, Alpine 3.20); `./start.sh up` and any
# `docker compose` typed on the host run the host's. So every switch from one
# to the other found each service with a depends_on or a bind mount "changed"
# and recreated it -- the database, PostgREST and go2rtc among them -- on runs
# where nothing had changed at all.
#
# So the stored hash is not consulted. A service is recreated when
#   - its definition changed in this run: the hash before `git pull` and
#     setup.sh differs from the hash after them, both computed by this same
#     Compose; or
#   - its container was created from another image reference than the one
#     the definition names now (a tag bumped in a checkout that was pulled,
#     or a KINBOARD_TAG edited, before this run); or
#   - its container runs another image than that reference names now, which
#     is what `docker compose pull` just fetched. (`.Image` on the container
#     and `.Id` on the image are the same kind of id on either image store:
#     the config digest on the classic one, the index digest on containerd.)
# Everything else is left running. A definition change other than the image,
# made before this run and never applied, is not picked up here; `./start.sh
# up` applies it.
#
# Anything this cannot read counts as unknown, not as changed: no hashes (an
# old Compose, a .env that does not interpolate) means no recreate for a
# changed definition, with a warning, rather than all of them.
# ---------------------------------------------------------------------------

# "service hash" lines for the stack's definition as it is on disk now, and
# nothing at all when Compose cannot produce them.
config_hashes() {
  # shellcheck disable=SC2086
  (cd "$PROJECT_DIR/webapp/docker" && docker compose $COMPOSE_FILES config --hash='*' 2>/dev/null) \
    | grep -E '^[^ ]+ [0-9a-f]{64}$' | sort || true
}

# "service image" lines: the image reference each service names now, read
# from the normalised config (services at two spaces, their keys at four).
config_images() {
  # Container mode: the reference each container was created from (RFC-023
  # §4.11.3 step 2, "the containers' configured references").
  if [ "$STACK_MODE" = container ]; then
    for svc in $(stack_services); do
      ref="$(docker inspect -f '{{.Config.Image}}' "$(svc_container "$svc")" 2>/dev/null || true)"
      [ -z "$ref" ] || printf '%s %s\n' "$svc" "$ref"
    done
    return 0
  fi
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES config 2>/dev/null | awk '
    /^services:/ { in_services = 1; next }
    /^[^ ]/ { in_services = 0 }
    in_services && /^  [^ ][^ ]*:$/ { svc = substr($0, 3, length($0) - 3) }
    in_services && /^    image: / { ref = substr($0, 12); gsub(/["'"'"']/, "", ref); print svc, ref }
  ' || true
}

# The second field of the line for service $1 in $2.
field_for() {
  printf '%s\n' "$2" | awk -v s="$1" '$1 == s { print $2; exit }'
}

# $1: the services to consider. Reads HASHES_BEFORE, HASHES_NOW,
# HASHES_SINCE and CONFIG_IMAGES. Prints "recreate <service> <why>",
# "skip <service> <why>" or "held <service> <why>" lines. A skipped service is
# one this could not judge, and keeps the hash file for the next run. A held
# one would run an image that an earlier run rolled back (see "Health and
# rollback"); it stays as it is until a newer image appears.
#
# Every lookup ends in `|| true`: under `set -e` one failed lookup (an image
# no longer on disk, a container gone in the meantime) would otherwise end
# the loop and silently drop every service after it.
services_to_recreate() {
  for svc in $1; do
    cid="$(svc_container "$svc")"
    if [ -z "$cid" ]; then
      echo "skip $svc no-container"
      continue
    fi
    ref="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
    running="$(docker inspect -f '{{.Image}}' "$cid" 2>/dev/null || true)"
    want_ref="$(field_for "$svc" "$CONFIG_IMAGES")"
    [ -n "$want_ref" ] || want_ref="$ref"
    wanted=""
    [ -z "$want_ref" ] || wanted="$(docker image inspect -f '{{.Id}}' "$want_ref" 2>/dev/null || true)"
    why=""

    # The definition, when both sides are known. A container created after
    # the hashes were taken (a `./start.sh up` since an interrupted run) was
    # created from the current definition already.
    if [ -n "$HASHES_BEFORE" ] && [ -n "$HASHES_NOW" ]; then
      before="$(field_for "$svc" "$HASHES_BEFORE")"
      now="$(field_for "$svc" "$HASHES_NOW")"
      if [ -n "$now" ] && [ "$before" != "$now" ]; then
        created="$(docker inspect -f '{{.Created}}' "$cid" 2>/dev/null || true)"
        if awk -v c="$(printf '%.19s' "$created")" -v w="$HASHES_SINCE" 'BEGIN { exit !(c > w) }'; then
          :
        else
          why=definition
        fi
      fi
    fi

    if [ -z "$why" ]; then
      if [ -z "$ref" ] || [ -z "$running" ]; then
        echo "skip $svc container-unreadable"
        continue
      fi
      if [ "$ref" != "$want_ref" ]; then
        why=image-reference
      elif [ -z "$wanted" ]; then
        echo "skip $svc image-not-on-disk"
        continue
      elif [ "$wanted" != "$running" ]; then
        why=image
      else
        continue
      fi
    fi

    if [ -n "$wanted" ] && [ "$wanted" != "$running" ] && is_held "$wanted"; then
      echo "held $svc $why"
      continue
    fi
    echo "recreate $svc $why"
  done
}

# ---------------------------------------------------------------------------
# State that outlives a run: .git/kinboard-update-state, next to the hash file
# and the lock, so a run in the webhook container and one started on the host
# share it. One "key value..." line each:
#
#   baseline <UTC>                 the first tick has run (see "The tick")
#   failures <n>                   ticks in a row that could not reach the registry
#   backoff_until <epoch seconds>  no tick before then
#   held <image id> <reference> <UTC>   rolled back once; not applied again
#   previous <service> <image id> <reference>   what ran before the last recreate
#
# RFC-023 §4.11.3 names config/updater/state.json for the published updater
# image; a git install has no config/ directory, and its other run state
# already lives in .git.
# ---------------------------------------------------------------------------

state_get() {
  awk -v k="$1" '$1 == k { print $2; exit }' "$STATE_FILE" 2>/dev/null || true
}

# $1 key, $2 value: replaces every line for the key; an empty value removes it.
state_set() {
  tmp="$STATE_FILE.tmp"
  { awk -v k="$1" '$1 != k' "$STATE_FILE" 2>/dev/null || true
    [ -z "$2" ] || echo "$1 $2"
  } > "$tmp" && mv "$tmp" "$STATE_FILE"
}

is_held() {
  awk -v id="$1" '$1 == "held" && $2 == id { found = 1 } END { exit !found }' "$STATE_FILE" 2>/dev/null
}

# $1 image id, $2 reference.
# The updater adds the registry digest the image was pulled as, so that its
# next tick need not pull it again to recognise it.
hold_back() {
  d=""
  [ -z "$UPDATER" ] || d="$(image_digest "$1" "$(ref_repo "$2")")"
  is_held "$1" || echo "held $1 $2 $(date -u +%Y-%m-%dT%H:%M:%SZ)${d:+ $d}" >> "$STATE_FILE"
}

# $1: a reference whose held versions no longer matter (a newer image under it
# came up healthy), or empty for all of them ("Try again" in Settings).
release_held() {
  tmp="$STATE_FILE.tmp"
  { awk -v r="$1" '!($1 == "held" && (r == "" || $3 == r))' "$STATE_FILE" 2>/dev/null || true; } > "$tmp" \
    && mv "$tmp" "$STATE_FILE"
}

# ---------------------------------------------------------------------------
# The database, for the status record Settings reads.
#
# instance_settings (migrations/065) holds settings of the install rather than
# of a family; the browser roles cannot read it. Through the db container, as
# the backup is, because this container has no other way in. -U supabase_admin
# for the same reason as the dump: local connections in that image trust it.
# ---------------------------------------------------------------------------

db_container() {
  # The all-in-one container is its own database: psql over its socket, where
  # supabase_admin is trusted as in the db image.
  if [ -n "$AIO" ]; then
    svc_container "$AIO_SVC" running
    return 0
  fi
  svc_container db running
}

# A JSON string, quotes included. Control characters (a log's colour codes)
# are dropped: JSON does not allow them raw.
json_str() {
  # sed, not awk, for the escaping: busybox awk's gsub turns "\\\\" into one
  # backslash, not two, which made invalid JSON of any log with a backslash.
  printf '"'
  printf '%s' "$1" | tr -d '\000-\010\013-\037' \
    | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' \
    | sed ':a;N;$!ba;s/\n/\\n/g' | tr -d '\n'
  printf '"'
}

# $1: the record, a JSON object. $2: what to say in the log. $3: the same
# record without the log excerpt, tried when the first is refused (a log line
# that is not valid UTF-8, say).
write_status() {
  db="$(db_container)"
  if [ -z "$db" ]; then
    log "WARN: the database is not running; Settings will not show: $2"
    return 0
  fi
  # A psql variable, never pasted into the SQL: the record holds a log
  # excerpt. Variables are not interpolated in -c, hence stdin.
  if printf '%s\n' "INSERT INTO public.instance_settings (key, value) VALUES (:'k', :'v')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();" \
     | docker exec -i "$db" psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 -v "k=${STATUS_KEY:-update_status}" -v "v=$1" >>"$LOG_FILE" 2>&1; then
    log "status for Settings: $2"
  elif [ -n "${3:-}" ] && [ "$3" != "$1" ] && printf '%s\n' "INSERT INTO public.instance_settings (key, value) VALUES (:'k', :'v')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();" \
     | docker exec -i "$db" psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 -v "k=${STATUS_KEY:-update_status}" -v "v=$3" >>"$LOG_FILE" 2>&1; then
    log "status for Settings, without the log excerpt: $2"
  else
    log "WARN: could not record the status for Settings: $2"
  fi
}

# "Try again now" in Settings writes update_retry; it releases every held
# version, and the run that reads it removes it.
take_retry_request() {
  db="$(db_container)"
  [ -n "$db" ] || return 0
  # Taken and removed in one statement: only a request that was really removed
  # releases anything, so a DELETE that fails cannot release the held version
  # again at every tick.
  asked="$(docker exec "$db" psql -U supabase_admin -d postgres -tAq -v ON_ERROR_STOP=1 \
    -c "DELETE FROM public.instance_settings WHERE key = 'update_retry' RETURNING value" 2>/dev/null || true)"
  [ -n "$asked" ] || return 0
  release_held ""
  log "\"Try again\" was pressed in Settings ($asked); versions held back after a rollback are tried again"
}

# $1 image id, $2 reference: a version to show a person. The release label
# docker.yml puts on the image, else the reference's tag.
image_version() {
  v="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "$1" 2>/dev/null || true)"
  case "$v" in "<no value>") v="" ;; esac
  if [ -z "$v" ]; then
    case "$2" in
      *@*) v="$(printf '%.19s' "${2##*@}")" ;;
      *:*) v="${2##*:}"; case "$v" in */*) v=latest ;; esac ;;
      *) v=latest ;;
    esac
  fi
  echo "$v"
}

# ---------------------------------------------------------------------------
# Health and rollback (RFC-023 §4.11.4).
#
# Until this, a release that did not start stayed down: the script recreated
# the webapp, logged "done" and left. Nothing waited for it, and the household
# found a dead screen in the morning.
#
# Now every recreated service is watched until Docker calls it healthy (its
# health check, which for the webapp is /api/health, database included), or,
# without a health check, until it has been running for two looks in a row.
# A container that exits, restarts more than twice, or is not there yet after
# KINBOARD_HEALTH_TIMEOUT (10 minutes: a first boot's migrations retry for 30
# seconds, the check has a 30-second start period, and a large migration on a
# Pi needs room) has failed. So has a webapp that is healthy but fails the
# smoke check (smoke_check below): the schema its code needs is not there.
#
# Then the recreated services go back to the image ids they ran before this
# run, recorded before anything was touched: each id is tagged as the
# reference again and the services are recreated with --pull never. The image
# that failed is held back (state file) so the next run and the next tick do
# not walk into it again; a newer image under the reference, or "Try again"
# in Settings, releases it.
#
# A migration the failed version ran stays. Migrations are additive
# (UPGRADING.md), so the older version runs on the newer schema; one that
# failed halfway left part of itself, and is retried with the next release.
# ---------------------------------------------------------------------------

HEALTH_TIMEOUT="${KINBOARD_HEALTH_TIMEOUT:-600}"
HEALTH_POLL="${KINBOARD_HEALTH_POLL:-5}"
UNHEALTHY=""

# $1: services. Returns 0 when all are healthy; otherwise 1, with
# UNHEALTHY set to "<service>: <why>" lines.
wait_healthy() {
  pending="$1"
  seen_running=""
  UNHEALTHY=""
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while :; do
    still=""
    for svc in $pending; do
      cid="$(svc_container "$svc")"
      st="$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.State.ExitCode}}|{{.HostConfig.RestartPolicy.Name}}' "$cid" 2>/dev/null || true)"
      IFS='|' read -r status health restarts code policy <<EOF
$st
EOF
      if [ -z "$cid" ] || [ -z "$st" ]; then
        UNHEALTHY="$UNHEALTHY$svc: its container is gone
"
      elif [ "$health" = healthy ]; then
        :
      elif [ "$status" = exited ] && [ "$policy" = no ] && [ "$code" = 0 ]; then
        : # a one-shot (db-init) that did its job
      elif [ "$status" = exited ] || [ "$status" = dead ]; then
        UNHEALTHY="$UNHEALTHY$svc: exited with code $code
"
      elif [ "${restarts:-0}" -gt 2 ]; then
        UNHEALTHY="$UNHEALTHY$svc: restarted $restarts times
"
      elif [ -z "$health" ] && [ "$status" = running ] && printf ' %s ' "$seen_running" | grep -q " $svc "; then
        :
      else
        [ -n "$health" ] || [ "$status" != running ] || seen_running="$seen_running $svc"
        still="$still $svc"
      fi
    done
    [ -z "$UNHEALTHY" ] || return 1
    [ -n "$still" ] || return 0
    if [ "$(date +%s)" -ge "$deadline" ]; then
      for svc in $still; do
        UNHEALTHY="$UNHEALTHY$svc: not healthy after ${HEALTH_TIMEOUT}s
"
      done
      return 1
    fi
    pending="$still"
    sleep "$HEALTH_POLL"
  done
}

# The smoke check, after the webapp is healthy: `/api/health?deep=1`, run
# inside the webapp container (lib/deep-health.ts). Healthy is not enough: a
# column renamed by a release (a non-additive migration) kept Docker's health
# status healthy and /api/health at 200, and only a write through /rest/v1
# failed. The deep check compares the schema PostgREST serves with the tables
# and columns this build's code declares, and makes one harmless write.
#
# Retried for KINBOARD_SMOKE_TIMEOUT (3 minutes; PostgREST reloads its schema
# cache a moment after the migrations) after the health wait. The answers:
#   - a `deep` object: 200 passes, anything else is retried, then fails;
#   - the plain health JSON (`"status"`): an image older than the deep check,
#     which ignores `deep`; it passes on its health check alone;
#   - 401: no CRON_SECRET in the webapp's environment; passes, with a warning,
#     since failing would roll back every release on such an install;
#   - nothing, a timeout, an HTML error page: retried, then fails.
SMOKE_TIMEOUT="${KINBOARD_SMOKE_TIMEOUT:-180}"

smoke_check() {
  cid="$(svc_container "$KB_SVC")"
  smoke_deadline=$(( $(date +%s) + SMOKE_TIMEOUT ))
  while :; do
    # CRON_SECRET is the webapp container's own: single quotes, expanded there.
    # On compose.yml it is not in the container's environment at all: the
    # entrypoint exports it from the secrets store to the server only, and a
    # `docker exec` shell has the container's configured environment. So the
    # store's file, where there is one (kinboard-init, RFC-023 §4.1);
    # without it every check there was a 401, and passed on health alone.
    # The all-in-one image keeps that store in /data/config/secrets and says
    # so in KINBOARD_SECRETS_DIR.
    # shellcheck disable=SC2016
    out="$(docker exec "$cid" sh -c 's="${CRON_SECRET:-$(cat "${KINBOARD_SECRETS_DIR:-/kinboard/secrets}/cron_secret" 2>/dev/null)}"; curl -s -m 30 -w "\n%{http_code}" -H "Authorization: Bearer $s" "http://localhost:3000/api/health?deep=1"' 2>/dev/null || true)"
    code="$(printf '%s\n' "$out" | tail -n1)"
    body="$(printf '%s\n' "$out" | sed '$d')"
    case "$code|$body" in
      200\|*'"deep"'*)
        log "smoke check passed: the schema the webapp needs is there, and a write went through"
        return 0 ;;
      *'"deep"'*) ;;
      401\|*)
        log "WARN: smoke check refused (HTTP 401: no CRON_SECRET in the webapp's environment?); its health check stands alone"
        return 0 ;;
      200\|*'"status"'*)
        log "smoke check: this webapp image has no deep health check; its health check stands alone"
        return 0 ;;
    esac
    if [ "$(date +%s)" -ge "$smoke_deadline" ]; then
      UNHEALTHY="${UNHEALTHY}webapp: the smoke check failed (HTTP $code): $(printf '%.400s' "$body")
"
      return 1
    fi
    sleep "$HEALTH_POLL"
  done
}

# Health, and for a recreated webapp the smoke check too.
wait_ready() {
  wait_healthy "$1" || return 1
  case " $1 " in *" $KB_SVC "*) smoke_check || return 1 ;; esac
  return 0
}

# The migration the webapp's entrypoint gave up on, from its log
# (migrate.sh: "[migrate] FAILED: <file>"), or nothing.
failed_migration() {
  cid="$(svc_container "$KB_SVC")"
  [ -n "$cid" ] || return 0
  docker logs "$cid" 2>&1 | sed -n 's/.*\[migrate\] FAILED: *\([^ ]*\).*/\1/p' | tail -n1 || true
}

# Secret-shaped text out of a log excerpt before it is stored where Settings
# shows it: every value in .env whose name says secret, password, token or
# key, as written; JWTs; credentials in a URL; Bearer tokens; name=value and
# name: value pairs for password, secret, token and API keys; and any run of
# 32 or more hex digits (the webhook secret and CRON_SECRET are hex, and so are
# keys a library might print). Each line is cut to 300 characters, and the
# whole to 6000.
redact() {
  # Values from .env whose names say they are secret, as written there:
  # `export` dropped, quotes and a trailing comment taken off, CR removed.
  # On compose.yml the secrets are files in the config folder, not .env lines:
  # read through the database container, which mounts that folder. A VAPID
  # private key is base64url, a shape nothing below would catch. In container
  # mode, the variables the Kinboard containers were given (a UI's own).
  secrets="$( { tr -d '\r' < "${STACK_ENV_FILE:-$PROJECT_DIR/webapp/docker/.env}" 2>/dev/null || true
    case "${STACK_MODE:-}" in compose | container) stored_secrets ;; esac
    # Container mode has no .env: the variables a UI gave the containers.
    if [ "${STACK_MODE:-}" = container ]; then
      for s_svc in init db-init webapp "$AIO_SVC"; do
        docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(svc_container "$s_svc")" 2>/dev/null || true
      done
    fi; } \
    | sed -nE 's/^[[:space:]]*(export[[:space:]]+)?[A-Z0-9_]*(SECRET|PASSWORD|PASS|TOKEN|KEY|URL|URI|DSN|CODE|PAT)[A-Z0-9_]*=(.*)$/\3/p' \
    | sed 's/[[:space:]]#.*$//; s/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/' \
    | awk 'length($0) >= 6' || true)"
  SECRETS="$secrets" awk '
    BEGIN {
      n = split(ENVIRON["SECRETS"], s, "\n")
      q = "\047"
      hex = "[0-9a-fA-F]"; hexre = ""
      for (i = 0; i < 32; i++) hexre = hexre hex
      hexre = hexre "+"
      val = "(\"[^\"]*\"|" q "[^" q "]*" q "|[^] ,;&\"" q "[{}()]+)"
      kv = "(password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|appid|client[_-]?secret|pin|join[_-]?code)[a-z_-]*\"?[ ]*[=:][ ]*" val
      sqlpw = "password +" q "[^" q "]*" q
      qp = "[?&](key|code|sig|signature|state|access_token)=[^& ]+"
      total = 0
    }
    # Postgres repeats the failing row and the statement in these; they hold
    # family data (names, join codes, a PIN in integration_secrets).
    /^[ \t]*(DETAIL|STATEMENT|CONTEXT|QUERY|HINT):|^[ \t]*LINE [0-9]+:/ { $0 = "[a database detail line, left out]" }
    {
      line = $0
      gsub(/Failing row contains \(.*\)/, "Failing row contains ([redacted])", line)
      for (i = 1; i <= n; i++) {
        if (s[i] == "") continue
        from = 1
        while ((p = index(substr(line, from), s[i])) > 0) {
          p += from - 1
          line = substr(line, 1, p - 1) "[redacted]" substr(line, p + length(s[i]))
          from = p + length("[redacted]")
        }
      }
      gsub(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, "[redacted]", line)
      gsub(/:\/\/[^\/ ]*@/, "://[redacted]@", line)
      gsub(/[Bb][Ee][Aa][Rr][Ee][Rr] [^ ]+/, "Bearer [redacted]", line)
      gsub(/[Bb][Aa][Ss][Ii][Cc] [A-Za-z0-9+\/=]+/, "Basic [redacted]", line)
      gsub(hexre, "[redacted]", line)
      for (pass = 1; pass <= 3; pass++) {
        re = (pass == 1) ? kv : (pass == 2) ? sqlpw : qp
        lower = tolower(line); out = ""
        while (match(lower, re)) {
          seg = substr(line, RSTART, RLENGTH)
          e = index(seg, "="); c = index(seg, ":"); sp = index(seg, " ")
          if (pass == 2) e = sp
          else if (pass == 3) e = index(seg, "=")
          else if (e == 0 || (c > 0 && c < e)) e = c
          out = out substr(line, 1, RSTART - 1) substr(seg, 1, e) "[redacted]"
          line = substr(line, RSTART + RLENGTH); lower = substr(lower, RSTART + RLENGTH)
        }
        line = out line
      }
      if (length(line) > 300) line = substr(line, 1, 300) "…"
      total += length(line) + 1
      if (total > 6000) exit
      print line
    }'
}

# The secrets a compose.yml install keeps as files (kinboard-init), one
# STORED_SECRET=<value> line each, read through the database container, which
# mounts the config folder at /kinboard. Nothing when that fails.
stored_secrets() {
  db="$(db_container)"
  [ -n "$db" ] || return 0
  # shellcheck disable=SC2016
  # The all-in-one image names its store in KINBOARD_SECRETS_DIR.
  docker exec "$db" sh -c 'd=/kinboard/secrets/; [ -z "${KINBOARD_SECRETS_DIR:-}" ] || d="$KINBOARD_SECRETS_DIR/"; for f in "$d"*; do [ -f "$f" ] && printf "STORED_SECRET=%s\n" "$(cat "$f")"; done' 2>/dev/null || true
}

# The last lines each of the given services' containers logged, for Details,
# with secrets taken out (redact).
log_excerpt() {
  for svc in $1; do
    cid="$(svc_container "$svc")"
    [ -n "$cid" ] || continue
    echo "--- $svc"
    docker logs --tail 30 "$cid" 2>&1 || true
  done | tail -n 60 | redact
}

# ---------------------------------------------------------------------------
# The reconciliation tick (RFC-023 §4.11.5).
#
# Diun watches the image the running container was created from, not .env. So
# after a deploy pinned to a sha-… tag, putting KINBOARD_TAG=next back in .env
# changes nothing Diun can see: the pinned tag never moves, and updates stay
# stopped until someone runs `up -d` by hand. That happened on the
# maintainer's own install on 2026-11-26.
#
# So the webhook container runs this script with --tick every 30 minutes (0-5
# minutes of jitter, the first one 2 minutes after the loop starts). A tick:
#   - does no git pull and no setup.sh: those belong to a release, which Diun
#     announces; a tick only brings what runs in line with what is configured;
#   - the first time ever, only records a baseline and logs what differs, as
#     Diun's own firstCheckNotif=false does on its first sighting of an image:
#     a script arriving on an install does not recreate anything on its own
#     first look;
#   - after that, for each running service whose container runs another image
#     reference than the compose files and .env name, pulls that service and
#     recreates it, with backup, health wait and rollback as any run. Nothing
#     else: a newer image under the same reference is Diun's to announce
#     (its run does the release's git pull and setup.sh first); a pinned tag
#     is a reference that matches, so nothing happens there; a service
#     someone stopped stays stopped; no orphan is removed. With nothing to
#     apply it does not even ask the registry;
#   - when the registry or the network is down, touches nothing and waits:
#     30 minutes, then twice as long each time, up to 6 hours.
#
# RFC-023 §4.11.3 has the published updater compare remote digests too: it
# has no Diun. A git install has, and a tick that applied a new digest before
# Diun's run would start a release without the compose files and .env keys
# that run brings.
#
# The loop is started by the webhook container's entrypoint
# (docker-compose.diun.yml), and by any run inside a webhook container that
# has none yet: a container created before this script cannot have it in its
# entrypoint, and the self-update never recreates the container it runs in.
# ---------------------------------------------------------------------------

TICK_INTERVAL="${KINBOARD_TICK_INTERVAL:-1800}"

# KINBOARD_UPDATE_TICK from .env, read each time: the webhook container's own
# environment is fixed when it is created, and the self-update never recreates
# it, so an `off` set later would never reach an existing install. The
# container's environment is the fallback.
tick_switch() {
  # Before the stack is resolved (the loop, and a tick's first look): the
  # root's .env when it names the switch, where a git install on compose.yml
  # keeps its variables (one that moved there may still have the old
  # webapp/docker/.env); else webapp/docker/.env, as always.
  v=""
  if [ "$STACK_MODE" = legacy ]; then
    v="$(grep -E '^KINBOARD_UPDATE_TICK=' "$PROJECT_DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"' || true)"
  fi
  [ -n "$v" ] || v="$(env_value KINBOARD_UPDATE_TICK)"
  echo "${v:-${KINBOARD_UPDATE_TICK:-on}}"
}

run_tick_loop() {
  if [ -n "$UPDATER" ]; then
    run_updater_loop
  fi
  [ "$(tick_switch)" != off ] || exit 0
  command -v flock >/dev/null 2>&1 || exit 0
  # One loop per container.
  exec 8>/tmp/kinboard-update-tick.lock
  flock -n 8 || exit 0
  sleep "${KINBOARD_TICK_FIRST:-120}"
  while :; do
    # The script on disk now, not this copy: `git pull` replaces it.
    if [ "$(tick_switch)" != off ]; then
      sh "$PROJECT_DIR/webapp/docker/kinboard-self-update.sh" --tick </dev/null >/dev/null 2>&1 8>&- || true
    fi
    sleep $(( TICK_INTERVAL + $(awk 'BEGIN { srand(); print int(rand() * 300) }') ))
  done
}

# The updater's loop: the container's main process. Its ticks write to the
# container's log as well as to the log file, so a Compose UI shows them.
# The waits are in the background so that `docker stop` ends it at once.
run_updater_loop() {
  trap 'exit 0' TERM INT
  # Container mode: an update cut short (this container was stopped or the
  # host rebooted mid-swap) may have left the webapp stopped. Its check puts
  # the originals back now, not two minutes from now.
  if [ -f "$CM_JOURNAL" ] && [ "${KINBOARD_UPDATE_TICK:-on}" != off ]; then
    log "kinboard-updater: an update was cut short; checking at once"
    sh "$0" --tick </dev/null || true
  fi
  log "kinboard-updater: the first check is in ${KINBOARD_TICK_FIRST:-120} s, then every $((TICK_INTERVAL / 60)) minutes (log: $LOG_FILE)"
  sleep "${KINBOARD_TICK_FIRST:-120}" & wait $! || true
  while :; do
    if [ "${KINBOARD_UPDATE_TICK:-on}" != off ]; then
      sh "$0" --tick </dev/null || true
    fi
    sleep $(( TICK_INTERVAL + $(awk 'BEGIN { srand(); print int(rand() * 300) }') )) & wait $! || true
  done
}

ensure_tick_loop() {
  [ "$(tick_switch)" != off ] || return 0
  [ -f /.dockerenv ] && command -v webhook >/dev/null 2>&1 || return 0
  command -v flock >/dev/null 2>&1 || return 0
  # Held by the loop for as long as it lives.
  if ( exec 8>/tmp/kinboard-update-tick.lock; flock -n 8 ); then
    # Detached and with nothing of ours open: the webhook reads this run's
    # output until every holder of it has closed it.
    detach=""
    command -v setsid >/dev/null 2>&1 && detach=setsid
    $detach sh "$PROJECT_DIR/webapp/docker/kinboard-self-update.sh" --tick-loop </dev/null >/dev/null 2>&1 9>&- &
    log "started the 30-minute reconciliation tick in this container"
  fi
}

# Whether a tick may run now; logs why not.
tick_allowed() {
  until_ts="$(state_get backoff_until)"
  if [ -n "$until_ts" ] && [ "$(date +%s)" -lt "$until_ts" ]; then
    log "tick: backing off after $(state_get failures) failed tick(s); next try after $(date -u -d "@$until_ts" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "$until_ts")"
    return 1
  fi
  return 0
}

# $1: why. The next tick waits 30 minutes, then twice as long each time, up
# to 6 hours.
tick_backoff() {
  n="$(state_get failures)"
  n=$(( ${n:-0} + 1 ))
  wait_s="$TICK_INTERVAL"
  i=1
  while [ "$i" -lt "$n" ] && [ "$wait_s" -lt 21600 ]; do wait_s=$((wait_s * 2)); i=$((i + 1)); done
  [ "$wait_s" -le 21600 ] || wait_s=21600
  state_set failures "$n"
  # A minute short of the wait, so the jittered tick that lands on it runs.
  state_set backoff_until "$(( $(date +%s) + wait_s - 60 ))"
  log "tick skipped: $1; nothing was changed. Next try in $((wait_s / 60)) minutes (failure $n in a row)"
}

# ---------------------------------------------------------------------------
# No git checkout (RFC-023 §4.8).
#
# Everything this script does first is git-shaped: `git fetch origin main`,
# `git pull`, setup.sh writing .env. A compose.yml pasted into a folder has no
# checkout, and that folder may sit inside some other repository (a UI that
# keeps all its stacks in one), where `git fetch origin main` would fetch a
# stranger's repository and `git pull` merge it. So a project directory
# without its own .git is not updated from here at all, before anything is
# locked, read or written: no backup, no pull, no recreate, nothing half done.
# It exits 0, because nothing failed: such an install is updated with Pull
# and Up, and its automatic updates are the published kinboard-updater's
# (RFC-023 §4.11.3).
#
# Only a missing .git counts. A .git that git refuses to read (a checkout
# owned by another user) goes on as before and fails at `git fetch`, loudly.
# ---------------------------------------------------------------------------
# The updater (KINBOARD_UPDATER) is that published image: it has no git
# checkout by design and never runs git; see "The updater" below.
if [ -z "$UPDATER" ] && [ ! -d "$PROJECT_DIR" ]; then
  log "ERROR: PROJECT_DIR=$PROJECT_DIR is not a folder here; nothing was changed"
  exit 1
fi
if [ -z "$UPDATER" ] && [ ! -e "$PROJECT_DIR/.git" ]; then
  log "this install has no git checkout ($PROJECT_DIR has no .git), so it is not updated from here; nothing was pulled, run or changed. Update it with Pull and Up in your Compose UI, or: docker compose pull && docker compose up -d"
  exit 0
fi
# A checkout, but of something else: a stack folder some Compose UIs keep in
# a repository of their own (Komodo's and Portainer's git stacks, say), with
# compose.yml in it. Its `origin main` is the household's own repository.
# Only a checkout git can read is judged here; one it refuses (owned by
# another user) goes on and fails at `git fetch`, as it always has.
if [ -z "$UPDATER" ] && git -C "$PROJECT_DIR" rev-parse --git-dir >/dev/null 2>&1 \
   && ! git -C "$PROJECT_DIR" ls-files --error-unmatch webapp/docker/kinboard-self-update.sh >/dev/null 2>&1; then
  log "$PROJECT_DIR is a git checkout, but not of Kinboard (it does not track webapp/docker/kinboard-self-update.sh), so it is not updated from here; nothing was pulled, run or changed. Update it with Pull and Up in your Compose UI, or: docker compose pull && docker compose up -d"
  exit 0
fi

# ---------------------------------------------------------------------------
# Which files the stack runs (RFC-023 §4.11.2, §5.2).
#
# Every git install before RFC-023 runs webapp/docker/docker-compose.yml and
# the overlays in COMPOSE_FILES, read from webapp/docker. A git install that
# moved to the root compose.yml runs that file instead, from the root, with
# the root's .env and its overlays as absolute paths. The legacy set run
# against it would find no containers (another project) and start a second
# stack beside it. So the files come from the stack itself: Compose records on
# every container the project, its folder, the files and the .env it was
# started with (com.docker.compose.project, .project.working_dir,
# .project.config_files, .project.environment_file).
#
# Whose labels: this container's, when it is part of the stack (the Diun
# overlay's webhook; the updater of RFC-023 §4.11.3); else those of the
# webapp container whose project folder is PROJECT_DIR or its webapp/docker.
# KINBOARD_SELF_CONTAINER names the container to read instead of this one.
#
#   the labels say        COMPOSE_FILES             what runs
#   nothing, or legacy    names no compose.yml      COMPOSE_FILES as given, as always
#   compose.yml           names no compose.yml      the labelled files (the Diun
#                                                   overlay's default is the legacy set)
#   compose.yml, nothing  names compose.yml         COMPOSE_FILES, made absolute
#   legacy                names compose.yml         refused: two different stacks
#
# On compose.yml every `docker compose` call gets -p, --project-directory,
# --env-file and absolute -f paths, through COMPOSE_FILES, so nothing below
# needs to know which kind of stack it runs except where the two really
# differ: setup.sh, the services 1.15 retired, and where the backup finds the
# data.
# ---------------------------------------------------------------------------

LABELS_TMPL='{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "com.docker.compose.project.environment_file"}}'

# "project|working_dir|config_files|environment_file" of container $1, or nothing.
stack_labels() {
  docker inspect -f "$LABELS_TMPL" "$1" 2>/dev/null | head -n1 | sed 's/<no value>//g' || true
}

# The container whose labels describe the stack, or nothing.
stack_container() {
  self="${KINBOARD_SELF_CONTAINER:-}"
  if [ -z "$self" ] && [ -f /.dockerenv ]; then self="$(hostname 2>/dev/null || true)"; fi
  if [ -n "$self" ]; then
    # Only when its project is a Kinboard stack, one with a webapp: a
    # container of some other project that happens to run this script must
    # not have its project pulled and recreated.
    project="$(stack_labels "$self" | cut -d'|' -f1)"
    if [ -n "$project" ] && [ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=webapp 2>/dev/null || true)" ]; then
      echo "$self"
      return 0
    fi
  fi
  pd="${PROJECT_DIR%/}"
  physical="$(cd "$pd" 2>/dev/null && pwd -P || true)"
  # Running containers first: a stopped copy from an older project in the
  # same folder must not decide.
  for all in "" -a; do
    # shellcheck disable=SC2086
    for cid in $(docker ps $all -q --filter label=com.docker.compose.service=webapp 2>/dev/null || true); do
      wd="$(stack_labels "$cid" | cut -d'|' -f2)"
      case "$wd" in
        "") ;;
        "$pd" | "$pd/webapp/docker" | "$physical" | "$physical/webapp/docker") echo "$cid"; return 0 ;;
      esac
    done
  done
  return 0
}

# The files COMPOSE_FILES names (-f, --file), one per line, as written.
cf_files() {
  set -f
  # shellcheck disable=SC2086
  set -- $COMPOSE_FILES
  set +f
  while [ $# -gt 0 ]; do
    case "$1" in
      -f | --file) [ $# -ge 2 ] || break; echo "$2"; shift 2 ;;
      --file=*) echo "${1#--file=}"; shift ;;
      *) shift ;;
    esac
  done
}

# $1 as an absolute path, a relative one taken from webapp/docker (where
# COMPOSE_FILES has always been read), or nothing when its folder is missing.
abs_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) d="$(cd "$PROJECT_DIR/webapp/docker" 2>/dev/null && cd "$(dirname "$1")" 2>/dev/null && pwd || true)"
       [ -z "$d" ] || printf '%s/%s\n' "$d" "$(basename "$1")" ;;
  esac
}

# Sets STACK_MODE, STACK_ENV_FILE and, for compose.yml, COMPOSE_FILES; or
# logs why it cannot and returns 1, before anything has been touched.
resolve_stack() {
  # kinboard-updater beside the all-in-one image: one container, no stack.
  if [ -n "$UPDATER" ]; then
    if aio_applies "$(updater_self)"; then
      aio_resolve
      return $?
    fi
    if [ -n "$AIO_ERR" ]; then
      log "ERROR: $AIO_ERR. Nothing was changed"
      return 1
    fi
  fi
  cf_compose=""
  for f in $(cf_files); do
    case "${f##*/}" in compose.yml | compose.yaml) cf_compose=1 ;; esac
  done
  cid="$(stack_container)"
  labels=""
  [ -z "$cid" ] || labels="$(stack_labels "$cid")"
  IFS='|' read -r l_project l_workdir l_files l_envfiles <<EOF
$labels
EOF
  # compose.yml only when the labels name it and not the legacy file; any
  # other set of labels is legacy, as every stack was before this. Compose v1
  # (docker-compose 1.x, which start.sh prefers where it is installed) may
  # record the files relative to the project folder, as given to -f.
  l_kind=none
  if [ -n "$l_files" ]; then
    l_kind=legacy
    case ",$l_files," in
      *"/webapp/docker/docker-compose.yml,"* | *",docker-compose.yml,"*) ;;
      *"/compose.yml,"* | *"/compose.yaml,"* | *",compose.yml,"* | *",compose.yaml,"*) l_kind=compose ;;
    esac
    # The updater runs only beside compose.yml, whatever a UI names the file
    # (Unraid's Compose Manager: docker-compose.yml; OpenMediaVault:
    # <name>.yml). Only the git install's own file is legacy. Later the
    # webapp's KINBOARD_COMPOSE_REVISION confirms it is the one-file stack.
    if [ -n "$UPDATER" ] && [ "$l_kind" = legacy ]; then
      case ",$l_files," in
        *"/webapp/docker/docker-compose.yml,"*) ;;
        *) l_kind=compose ;;
      esac
    fi
  fi
  # A git install on the legacy file: nothing here changes anything.
  if [ -z "$cf_compose" ] && [ "$l_kind" != compose ]; then
    return 0
  fi
  if [ -n "$cf_compose" ] && [ "$l_kind" = legacy ]; then
    log "ERROR: COMPOSE_FILES names compose.yml ($COMPOSE_FILES), but the running stack was started with $l_files. Running one against the other would start a second stack; nothing was changed. Set COMPOSE_FILES to the files the stack runs"
    return 1
  fi
  case "$l_project|$l_workdir|$l_files|$l_envfiles" in
    *[[:space:]]*)
      log "ERROR: the stack's project, folder or file names contain a space ($l_files); this script cannot pass them to docker compose. Nothing was changed"
      return 1 ;;
  esac
  set -f
  if [ -n "$cf_compose" ]; then
    files=""
    for f in $(cf_files); do
      a="$(abs_path "$f")"
      if [ -z "$a" ]; then
        set +f
        log "ERROR: COMPOSE_FILES names $f, whose folder does not exist here (relative paths are read from $PROJECT_DIR/webapp/docker). Nothing was changed"
        return 1
      fi
      files="$files $a"
    done
    [ "$l_kind" = none ] || STACK_NOTE="the running stack was started with $l_files; using COMPOSE_FILES"
  else
    files=""
    for f in $(printf '%s' "$l_files" | tr ',' ' '); do
      case "$f" in
        /*) files="$files $f" ;;
        *) files="$files ${l_workdir%/}/$f" ;;
      esac
    done
    STACK_NOTE="the running stack was started with $l_files (its Compose labels); COMPOSE_FILES ($COMPOSE_FILES) names the legacy files and is not used"
  fi
  first="${files# }"; first="${first%% *}"
  workdir="${l_workdir:-$(dirname "$first")}"
  # kinboard-updater: a file the labels name that cannot be read here, from
  # the sibling that mounts their folders (or with no sibling at all, when the
  # host has not even the folder), is not on the host: container mode.
  #
  # Only when none of its compose files is there: one file of several gone,
  # or only the .env, is a mistake to report (below), not another mode.
  if [ -n "$UPDATER" ]; then
    gone="${KINBOARD_CONTAINER_MODE_WHY:-}"
    if [ -z "$gone" ]; then
      gone="the stack's compose file ($l_files, in $workdir) is not on this host's disk"
      for f in $files; do
        case "$f" in /*) ;; *) f="${workdir%/}/$f" ;; esac
        [ ! -r "$f" ] || gone=""
      done
    fi
    if [ -n "$gone" ]; then
      set +f
      if [ -z "$l_project" ]; then
        log "ERROR: $gone, and its containers carry no Compose project; nothing was changed"
        return 1
      fi
      STACK_MODE=container
      STACK_PROJECT="$l_project"
      # No file to read variables from: an empty one, for env_value and redact.
      STACK_ENV_FILE=/dev/null
      unset COMPOSE_FILES
      COMPOSE_FILES=""
      unset TZ
      STACK_NOTE="container mode: $gone (a Portainer web-editor stack keeps it inside Portainer); the Kinboard containers are recreated from their own configuration, with only the image changed"
      return 0
    fi
  fi
  args=""
  [ -z "$l_project" ] || args="-p $l_project"
  args="$args --project-directory $workdir"
  envfile=""
  for e in $(printf '%s' "$l_envfiles" | tr ',' ' '); do
    case "$e" in /*) ;; *) e="${workdir%/}/$e" ;; esac
    if [ ! -r "$e" ]; then
      set +f
      log "ERROR: the stack was started with the env file $e, which cannot be read here (it must be mounted at the same path). Nothing was changed"
      return 1
    fi
    args="$args --env-file $e"
    envfile="$e"
  done
  for f in $files; do
    if [ ! -r "$f" ]; then
      set +f
      log "ERROR: the stack was started with $f, which cannot be read here (it must be mounted at the same path). Nothing was changed"
      return 1
    fi
    args="$args -f $f"
  done
  set +f
  STACK_MODE=compose
  STACK_ENV_FILE="${envfile:-$workdir/.env}"
  # Not exported any more: the Diun overlay fills the webhook's own
  # environment from ${COMPOSE_FILES}, and these flags are this script's.
  unset COMPOSE_FILES
  COMPOSE_FILES="${args# }"
  # The webhook container sets TZ for itself (Etc/UTC when .env has none),
  # and a variable in the environment wins over .env when Compose fills in
  # ${TZ:-Europe/Berlin}: a recreated webapp would get another time zone than
  # the one `docker compose up` gave it. The script's own times are UTC (-u).
  unset TZ
  return 0
}
STACK_NOTE=""

# ---------------------------------------------------------------------------
# The updater (RFC-023 §4.11.3): automatic updates for a one-file install.
#
# compose.yml's `updater` service, started only with the `autoupdate` profile,
# runs this script from the published kinboard-updater image with
# KINBOARD_UPDATER=1. Such an install has no git checkout and no setup.sh, so
# an update there is images only: everything a release changes ships in the
# image (§2), and what does not (a new pin, a new service) raises the file's
# KINBOARD_COMPOSE_REVISION, which the updater checks before it applies
# anything. Every run is a tick; the loop runs one 2 minutes after the
# container starts and then every 30 minutes, with 0-5 minutes of jitter.
#
#   - The stack comes from the updater's own Compose labels (resolve_stack,
#     KINBOARD_SELF_CONTAINER). The files they name are on the host, not in
#     this container, so the tick runs in a sibling container that mounts
#     each of their folders read-only at the same path, shares this
#     container's network and volumes (the socket, the config volume) and
#     runs this same image ("compose-file mode"). A path that is not on the
#     host (Portainer's web editor keeps its stacks inside its own volume) is
#     container mode: the Kinboard containers are recreated from their own
#     configuration with the new image (see "Container mode").
#   - State, lock and log are in the config volume (updater/), never in git.
#   - The first tick records a baseline and changes nothing.
#   - Then, for each running service: a reference that differs from what the
#     file and its variables name now (a KINBOARD_TAG changed) is applied, as
#     on a git install's tick; and for the Kinboard image under a floating
#     tag (latest, next, main, 1.18, ...) the registry is asked for the
#     tag's digest with one manifest HEAD. A digest the running image was not
#     pulled as is an update. A pinned tag (1.18.0, sha-..., a digest) never
#     moves, and is never asked about. The other images (database,
#     PostgREST, go2rtc) are pins in the file: they change with the file.
#   - A registry that cannot be reached, or answers 429, ends the tick before
#     anything is pulled or touched, and the next tick waits longer (30, 60,
#     120 minutes ... up to 6 hours).
#   - After the pull, the new image's compose revision (its label
#     app.kinboard.compose-revision) must equal the file's. Otherwise the
#     update is held: the tag goes back to what runs, nothing is backed up or
#     recreated, the log says so at every tick, and Settings shows the
#     "older compose file" notice once.
#   - Then the same steps as every run: a verified backup (database, files,
#     config), only the changed services recreated, health wait, smoke check,
#     rollback, the status record.
# ---------------------------------------------------------------------------

# The container this updater runs in: KINBOARD_SELF_CONTAINER (the sibling
# gets it), else this container's id. The id is read from the mounts Docker
# gives every container (/etc/hostname comes from .../containers/<id>/), not
# from the hostname, which is the host's under `network_mode: host`.
updater_self() {
  if [ -n "${KINBOARD_SELF_CONTAINER:-}" ]; then
    printf '%s\n' "$KINBOARD_SELF_CONTAINER"
    return 0
  fi
  [ -f /.dockerenv ] || return 0
  id="$(grep -o '/containers/[0-9a-f]\{64\}/' /proc/self/mountinfo 2>/dev/null | head -n1 | cut -d/ -f3 || true)"
  if [ -n "$id" ]; then printf '%s\n' "$id"; else hostname 2>/dev/null || true; fi
}

# Runs this tick in the sibling: $1 this container, $2 the project, $3 the
# image, $4 the host folders to mount read-only at the same path; or none,
# and $5 why: container mode.
hop_run() {
  hr_self="$1" hr_project="$2" hr_image="$3" hr_dirs="$4" hr_why="${5:-}"
  # A fixed name per stack: a tick still running blocks a second one.
  set -- --rm --name "$hr_project-updater-tick" --network "container:$hr_self" --volumes-from "$hr_self" --label app.kinboard.updater-tick=1 \
    -e KINBOARD_UPDATER=1 -e KINBOARD_UPDATER_SIBLING=1 -e "KINBOARD_SELF_CONTAINER=$hr_self"
  for d in $hr_dirs; do set -- "$@" --mount "type=bind,source=$d,target=$d,readonly"; done
  [ -z "$hr_why" ] || set -- "$@" -e "KINBOARD_CONTAINER_MODE_WHY=$hr_why"
  for v in $UPDATER_PASS_ENV; do
    val="$(printenv "$v" 2>/dev/null || true)"
    [ -z "$val" ] || set -- "$@" -e "$v=$val"
  done
  docker run "$@" --entrypoint sh "$hr_image" /usr/local/bin/kinboard-self-update.sh --tick
}

# What a tick reads from its environment, handed on to the sibling.
UPDATER_PASS_ENV="KINBOARD_AIO_CONTAINER KINBOARD_PG_UPGRADE_TIMEOUT KINBOARD_UNRAID_STATUS_FILE KINBOARD_UPDATE_TICK KINBOARD_HEALTH_TIMEOUT KINBOARD_HEALTH_POLL KINBOARD_SMOKE_TIMEOUT KINBOARD_TICK_INTERVAL KINBOARD_BACKUP_DIR BACKUP_KEEP KINBOARD_INSECURE_REGISTRIES KINBOARD_REGISTRY_TIMEOUT KINBOARD_UPDATER_DIR KINBOARD_LOG_MAX LOG_FILE"

# Runs this tick in the sibling container (see above) and exits with its
# status; returns when the stack's files can already be read here.
updater_hop() {
  self="$(updater_self)"
  # Beside the all-in-one image (see "The all-in-one image"): there are no
  # compose files to mount, only the socket and the updater's own folder, as
  # in container mode.
  if aio_applies "$self"; then
    image="$(docker inspect -f '{{.Image}}' "$self" 2>/dev/null || true)"
    if [ -z "$image" ]; then
      log "ERROR: cannot read the updater's own image; nothing was changed"
      exit 1
    fi
    hop_err="${TMPDIR:-/tmp}/kinboard-updater-hop.$$"
    rc=0
    hop_run "$self" "$AIO_NAME" "$image" "" "" 2>"$hop_err" || rc=$?
    if [ "$rc" = 125 ]; then
      log "ERROR: could not start the tick's container: $(grep -v '^[[:space:]]*$' "$hop_err" | tail -n1); nothing was changed"
    fi
    cat "$hop_err" >&2 2>/dev/null || true
    rm -f "$hop_err"
    exit "$rc"
  fi
  if [ -n "$AIO_ERR" ]; then
    log "ERROR: $AIO_ERR. Nothing was changed"
    exit 1
  fi
  labels=""
  [ -z "$self" ] || labels="$(stack_labels "$self")"
  IFS='|' read -r h_project h_workdir h_files h_envfiles <<HOP
$labels
HOP
  if [ -z "$h_project" ] || [ -z "$h_files" ]; then
    log "ERROR: the updater cannot read its own Compose labels (container ${self:-unknown}); start it with docker compose from compose.yml, with the autoupdate profile. Nothing was changed"
    exit 1
  fi
  case "$h_workdir|$h_files|$h_envfiles" in
    *[[:space:]]*)
      log "ERROR: the stack's folder or file names contain a space ($h_files); the updater cannot pass them to docker compose. Nothing was changed"
      exit 1 ;;
  esac
  paths=""
  readable=1
  for f in $(printf '%s,%s' "$h_files" "$h_envfiles" | tr ',' ' '); do
    case "$f" in /*) ;; *) f="${h_workdir%/}/$f" ;; esac
    paths="$paths $f"
    [ -r "$f" ] || readable=""
  done
  [ -z "$readable" ] || return 0
  dirs="$( { for f in $paths; do dirname "$f"; done; [ -z "$h_workdir" ] || echo "$h_workdir"; } | sort -u)"
  image="$(docker inspect -f '{{.Image}}' "$self" 2>/dev/null || true)"
  if [ -z "$image" ]; then
    log "ERROR: cannot read the updater's own image; nothing was changed"
    exit 1
  fi
  hop_err="${TMPDIR:-/tmp}/kinboard-updater-hop.$$"
  rc=0
  hop_run "$self" "$h_project" "$image" "$dirs" 2>"$hop_err" || rc=$?
  # Docker refuses to mount a folder the host does not have: the files are
  # not on this host's disk at all (a Portainer web-editor stack keeps them
  # inside Portainer's own volume). Then the tick is container mode, in the
  # same kind of sibling without the folders: it needs only the socket and
  # the config volume, and it is not cut short when this container is
  # recreated.
  if [ "$rc" = 125 ] && grep -q 'bind source path does not exist' "$hop_err" 2>/dev/null; then
    rc=0
    hop_run "$self" "$h_project" "$image" "" \
      "the stack's files ($(printf '%s' "${paths# }" | tr ' ' ',')) are not on this host's disk" 2>"$hop_err" || rc=$?
  fi
  if [ "$rc" = 125 ]; then
    log "ERROR: could not start the tick's container: $(grep -v '^[[:space:]]*$' "$hop_err" | tail -n1); nothing was changed"
  fi
  cat "$hop_err" >&2 2>/dev/null || true
  rm -f "$hop_err"
  exit "$rc"
}

# The repository of reference $1, without tag or digest (a registry port
# stays: localhost:5000/kinboard).
ref_repo() {
  r="${1%%@*}"
  case "${r##*/}" in *:*) r="${r%:*}" ;; esac
  printf '%s\n' "$r"
}

# The tag of reference $1 (latest when it names none).
ref_tag() {
  r="${1%%@*}"
  case "${r##*/}" in *:*) printf '%s\n' "${r##*:}" ;; *) echo latest ;; esac
}

# Whether reference $1 is pinned: a digest, an exact version (1.18.0,
# v1.18.0-rc.2) or a sha-<commit> build. Those never move, so the updater
# never asks the registry about them (RFC-023 §4.11.5, "The cadence").
ref_pinned() {
  case "$1" in *@*) return 0 ;; esac
  printf '%s\n' "$(ref_tag "$1")" | grep -Eq '^(v?[0-9]+\.[0-9]+\.[0-9]+([-+.].*)?|sha-[0-9a-f]+)$'
}

# The digest the registry serves for reference $1 now, from one manifest HEAD,
# in REMOTE_DIGEST; or 1 with the reason in REMOTE_ERR. Anonymous: a registry
# that wants a token gets one from its own realm without credentials, as
# `docker pull` of a public image does.
remote_digest() {
  REMOTE_DIGEST=""
  REMOTE_ERR=""
  # Transient (no network, 429, 5xx): the tick ends and backs off. Anything
  # else (401, 404, no digest) is about this one reference only.
  REMOTE_TRANSIENT=1
  repo="$(ref_repo "$1")"
  tag="$(ref_tag "$1")"
  first="${repo%%/*}"
  case "$repo" in
    */*)
      case "$first" in
        docker.io | index.docker.io) host=registry-1.docker.io; path="${repo#*/}" ;;
        *.* | *:* | localhost) host="$first"; path="${repo#*/}" ;;
        *) host=registry-1.docker.io; path="$repo" ;;
      esac ;;
    *) host=registry-1.docker.io; path="library/$repo" ;;
  esac
  case "$host/$path" in registry-1.docker.io/*/*) ;; registry-1.docker.io/*) path="library/$path" ;; esac
  scheme=https
  case "$host" in localhost | localhost:* | 127.* | "[::1]"*) scheme=http ;; esac
  for h in $(printf '%s' "${KINBOARD_INSECURE_REGISTRIES:-}" | tr ',' ' '); do
    [ "$h" != "$host" ] || scheme=http
  done
  url="$scheme://$host/v2/$path/manifests/$tag"
  t="${KINBOARD_REGISTRY_TIMEOUT:-20}"
  accept="application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json"
  auth=""
  for attempt in 1 2; do
    if [ -n "$auth" ]; then
      hdr="$(curl -sS -I --proto '=http,https' -m "$t" -H "Accept: $accept" -H "Authorization: Bearer $auth" "$url" 2>&1)" || {
        REMOTE_ERR="the registry $host could not be reached ($(printf '%s\n' "$hdr" | tr -d '\r' | grep -v '^[[:space:]]*$' | tail -n1))"
        return 1
      }
    else
      hdr="$(curl -sS -I --proto '=http,https' -m "$t" -H "Accept: $accept" "$url" 2>&1)" || {
        REMOTE_ERR="the registry $host could not be reached ($(printf '%s\n' "$hdr" | tr -d '\r' | grep -v '^[[:space:]]*$' | tail -n1))"
        return 1
      }
    fi
    hdr="$(printf '%s\n' "$hdr" | tr -d '\r')"
    code="$(printf '%s\n' "$hdr" | awk 'toupper($1) ~ /^HTTP\// { c = $2 } END { print c }')"
    case "$code" in
      200)
        REMOTE_DIGEST="$(printf '%s\n' "$hdr" | sed -n 's/^[Dd][Oo][Cc][Kk][Ee][Rr]-[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Dd][Ii][Gg][Ee][Ss][Tt]: *\(sha256:[0-9a-f]\{64\}\).*$/\1/p' | tail -n1)"
        if [ -z "$REMOTE_DIGEST" ]; then
          REMOTE_ERR="the registry $host gave no digest for $1"
          REMOTE_TRANSIENT=""
          return 1
        fi
        return 0 ;;
      401)
        [ "$attempt" = 1 ] || break
        www="$(printf '%s\n' "$hdr" | sed -n 's/^[Ww][Ww][Ww]-[Aa][Uu][Tt][Hh][Ee][Nn][Tt][Ii][Cc][Aa][Tt][Ee]: *[Bb]earer *//p' | tail -n1)"
        realm="$(printf '%s' "$www" | sed -n 's/.*realm="\([^"]*\)".*/\1/p')"
        service="$(printf '%s' "$www" | sed -n 's/.*service="\([^"]*\)".*/\1/p')"
        scope="$(printf '%s' "$www" | sed -n 's/.*scope="\([^"]*\)".*/\1/p')"
        [ -n "$scope" ] || scope="repository:$path:pull"
        # Only https, unless the registry itself is plain http (a local one).
        case "$scheme|$realm" in https\|https://* | http\|https://* | http\|http://*) ;; *) break ;; esac
        auth="$(curl -sS -G --proto '=http,https' -m "$t" --data-urlencode "service=$service" --data-urlencode "scope=$scope" "$realm" 2>/dev/null \
          | tr ',' '\n' | sed -n 's/^.*"token" *: *"\([^"]*\)".*$/\1/p' | head -n1 || true)"
        [ -n "$auth" ] || break ;;
      429)
        REMOTE_ERR="the registry is rate-limiting (HTTP 429 from $host)"
        return 1 ;;
      5??)
        REMOTE_ERR="the registry $host answered HTTP $code for $1"
        return 1 ;;
      *)
        REMOTE_ERR="the registry $host answered HTTP ${code:-nothing} for $1"
        REMOTE_TRANSIENT=""
        return 1 ;;
    esac
  done
  REMOTE_ERR="the registry $host wants credentials for $1 (HTTP 401); the updater reads public images only"
  REMOTE_TRANSIENT=""
  return 1
}

# The registry digest image $1 was pulled as, under repository $2 (any, when
# none is under $2), or nothing.
image_digest() {
  docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$1" 2>/dev/null \
    | awk -v r="$2" -F@ 'NF == 2 { if ($1 == r) { mine = $2 } else if (any == "") { any = $2 } } END { print (mine != "" ? mine : any) }' || true
}

# The value service $1 sets for environment variable $2 in the stack's
# configuration (`docker compose config`), quotes removed; or nothing.
config_env() {
  # Container mode: what the container was created with.
  if [ "$STACK_MODE" = container ]; then
    docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(svc_container "$1")" 2>/dev/null \
      | awk -v k="$2" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' || true
    return 0
  fi
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES config 2>/dev/null | awk -v s="$1" -v k="$2" '
    /^services:/ { in_services = 1; next }
    /^[^ ]/ { in_services = 0 }
    in_services && /^  [^ ][^ ]*:$/ { svc = substr($0, 3, length($0) - 3); next }
    in_services && svc == s && /^    [^ ]/ { in_env = ($0 == "    environment:") ; next }
    in_services && svc == s && in_env && index($0, "      " k ":") == 1 {
      v = substr($0, length(k) + 8); gsub(/^ +| +$/, "", v); gsub(/^["'"'"']|["'"'"']$/, "", v); print v; exit
    }' || true
}

# Whether a rollback held back the image the registry serves as digest $1.
held_digest() {
  [ -n "$1" ] && awk -v d="$1" '$1 == "held" && $5 == d { found = 1 } END { exit !found }' "$STATE_FILE" 2>/dev/null
}

# For service $1, whose container $3 runs reference $2 while the file and its
# variables name $4: sets WATCH to
#   pull      apply it: another reference (a KINBOARD_TAG changed without
#             Up), or another digest under the same tag in the registry
#   current   it runs what the registry has
#   pinned    a pinned tag: never asked about
#   other     not the Kinboard image (the database, PostgREST, go2rtc): it
#             changes only with the household's own Up
#   held      a rollback held this digest back
#   compose   held for a newer compose file, which has not changed since
#   fail      the registry could not be reached or is rate-limiting
#   unwatched the registry cannot say for this reference (401, 404)
# WATCH_WHY says the digest or the reason. Each reference is asked about once
# per tick.
REMOTE_SEEN=""
updater_watch() {
  WATCH=current
  WATCH_WHY=""
  if [ "$(ref_repo "$4")" != "$KB_REPO" ]; then WATCH=other; return 0; fi
  hold="$(state_get compose_hold)"
  hold_digest="${hold%%|*}"
  hold_rev="$(printf '%s' "$hold" | cut -d'|' -f2)"
  hold_ref="$(printf '%s' "$hold" | cut -d'|' -f5)"
  held_here=""
  [ -z "$hold" ] || [ "$hold_ref" != "$4" ] || [ "$hold_rev" != "$FILE_REVISION" ] || held_here=1
  if ref_pinned "$4"; then
    if [ "$2" = "$4" ]; then WATCH=pinned; return 0; fi
    # A changed pin names one image for good: held by its name.
    if [ -n "$held_here" ]; then WATCH=compose; WATCH_WHY="$4"; return 0; fi
    WATCH=pull; WATCH_WHY="$4"
    return 0
  fi
  digest="$(printf '%s\n' "$REMOTE_SEEN" | awk -v r="$4" '$1 == r { print $2; exit }')"
  if [ -z "$digest" ]; then
    if ! remote_digest "$4"; then
      WATCH_WHY="$REMOTE_ERR"
      if [ -n "$REMOTE_TRANSIENT" ]; then WATCH=fail; else WATCH=unwatched; fi
      return 0
    fi
    digest="$REMOTE_DIGEST"
    REMOTE_SEEN="$REMOTE_SEEN$4 $digest
"
  fi
  WATCH_WHY="$digest"
  if [ -n "$held_here" ] && [ "$hold_digest" = "$digest" ]; then WATCH=compose; return 0; fi
  if [ "$2" != "$4" ]; then WATCH=pull; return 0; fi
  running="$(docker inspect -f '{{.Image}}' "$3" 2>/dev/null || true)"
  case " $(docker image inspect -f '{{join .RepoDigests " "}}' "$running" 2>/dev/null || true) " in
    *"@$digest "*) WATCH=current; return 0 ;;
  esac
  if held_digest "$digest"; then WATCH=held; return 0; fi
  WATCH=pull
}

# Where the household finds the updater's log, for the status record.
updater_log_location() {
  # The config volume is mounted one level above updater/ (/kinboard).
  root="$(dirname "$UPDATER_DIR")"
  case "$LOG_FILE" in
    "$root"/*) ;;
    *) printf '%s\n' "$LOG_FILE"; return 0 ;;
  esac
  if [ -n "$AIO" ]; then
    # Beside the all-in-one container, the updater has a folder of its own.
    src="$(container_mount "$(updater_self)" "$root")"
  else
    src="$(mount_source webapp /kinboard)"
  fi
  rel="${LOG_FILE#"$root"/}"
  case "$src" in
    /*) printf '%s/%s\n' "${src%/}" "$rel" ;;
    "") printf '%s (in the config volume; also: docker logs kinboard-updater)\n' "$rel" ;;
    *) printf '%s in the Docker volume %s (also: docker logs kinboard-updater)\n' "$rel" "$src" ;;
  esac
}

# After the pull: whether the Kinboard image this tick brought fits the
# compose file (RFC-023 §4.6, §4.11.3). Returns 1 when it does not; then the
# tag is pointed back at what runs, the hold is in the state file, the log
# says why, and Settings is told the first time.
updater_revision_ok() {
  kref="$(field_for webapp "$CONFIG_IMAGES")"
  [ -n "$kref" ] || return 0
  pulled=""
  for s in $PULL_SVCS; do
    [ "$(field_for "$s" "$CONFIG_IMAGES")" != "$kref" ] || pulled=1
  done
  [ -n "$pulled" ] || return 0
  new_id="$(docker image inspect -f '{{.Id}}' "$kref" 2>/dev/null || true)"
  wcid="$(svc_container webapp)"
  run_id="$(docker inspect -f '{{.Image}}' "$wcid" 2>/dev/null || true)"
  run_ref="$(docker inspect -f '{{.Config.Image}}' "$wcid" 2>/dev/null || true)"
  [ -n "$new_id" ] && [ "$new_id" != "$run_id" ] || return 0
  needed="$(docker image inspect -f '{{index .Config.Labels "app.kinboard.compose-revision"}}' "$new_id" 2>/dev/null || true)"
  case "$needed" in "<no value>") needed="" ;; esac
  if [ -n "$needed" ] && [ "$needed" = "$FILE_REVISION" ]; then
    if [ -n "$(state_get compose_hold)" ]; then
      state_set compose_hold ""
      clear_hold_record
    fi
    return 0
  fi
  to="$(image_version "$new_id" "$kref")"
  from="$(image_version "$run_id" "$run_ref")"
  # Point the tag back at what runs, so that an Up by hand starts nothing
  # half-matching. Only when the webapp runs that very tag: after a
  # KINBOARD_TAG change the new tag never named the running image.
  if [ -n "$run_id" ] && [ "$run_ref" = "$kref" ] && docker tag "$run_id" "$kref" >>"$LOG_FILE" 2>&1; then
    log "$kref points at the image the webapp runs again ($run_id), not the held one"
  fi
  if [ -z "$needed" ]; then
    why="it does not say which compose file revision it needs"
  else
    why="it needs compose file revision $needed; this file declares $FILE_REVISION"
  fi
  log "held: Kinboard $to ($new_id) is not applied: $why. Nothing was backed up or recreated; $from keeps running. Replace the compose file with the current one (keep your port, folders and time zone), then Pull and Up; Settings says the same"
  digest="$(image_digest "$new_id" "$(ref_repo "$kref")")"
  hold="${digest:-$new_id}|$FILE_REVISION|${needed:-none}|$to|$kref"
  if [ "$(state_get compose_hold)" != "$hold" ]; then
    state_set compose_hold "$hold"
    # Its own key: a rollback notice still showing in Settings stays.
    record="{\"status\":\"held_compose\",\"at\":$(json_str "$(date -u +%Y-%m-%dT%H:%M:%SZ)"),\"from\":$(json_str "$from"),\"to\":$(json_str "$to"),\"file_revision\":$(json_str "$FILE_REVISION"),\"needed_revision\":$(json_str "${needed:-}"),\"services\":\"\",\"backup\":\"\",\"backup_dir\":\"\",\"backup_at\":\"\",\"migration\":\"\",\"severe\":false,\"log_file\":$(json_str "$(updater_log_location)"),\"log\":\"\"}"
    STATUS_KEY=update_hold write_status "$record" "held_compose ($from → $to, compose file revision $FILE_REVISION, needs ${needed:-unknown})"
  fi
  return 1
}

# The held_compose record goes once the hold is over.
clear_hold_record() {
  db="$(db_container)"
  [ -n "$db" ] || return 0
  docker exec "$db" psql -U supabase_admin -d postgres -q -c "DELETE FROM public.instance_settings WHERE key = 'update_hold'" >>"$LOG_FILE" 2>&1 \
    || log "WARN: could not remove the compose-file notice from Settings"
}

# "<target> <type> <source>" for each mount of service $1 as the file and its
# variables describe it now (`docker compose config`); a named volume by its
# Docker name.
config_mounts() {
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES config 2>/dev/null | awk -v s="$1" '
    /^services:/ { sec = "s"; next }
    /^volumes:/ { sec = "v"; next }
    /^[^ ]/ { sec = ""; next }
    sec == "v" && /^  [^ ][^ ]*:$/ { vk = substr($0, 3, length($0) - 3); vn[vk] = vk; next }
    sec == "v" && /^    name: / { v = substr($0, 11); gsub(/"/, "", v); vn[vk] = v; next }
    sec == "s" && /^  [^ ][^ ]*:$/ { svc = substr($0, 3, length($0) - 3); invol = 0; next }
    sec == "s" && svc == s && /^    [^ ]/ { invol = ($0 == "    volumes:"); next }
    sec == "s" && svc == s && invol && /^      - type: / { n++; ty[n] = substr($0, 15); next }
    sec == "s" && svc == s && invol && /^        source: / { src[n] = substr($0, 17); next }
    sec == "s" && svc == s && invol && /^        target: / { tg[n] = substr($0, 17); next }
    END { for (i = 1; i <= n; i++) { x = src[i]; if (ty[i] == "volume" && (x in vn)) x = vn[x]; print tg[i], ty[i], x } }
  ' | sort || true
}

# The same for the running container $1.
running_mounts() {
  docker inspect -f '{{range .Mounts}}{{.Destination}} {{if eq .Type "volume"}}volume {{.Name}}{{else}}{{.Type}} {{.Source}}{{end}}{{println}}{{end}}' "$1" 2>/dev/null \
    | grep -v '^[[:space:]]*$' | sort || true
}

# Whether every service about to be recreated would get the folders and
# volumes it has now. A stack started with variables the updater cannot see
# (KINBOARD_*_DIR typed in a shell, not in .env) would otherwise be recreated
# on other data: on empty volumes, with new secrets.
updater_mounts_match() {
  # Container mode has no file to compare with: it copies each container's
  # mounts as they are (see "Container mode").
  [ "$STACK_MODE" != container ] || return 0
  for svc in $RECREATE; do
    cid="$(svc_container "$svc")"
    [ -n "$cid" ] || continue
    want="$(config_mounts "$svc")"
    have="$(running_mounts "$cid")"
    if [ "$want" != "$have" ]; then
      log "ERROR: $svc would be recreated with other folders or volumes than it has now (file: $(printf '%s' "$want" | tr '\n' ';'); running: $(printf '%s' "$have" | tr '\n' ';')). Was the stack started with variables that are not in its .env or the UI's variables? Nothing was changed; start it once with Up from your UI so the updater sees the same settings"
      return 1
    fi
  done
  return 0
}

# ---------------------------------------------------------------------------
# Container mode (RFC-023 §4.11.3, PR 14 of §9).
#
# Portainer's web editor keeps a stack's compose file and its variables inside
# Portainer's own volume (/data/compose/<id>/). The containers' Compose labels
# name that path, and the host has nothing there: the sibling of compose-file
# mode cannot even be started, and `docker compose` has no file to run. The
# same holds for a stack started from stdin (`docker compose -f -`) or whose
# file was deleted since. Then the updater recreates each Kinboard container
# from its own configuration, read from Docker, with only the image changed:
# Watchtower's method. A release changes nothing but the image (§2), so that
# is enough; what does need a new file raises KINBOARD_COMPOSE_REVISION,
# which holds the update here as in compose-file mode.
#
#   - Desired is what each container was created from (its .Config.Image),
#     running is its image id, remote is the registry's digest for that
#     reference: the same decisions as compose-file mode. A reference never
#     changes here (a new KINBOARD_TAG reaches the containers only through the
#     UI's own redeploy), so a pinned stack never moves.
#   - Only containers of the Kinboard image are ever recreated (init, db-init,
#     the webapp), checked once more right before each one: never the
#     database, PostgREST, go2rtc or the updater itself.
#   - Each one: its configuration through the Engine API (GET
#     /containers/{id}/json), the create request built from it by CM_CREATE_JQ
#     below, and the container created through the API (POST
#     /containers/create). The API, not `docker create`: the CLI's
#     --entrypoint takes one word, so init's `entrypoint: [/bin/sh, -c, …]`
#     would come back split between Entrypoint and Cmd, and a network alias,
#     a log option or a healthcheck field without a flag would be lost.
#   - The swap: the old container is renamed aside (<name>-before-update),
#     the new one created under the real name, then the old one stopped (its
#     restart policy set to "no" first, so a reboot cannot start both) and
#     the new one started. A refused create or start puts the old one back
#     under its name, policy and state at once. Kept until the update is
#     healthy; then removed with `docker rm`, never -v: the volumes it shares
#     with the new one stay.
#   - Order: init must exit 0 before db-init runs, db-init before the webapp.
#   - Rollback is the old containers themselves: the new ones are removed and
#     the originals renamed back and started, so the exact containers that
#     ran before (same id, same configuration, same image) run again.
#   - A journal (updater/swap, beside the state) records every swap before it
#     starts. A tick that finds one (the updater was killed, the host
#     rebooted) puts the originals back first, or, when the update had
#     already passed its health checks, removes them. Only containers the
#     update itself made are ever removed: when the stack was redeployed from
#     the UI in the meantime, that is left alone (see cm_restore).
#   - The tick runs in a sibling container, as in compose-file mode (without
#     the folders, which the host does not have), so that recreating the
#     updater itself (a Pull and redeploy in the UI) does not cut it short.
# ---------------------------------------------------------------------------

CM_SUFFIX=-before-update
CM_DIR="${UPDATER_DIR:-/kinboard/updater}/swap.d"
CM_JOURNAL="${UPDATER_DIR:-/kinboard/updater}/swap"

# The create request for a container, from its configuration as the Engine API
# reports it. jq, run as: jq -n --slurpfile c <container.json> --slurpfile i
# <image.json> --arg ref <reference> --arg composeimage <label value>. Prints
# {name, body, connect: [{network, body}]}: the container's name, the body of
# POST /containers/create, and one POST /networks/{network}/connect body for
# each network beyond the first (its "Container" filled in afterwards).
#
# Docker writes into a container's configuration what its image supplied:
# the image's ENV lines, LABELs, ENTRYPOINT and CMD, HEALTHCHECK, USER,
# WORKDIR, STOPSIGNAL, EXPOSE and VOLUME. Copied as they are, the new
# container would keep the old image's values for good (its version label,
# its PATH, its entrypoint). So whatever still equals the old image's value is
# left out, and the new image supplies its own. Everything else is the
# container's own configuration and is copied as it is: every other variable,
# label (the Compose labels too, so the UI still shows the container in its
# stack), mount, port, network with its aliases and fixed addresses, restart
# policy, healthcheck, user, command and entrypoint, log driver and options,
# and the rest of HostConfig. Derived from the old container and left for
# Docker to give anew: its id, its hostname when that is the id, an alias
# that is the old id, its addresses unless fixed, its MAC address.
#
# A volume Docker created without a name (an image's VOLUME, or `- /path` in a
# compose file) is mounted again by its name: created afresh it would be
# empty. (Only those: one that came with volumes_from comes again with it.) com.docker.compose.image says which image Compose created the
# container from; it gets the new image's (cm_compose_image), so a later
# redeploy from the UI does not take the container for out of date. Empty:
# left as it is.
# shellcheck disable=SC2016
CM_CREATE_JQ='
($c[0]) as $c | ($i[0].Config // {}) as $ic | ($c.Config // {}) as $cc |
($c.Id[0:12]) as $short |
($c.HostConfig.NetworkMode // "" | if . == "default" then "bridge" else . end) as $mode |
(if ($mode | test("^(host|none|container:.*)$")) then null else $mode end) as $primary |
([($c.HostConfig.Mounts // [])[].Target] + [($c.HostConfig.Binds // [])[] | split(":")[1]]) as $mounted |
def unless_image($v; $img): if $v == $img then null else $v end;
def endpoint: {
  IPAMConfig: .IPAMConfig,
  Links: .Links,
  Aliases: (if .Aliases == null then null else [.Aliases[] | select(. != $short)] end),
  DriverOpts: .DriverOpts
} + (if has("GwPriority") then {GwPriority: .GwPriority} else {} end);
def anon_name($target): first(($c.Mounts // [])[] | select(.Type == "volume" and .Destination == $target) | .Name) // "";
{
  name: ($c.Name | ltrimstr("/")),
  body: {
    Hostname: (if $cc.Hostname == $short or ($mode | startswith("container:")) then "" else $cc.Hostname end),
    Domainname: $cc.Domainname,
    User: (if ($cc.User // "") == ($ic.User // "") then "" else $cc.User end),
    AttachStdin: $cc.AttachStdin,
    AttachStdout: $cc.AttachStdout,
    AttachStderr: $cc.AttachStderr,
    Tty: $cc.Tty,
    OpenStdin: $cc.OpenStdin,
    StdinOnce: $cc.StdinOnce,
    ExposedPorts: (($cc.ExposedPorts // {}) | with_entries(.key as $k | select(
      ((($ic.ExposedPorts // {}) | has($k)) | not) or (($c.HostConfig.PortBindings // {}) | has($k))
    )) | if . == {} then null else . end),
    Env: [($cc.Env // [])[] | select(. as $e | any(($ic.Env // [])[]; . == $e) | not)],
    Entrypoint: unless_image($cc.Entrypoint; $ic.Entrypoint),
    Cmd: (if $cc.Entrypoint != $ic.Entrypoint then $cc.Cmd else unless_image($cc.Cmd; $ic.Cmd) end),
    Image: $ref,
    Volumes: (($cc.Volumes // {}) | with_entries(.key as $k | select(($ic.Volumes // {}) | has($k) | not)) | if . == {} then null else . end),
    WorkingDir: (if ($cc.WorkingDir // "") == ($ic.WorkingDir // "") then "" else $cc.WorkingDir end),
    Labels: (($cc.Labels // {})
      | with_entries(.key as $k | select(.value != (($ic.Labels // {})[$k])))
      | if has("com.docker.compose.image") and $composeimage != "" then .["com.docker.compose.image"] = $composeimage else . end),
    StopSignal: unless_image($cc.StopSignal; $ic.StopSignal),
    StopTimeout: $cc.StopTimeout,
    Healthcheck: unless_image($cc.Healthcheck; $ic.Healthcheck),
    Shell: unless_image($cc.Shell; $ic.Shell),
    NetworkDisabled: $cc.NetworkDisabled,
    HostConfig: ($c.HostConfig
      | if .Mounts == null then . else .Mounts |= map(
          if .Type == "volume" and ((.Source // "") == "") then .Source = anon_name(.Target) else . end
        ) end
      | ([($c.Mounts // [])[]
          | .Destination as $d
          | select(.Type == "volume" and (.Name // "") != "" and (($cc.Volumes // {}) | has($d))
              and ($mounted | index([$d]) | not))
          | {Type: "volume", Source: .Name, Target: .Destination, ReadOnly: (.RW | not)}]) as $anon
      | if $anon == [] then . else .Mounts = ((.Mounts // []) + $anon) end),
    NetworkingConfig: {EndpointsConfig: (($c.NetworkSettings.Networks // {})
      | with_entries(select($primary != null and (.key == $primary or .value.NetworkID == $primary)))
      | map_values(endpoint))}
  },
  connect: [($c.NetworkSettings.Networks // {}) | to_entries[]
    | select($primary != null and .key != $primary and .value.NetworkID != $primary)
    | {network: (.value.NetworkID // .key), name: .key, body: {Container: "", EndpointConfig: (.value | endpoint)}}]
}
'

# "<id> <service> <name>" for each container of the stack's project: a
# one-off (`docker compose run`), one without a service label and one an
# update set aside left out. $1: "running" for running ones only.
cm_list() {
  # The all-in-one container: the one container by its name.
  if [ -n "$AIO" ]; then
    aio_list "${1:-}"
    return 0
  fi
  all=-a
  [ -z "${1:-}" ] || all=""
  # shellcheck disable=SC2086
  docker ps $all --no-trunc --filter "label=com.docker.compose.project=$STACK_PROJECT" \
    --format '{{.ID}}|{{.Label "com.docker.compose.service"}}|{{.Names}}|{{.Label "com.docker.compose.oneoff"}}' 2>/dev/null \
    | awk -F'|' -v sfx="$CM_SUFFIX" '$2 != "" && $3 != "" && $4 != "True" && substr($3, length($3) - length(sfx) + 1) != sfx { print $1, $2, $3 }' \
    | sort -k2,2 -k3,3 || true
}

# The ids of service $1's containers; $2: "running" for running ones only.
cm_containers() {
  cm_list "${2:-}" | awk -v s="$1" '$2 == s { print $1 }'
}

# $1 method, $2 path, $3 a file holding the JSON body. Talks to the daemon the
# docker CLI talks to (DOCKER_HOST, else the socket). Prints the response;
# returns 1, with the reason in API_ERR, unless the answer is a 2xx.
API_ERR=""
docker_api() {
  API_ERR=""
  host="${DOCKER_HOST:-unix:///var/run/docker.sock}"
  if [ -n "${DOCKER_TLS_VERIFY:-}" ]; then
    API_ERR="DOCKER_TLS_VERIFY is set; container mode talks to the Docker socket or plain tcp only"
    return 1
  fi
  api_tmp="$CM_DIR/api.$$"
  set -- "$1" "$2" "${3:-}" -sS -m 120 -o "$api_tmp" -w '%{http_code}' -X "$1" -H 'Content-Type: application/json'
  case "$host" in
    unix://*) set -- "$@" --unix-socket "${host#unix://}" "http://localhost$2" ;;
    tcp://*) set -- "$@" "http://${host#tcp://}$2" ;;
    *) API_ERR="DOCKER_HOST=$host is neither unix:// nor tcp://"; return 1 ;;
  esac
  [ -z "$3" ] || set -- "$@" --data-binary "@$3"
  shift 3
  code="$(curl "$@" 2>"$api_tmp.err")" || code="000"
  if [ -f "$api_tmp" ]; then cat "$api_tmp"; fi
  case "$code" in
    2??) rm -f "$api_tmp" "$api_tmp.err"; return 0 ;;
  esac
  API_ERR="HTTP $code: $(cat "$api_tmp" "$api_tmp.err" 2>/dev/null | tr -d '\r' | tr '\n' ' ' | cut -c1-300)"
  rm -f "$api_tmp" "$api_tmp.err"
  return 1
}

# The journal: "phase <updating|done>", then one line per container swapped:
# "<service> <old id> <name> <was running: true|false> <restart policy>
# <image id it ran> <reference> <new id or -> <image id it gets> <since, UTC>".
# Only lines of exactly that shape are read: it lives in the config volume.
CM_LINE='^[A-Za-z0-9._-]+ [0-9a-f]{64} [A-Za-z0-9][A-Za-z0-9_.-]* (true|false) (no|always|unless-stopped|on-failure(:[0-9]+)?) sha256:[0-9a-f]{64} [^ ]+ ([0-9a-f]{64}|-) sha256:[0-9a-f]{64} [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'

# $1 service, $2 its line. Returns 1 unless the line is in the journal.
cm_journal_add() {
  { if [ -f "$CM_JOURNAL" ]; then cat "$CM_JOURNAL"; else echo "phase updating"; fi; echo "$2"; } > "$CM_JOURNAL.tmp" \
    && mv "$CM_JOURNAL.tmp" "$CM_JOURNAL" && [ "$(cm_journal_get "$1")" = "$2" ]
}
cm_journal_get() {
  grep -E "$CM_LINE" "$CM_JOURNAL" 2>/dev/null | awk -v s="$1" '$1 == s { print; exit }' || true
}
# $1 service, $2 the new container's id.
cm_journal_new() {
  awk -v s="$1" -v n="$2" '$1 == s && $1 != "phase" { $8 = n } { print }' "$CM_JOURNAL" > "$CM_JOURNAL.tmp" && mv "$CM_JOURNAL.tmp" "$CM_JOURNAL"
}
# Service $1 is done with: its line and its saved configuration go.
cm_forget() {
  if [ -f "$CM_JOURNAL" ]; then
    awk -v s="$1" '$1 != s' "$CM_JOURNAL" > "$CM_JOURNAL.tmp" && mv "$CM_JOURNAL.tmp" "$CM_JOURNAL"
    if ! grep -qv '^phase ' "$CM_JOURNAL" 2>/dev/null; then rm -f "$CM_JOURNAL"; fi
  fi
  case "$1" in *[!A-Za-z0-9._-]* | "") return 0 ;; esac
  rm -f "$CM_DIR/$1.json" "$CM_DIR/$1.image.json"
}
# The services in the journal, last swapped first.
cm_journal_services() {
  grep -E "$CM_LINE" "$CM_JOURNAL" 2>/dev/null | awk '{ l[NR] = $1 } END { for (i = NR; i >= 1; i--) print l[i] }' || true
}
# Whether the journal has a line of any shape besides the phase.
cm_journal_busy() {
  [ -f "$CM_JOURNAL" ] && grep -qv '^phase ' "$CM_JOURNAL" 2>/dev/null
}

# Whether container $1 belongs to service $2 of this stack (its Compose labels).
cm_is_ours() {
  if [ -n "$AIO" ]; then
    [ "$2" = "$AIO_SVC" ] && aio_is "$1"
    return $?
  fi
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' "$1" 2>/dev/null || true)" = "$STACK_PROJECT|$2" ]
}

# What com.docker.compose.image should say for image $2, when it said $1 for
# image $3: the image id where it was the id; where it was the digest of the
# platform's own manifest in the image (Compose 5.4 on the containerd image
# store), the new image's manifest for that same platform. Nothing when that
# cannot be told.
cm_compose_image() {
  [ -n "$1" ] || return 0
  if [ "$1" = "$3" ]; then
    printf '%s\n' "$2"
    return 0
  fi
  plat="$(docker_api GET "/images/$3/json?manifests=1" 2>/dev/null \
    | jq -c --arg d "$1" 'first(.Manifests[]? | select(.Descriptor.digest == $d) | .Descriptor.platform) // empty' 2>/dev/null || true)"
  [ -n "$plat" ] || return 0
  docker_api GET "/images/$2/json?manifests=1" 2>/dev/null \
    | jq -r --argjson p "$plat" 'first(.Manifests[]? | select(.Kind == "image" and .Available and .Descriptor.platform == $p) | .Descriptor.digest) // empty' 2>/dev/null || true
}

# Creates a container from saved configuration $1 (container) and $2 (its old
# image), from reference $3, which must name image id $4 now; $5: the value
# for com.docker.compose.image (empty: as saved). Sets CM_NEW, or returns 1
# with CM_ERR set and nothing left behind.
cm_create() {
  CM_NEW=""
  spec="$CM_DIR/create.json"
  if ! jq -n --slurpfile c "$1" --slurpfile i "$2" --arg ref "$3" --arg composeimage "${5:-}" "$CM_CREATE_JQ" > "$spec" 2>>"$LOG_FILE"; then
    CM_ERR="could not turn the container's configuration into a create request (jq)"
    rm -f "$spec"
    return 1
  fi
  name="$(jq -r .name "$spec")"
  jq -c .body "$spec" > "$spec.body"
  if ! resp="$(docker_api POST "/containers/create?name=$name" "$spec.body")"; then
    CM_ERR="Docker refused to create $name: $API_ERR"
    rm -f "$spec" "$spec.body"
    return 1
  fi
  rm -f "$spec.body"
  CM_NEW="$(printf '%s' "$resp" | jq -r '.Id // empty' 2>/dev/null || true)"
  if [ -z "$CM_NEW" ]; then
    CM_ERR="Docker created $name but gave no id"
    rm -f "$spec"
    return 1
  fi
  n=0
  count="$(jq '.connect | length' "$spec")"
  while [ "$n" -lt "$count" ]; do
    net="$(jq -r ".connect[$n].network" "$spec")"
    jq -c --arg id "$CM_NEW" ".connect[$n].body | .Container = \$id" "$spec" > "$spec.net"
    if ! docker_api POST "/networks/$net/connect" "$spec.net" >/dev/null; then
      CM_ERR="could not connect $name to the network $(jq -r ".connect[$n].name" "$spec"): $API_ERR"
      rm -f "$spec" "$spec.net"
      docker rm -f "$CM_NEW" >>"$LOG_FILE" 2>&1 || true
      CM_NEW=""
      return 1
    fi
    n=$((n + 1))
  done
  rm -f "$spec" "$spec.net"
  got="$(docker inspect -f '{{.Image}}' "$CM_NEW" 2>/dev/null || true)"
  if [ "$got" != "$4" ]; then
    CM_ERR="the new $name runs ${got:-an unknown image}, not $4 ($3 moved meanwhile?)"
    docker rm -f "$CM_NEW" >>"$LOG_FILE" 2>&1 || true
    CM_NEW=""
    return 1
  fi
  return 0
}

# Recreates service $1's container with image id $2 (what its reference names
# now), its configuration otherwise as it is. Returns 1 with CM_ERR set, the
# old container back as it was.
cm_swap() {
  svc="$1"
  want="$2"
  CM_ERR=""
  ids="$(cm_containers "$svc")"
  old="$(printf '%s\n' "$ids" | head -n1)"
  if [ -z "$old" ]; then CM_ERR="$svc has no container"; return 1; fi
  if [ "$(printf '%s\n' "$ids" | grep -c .)" -gt 1 ]; then CM_ERR="$svc has more than one container; container mode recreates one per service"; return 1; fi
  if ! ( umask 077; mkdir -p "$CM_DIR" ); then CM_ERR="cannot create $CM_DIR"; return 1; fi
  if ! docker_api GET "/containers/$old/json" > "$CM_DIR/$svc.json"; then CM_ERR="cannot read $svc's configuration: $API_ERR"; cm_forget "$svc"; return 1; fi
  ref="$(jq -r '.Config.Image // empty' "$CM_DIR/$svc.json")"
  old_img="$(jq -r '.Image // empty' "$CM_DIR/$svc.json")"
  # Never anything but the Kinboard image, whatever decided this.
  if [ -z "$ref" ] || [ "$(ref_repo "$ref")" != "$KB_REPO" ]; then
    CM_ERR="$svc runs ${ref:-no image reference}, not the Kinboard image ($KB_REPO); container mode recreates the Kinboard containers only"
    cm_forget "$svc"
    return 1
  fi
  # And beside the all-in-one image, only a container of that image: its
  # label, or the variable every all-in-one image sets.
  if [ -n "$AIO" ] && ! aio_is "$old"; then
    CM_ERR="$AIO_NAME is not the all-in-one image any more; nothing was changed"
    cm_forget "$svc"
    return 1
  fi
  if ! docker_api GET "/images/$old_img/json" > "$CM_DIR/$svc.image.json"; then CM_ERR="cannot read the image $svc runs ($old_img): $API_ERR"; cm_forget "$svc"; return 1; fi
  name="$(jq -r '.Name | ltrimstr("/")' "$CM_DIR/$svc.json")"
  was_running="$(jq -r '.State.Running' "$CM_DIR/$svc.json")"
  policy="$(jq -r '.HostConfig.RestartPolicy // {} | if .Name == "on-failure" and (.MaximumRetryCount // 0) > 0 then "on-failure:\(.MaximumRetryCount)" elif (.Name // "") == "" then "no" else .Name end' "$CM_DIR/$svc.json")"
  aside="$name$CM_SUFFIX"
  if docker inspect "$aside" >/dev/null 2>&1; then
    CM_ERR="a container named $aside is in the way; nothing was changed for $svc"
    cm_forget "$svc"
    return 1
  fi
  # Recorded first, and read back: without the line, nothing could put the
  # original back.
  if ! cm_journal_add "$svc" "$svc $old $name $was_running $policy $old_img $ref - $want $(date -u +%Y-%m-%dT%H:%M:%S)"; then
    CM_ERR="could not record the swap in $CM_JOURNAL (a full or read-only config volume?); nothing was changed for $svc"
    cm_forget "$svc"
    return 1
  fi
  if ! docker rename "$old" "$aside" >>"$LOG_FILE" 2>&1; then
    cm_forget "$svc"
    CM_ERR="could not rename $name aside"
    return 1
  fi
  label="$(jq -r '.Config.Labels["com.docker.compose.image"] // empty' "$CM_DIR/$svc.json")"
  if ! cm_create "$CM_DIR/$svc.json" "$CM_DIR/$svc.image.json" "$ref" "$want" "$(cm_compose_image "$label" "$want" "$old_img")"; then
    err="$CM_ERR"
    cm_restore "$svc"
    CM_ERR="$err"
    return 1
  fi
  # Not fatal: the restore also knows the new one by its name, age and image.
  cm_journal_new "$svc" "$CM_NEW" || log "WARN: could not record the new $name's id in $CM_JOURNAL"
  log "container mode: $svc: created $(printf '%.12s' "$CM_NEW") as $name from $ref ($want); $(printf '%.12s' "$old") set aside as $aside"
  if [ "$policy" != no ] && ! docker update --restart=no "$old" >>"$LOG_FILE" 2>&1; then
    cm_restore "$svc"
    CM_ERR="could not set the restart policy of $aside to no"
    return 1
  fi
  if [ "$was_running" = true ] && ! docker stop "$old" >>"$LOG_FILE" 2>&1; then
    cm_restore "$svc"
    CM_ERR="could not stop $aside"
    return 1
  fi
  if ! docker start "$CM_NEW" >>"$LOG_FILE" 2>&1; then
    cm_restore "$svc"
    CM_ERR="Docker could not start the new $name"
    return 1
  fi
  return 0
}

# Puts service $1's original container back, from the journal: the container
# this update made removed (never its volumes), the original renamed back,
# its restart policy given back, started when it ran. $2 = "retag": point the
# reference at the image the original runs first (after a cut-short tick; a
# rollback has done that already).
#
# Only what this update made is ever removed: the id the journal recorded,
# or, for a tick cut short before it recorded one, the container under the
# name that was created since the journal line, from the image the update
# wanted, with this service's labels. Anything else under the name, or an
# original that is gone, means the stack was changed outside the updater
# (a redeploy or a stop from the UI, perhaps in the middle of the update):
# then nothing is removed, renamed or created for that service, its journal
# line is dropped so that no later tick acts on it, and the log says so.
# Returns 1 unless the original runs (or, for a one-shot, exists) again.
cm_restore() {
  line="$(cm_journal_get "$1")"
  [ -n "$line" ] || return 0
  r_retag="${2:-}"
  # shellcheck disable=SC2086
  set -- $line
  r_svc="$1" r_old="$2" r_name="$3" r_running="$4" r_policy="$5" r_img="$6" r_ref="$7" r_new="$8" r_want="$9" r_since="${10}"
  holder="$(docker inspect -f '{{.Id}}' "$r_name" 2>/dev/null || true)"
  mine=""
  if [ "$r_new" != - ]; then
    if docker inspect "$r_new" >/dev/null 2>&1; then mine="$r_new"; fi
  elif [ -n "$holder" ] && [ "$holder" != "$r_old" ] && cm_is_ours "$holder" "$r_svc" \
       && [ "$(docker inspect -f '{{.Image}}' "$holder" 2>/dev/null || true)" = "$r_want" ] \
       && awk -v c="$(docker inspect -f '{{.Created}}' "$holder" 2>/dev/null | cut -c1-19)" -v s="$r_since" 'BEGIN { exit !(c >= s) }'; then
    mine="$holder"
  fi
  if ! docker inspect "$r_old" >/dev/null 2>&1; then
    log "ERROR: $r_svc: the original $r_name ($(printf '%.12s' "$r_old")) is gone; the stack was changed outside the updater (a redeploy or a stop from the UI?). Nothing more is done for it"
    cm_forget "$r_svc"
    return 1
  fi
  if [ -n "$holder" ] && [ "$holder" != "$r_old" ] && [ "$holder" != "$mine" ]; then
    log "ERROR: $r_svc: $r_name is now $(printf '%.12s' "$holder"), which this update did not make; the stack was redeployed outside the updater, and that is left as it is"
    # The original is then a leftover, set aside and stopped.
    if [ "$(docker inspect -f '{{.State.Running}}' "$r_old" 2>/dev/null || true)" != true ] && cm_is_ours "$r_old" "$r_svc" \
       && docker rm "$r_old" >>"$LOG_FILE" 2>&1; then
      log "container mode: $r_svc: removed the original ($(printf '%.12s' "$r_old")), which nothing uses now; its volumes stay"
    fi
    cm_forget "$r_svc"
    return 1
  fi
  r_ok=1
  if [ -n "$mine" ] && ! docker rm -f "$mine" >>"$LOG_FILE" 2>&1; then
    r_ok=""
    log "ERROR: could not remove the new $r_name ($(printf '%.12s' "$mine"))"
  fi
  if [ "$r_retag" = retag ] && [ "$(docker image inspect -f '{{.Id}}' "$r_ref" 2>/dev/null || true)" != "$r_img" ]; then
    docker tag "$r_img" "$r_ref" >>"$LOG_FILE" 2>&1 || log "WARN: could not point $r_ref back at $r_img"
  fi
  if [ -n "$r_ok" ]; then
    cur="$(docker inspect -f '{{.Name}}' "$r_old" 2>/dev/null || true)"
    if [ "${cur#/}" != "$r_name" ] && ! docker rename "$r_old" "$r_name" >>"$LOG_FILE" 2>&1; then
      r_ok=""
      log "ERROR: could not rename $(printf '%.12s' "$r_old") back to $r_name"
    fi
  fi
  if [ "$r_policy" != no ] && ! docker update --restart="$r_policy" "$r_old" >>"$LOG_FILE" 2>&1; then
    r_ok=""
    log "ERROR: could not give $r_name its restart policy ($r_policy) back"
  fi
  # After a tick that was cut short: the `docker stop` it had asked for may
  # still be under way in the daemon, which finishes it whatever became of
  # the tick, and would stop the original again right after it was started
  # here (seen on a real run: "the original is back", then the container
  # exited). So it is stopped here first, which waits for that stop, and
  # then started.
  if [ -n "$r_ok" ] && [ "$r_running" = true ] && [ "$r_retag" = retag ]; then
    docker stop "$r_old" >>"$LOG_FILE" 2>&1 || true
  fi
  if [ -n "$r_ok" ] && [ "$r_running" = true ] && [ "$(docker inspect -f '{{.State.Running}}' "$r_old" 2>/dev/null || true)" != true ] \
     && ! docker start "$r_old" >>"$LOG_FILE" 2>&1; then
    r_ok=""
    log "ERROR: could not start $r_name ($(printf '%.12s' "$r_old")) again"
  fi
  if [ -n "$r_ok" ]; then
    log "container mode: $r_svc: the original $r_name ($(printf '%.12s' "$r_old")) is back"
    cm_forget "$r_svc"
    return 0
  fi
  return 1
}

# Every swapped service back, last first. Returns 1 when one did not come back.
# $1: as for cm_restore.
cm_restore_all() {
  all_ok=0
  for s in $(cm_journal_services); do
    cm_restore "$s" "${1:-}" || all_ok=1
  done
  return "$all_ok"
}

# The update came up healthy: the originals go (`docker rm`, never -v).
# Returns 1 when one could not be removed (its line stays).
cm_finish() {
  [ -f "$CM_JOURNAL" ] || return 0
  { echo "phase done"; grep -v '^phase ' "$CM_JOURNAL"; } > "$CM_JOURNAL.tmp" && mv "$CM_JOURNAL.tmp" "$CM_JOURNAL"
  fin_ok=0
  for s in $(cm_journal_services); do
    # shellcheck disable=SC2046
    set -- $(cm_journal_get "$s")
    if docker inspect "$2" >/dev/null 2>&1 && cm_is_ours "$2" "$1"; then
      if [ "$(docker inspect -f '{{.State.Running}}' "$2" 2>/dev/null || true)" = true ]; then
        log "WARN: $3$CM_SUFFIX ($2) runs again (started by hand?); left as it is"
      elif docker rm "$2" >>"$LOG_FILE" 2>&1; then
        log "container mode: $1: removed the original ($(printf '%.12s' "$2")); its volumes stay"
      else
        log "WARN: could not remove $3$CM_SUFFIX ($2); remove it by hand once Kinboard runs well"
        fin_ok=1
        continue
      fi
    fi
    cm_forget "$1"
  done
  return "$fin_ok"
}

# Recreates services $1 (Kinboard containers), init first and alone, then
# db-init, then the rest; a one-shot must have exited 0 before the next
# starts. Returns 1 with UNHEALTHY set; what was swapped stays in the journal
# for the rollback.
cm_recreate() {
  UNHEALTHY=""
  # cm_preflight saw to an earlier journal; one left here is not this run's.
  if cm_journal_busy; then
    UNHEALTHY="an earlier update's journal ($CM_JOURNAL) is still there; nothing was recreated
"
    return 1
  fi
  order="$(for s in init db-init; do case " $1 " in *" $s "*) echo "$s" ;; esac; done
    for s in $1; do case "$s" in init | db-init) ;; *) echo "$s" ;; esac; done)"
  for svc in $order; do
    ref="$(field_for "$svc" "$CONFIG_IMAGES")"
    want="$(docker image inspect -f '{{.Id}}' "$ref" 2>/dev/null || true)"
    if [ -z "$want" ]; then
      UNHEALTHY="$svc: $ref is not on this host
"
      return 1
    fi
    log "container mode: recreating $svc with $want, its configuration otherwise as it is"
    if ! cm_swap "$svc" "$want"; then
      UNHEALTHY="$svc: $CM_ERR
"
      return 1
    fi
    # A one-shot (it was not running, and nothing restarts it) has to finish.
    line="$(cm_journal_get "$svc")"
    if [ "$(printf '%s' "$line" | cut -d' ' -f4)" != true ] && [ "$(printf '%s' "$line" | cut -d' ' -f5)" = no ]; then
      wait_completed "$svc" || return 1
    fi
  done
  return 0
}

# Before a tick in container mode: what it needs, and what an earlier tick
# that was cut short left. Exits when that tick must not go on.
cm_preflight() {
  # What it writes (a container's configuration holds its variables, secrets
  # among them) is for root only.
  umask 077
  for tool in jq curl; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      log "ERROR: container mode needs $tool, which this image lacks; nothing was changed"
      log "=== tick skipped ==="
      exit 1
    fi
  done
  if ! mkdir -p "$CM_DIR" 2>/dev/null; then
    log "ERROR: container mode cannot write $CM_DIR; nothing was changed"
    log "=== tick skipped ==="
    exit 1
  fi
  if ! docker_api GET /_ping >/dev/null; then
    log "ERROR: container mode cannot reach the Docker API ($API_ERR); nothing was changed"
    log "=== tick skipped ==="
    exit 1
  fi
  cm_journal_busy || { rm -f "$CM_JOURNAL"; return 0; }
  if grep -q '^phase done' "$CM_JOURNAL"; then
    log "container mode: the last update came up healthy but was cut short before it removed the containers it replaced; removing them now"
    cm_finish || true
  else
    log "container mode: an update was cut short while it recreated containers ($(cm_journal_services | tr '\n' ' ')); putting the originals back"
    if [ -n "$AIO" ] && aio_preflight_keep && ! cm_journal_busy; then
      log "=== tick: the container the interrupted update made runs on; the next tick looks again ==="
      exit 0
    fi
    if cm_restore_all retag && ! cm_journal_busy; then
      log "=== tick: the containers from before the interrupted update run again; the next tick looks again ==="
      exit 0
    fi
  fi
  if cm_journal_busy; then
    log "ERROR: container mode: $CM_JOURNAL still lists containers it could not deal with ($(cut -d' ' -f1-3 "$CM_JOURNAL" | grep -v '^phase' | tr '\n' ';')); nothing more is changed until that is resolved: put back or remove what it names by hand, then delete the file"
    log "=== tick skipped ==="
    exit 1
  fi
  log "=== tick: what the interrupted update left is dealt with; the next tick looks again ==="
  exit 0
}

# ---------------------------------------------------------------------------
# The all-in-one image (RFC-024 §4.2-4.7).
#
# kinboard-aio is one container with everything in /data: the webapp,
# PostgreSQL, PostgREST and the scheduler. It never replaces itself (§4.7), so
# until this the household replaced it: Unraid's Apply Update, Compose's pull
# and up, a new `docker run`. kinboard-updater now does it the way container
# mode does for a Portainer stack, with the one difference that there is no
# stack: one container, found on its own.
#
#   - Which container: KINBOARD_AIO_CONTAINER names it. Without that, the one
#     container on this Docker that runs the all-in-one image: the label
#     app.kinboard.aio=1 the image carries, or, on an image published before
#     that label, the KINBOARD_AIO=1 every all-in-one image sets. Two of them
#     and no name is a refusal: which one this updater looks after is the
#     household's to say. An updater inside a Kinboard compose stack (a
#     project with a webapp service) updates that stack as before, unless
#     KINBOARD_AIO_CONTAINER says otherwise.
#   - Then everything is container mode (see there), for one service called
#     `aio`: the tick in a sibling container, the registry asked about the
#     tag the container was created from (`next`, `main`; a version or a
#     sha-... never moves), the swap with its journal, the health wait and
#     the smoke check, the originals back on a failure, the release held.
#     Only that one container is ever touched: cm_swap checks once more that
#     it runs the all-in-one image.
#   - The journal must outlive the updater's container, or an update cut
#     short could not be put back: the updater refuses to act unless its
#     folder (/kinboard/updater) is on a volume or folder of its own.
#   - The backup: the image's own verified dump (kinboard-backup.sh, the one
#     it takes before a migration and before a PostgreSQL upgrade), run in
#     the container as its PUID:PGID into /data/backups as
#     pre-update-<time>.sql.gz, five kept. No verified dump, no update. The
#     uploaded files and the keys are not copied: an update does not change
#     them, they stay in /data, and the original container that a rollback
#     puts back mounts that same folder. Copying every photo into
#     /data/backups at every release would grow the folder by the size of
#     the photos each time.
#   - A rollback puts the original container back on the same /data. A
#     migration the new version ran stays: migrations are additive (#542's
#     check), and the older version runs on the newer schema.
#   - A PostgreSQL major upgrade is the image's own (§4.3): at its first start
#     the new image dumps, builds /data/db.new with pg_upgrade and switches,
#     keeping /data/db.old. The updater waits for that up to
#     KINBOARD_PG_UPGRADE_TIMEOUT (an hour) instead of the usual ten minutes.
#     On a failure the original container goes back and puts the previous
#     database back itself, as long as the new version never ran healthy for
#     a minute. Once it has, that upgrade is final, the previous image would
#     refuse the database, and going back would leave Kinboard stopped: then
#     the new version is started again and kept, and Settings says the
#     rollback did not happen (see aio_pg_confirmed). The same when its
#     record cannot be read, and after a tick cut short in the hour an
#     upgrade may take (aio_preflight_keep).
#   - Found without KINBOARD_AIO_CONTAINER, the container is whichever one
#     carries the label: anyone who can start a container here can start one
#     with it, and then the updater refuses to choose. That person already
#     holds the socket's power; the templates and the wiki's lines name the
#     container all the same.
#   - Unraid's Docker page remembers the digest it pulled itself, in
#     /var/lib/docker/unraid-update-status.json, and would show "update ready"
#     for good after an update it did not make. After a healthy update the
#     updater records the new digest there, as Unraid's own Apply Update does
#     (see aio_unraid_status).
# ---------------------------------------------------------------------------

AIO_ERR=""
AIO_PG_FROM=""
AIO_PG_TO=""

# Whether container $1 runs the all-in-one image.
aio_is() {
  ai_out="$(docker container inspect -f '{{index .Config.Labels "app.kinboard.aio"}}{{range .Config.Env}}{{println}}{{.}}{{end}}' "$1" 2>/dev/null || true)"
  [ -n "$ai_out" ] || return 1
  [ "$(printf '%s\n' "$ai_out" | head -n1)" != 1 ] || return 0
  printf '%s\n' "$ai_out" | tail -n +2 | grep -qx 'KINBOARD_AIO=1'
}

# "<id> aio <name>" for the all-in-one container ($1 = running: only when it
# runs), as cm_list prints a stack's.
aio_list() {
  al="$(docker container inspect -f '{{.Id}}|{{.Name}}|{{.State.Running}}' "$AIO_NAME" 2>/dev/null | head -n1 || true)"
  IFS='|' read -r al_id al_name al_run <<ALEOF
$al
ALEOF
  [ -n "$al_id" ] || return 0
  if [ "${1:-}" = running ] && [ "$al_run" != true ]; then return 0; fi
  echo "$al_id $AIO_SVC ${al_name#/}"
}

# Sets AIO_NAME to the all-in-one container this updater looks after, or
# returns 1: with AIO_ERR set when that is a refusal, empty when there is none.
aio_find() {
  AIO_NAME=""
  if [ -n "${KINBOARD_AIO_CONTAINER:-}" ]; then
    an="$KINBOARD_AIO_CONTAINER"
    case "$an" in
      [!A-Za-z0-9]* | *[!A-Za-z0-9_.-]*)
        AIO_ERR="KINBOARD_AIO_CONTAINER=$an is not a container name"
        return 1 ;;
    esac
    # An update cut short between the rename and the create leaves only the
    # original, set aside: its journal still has to be read.
    for ac in "$an" "$an$CM_SUFFIX"; do
      docker container inspect "$ac" >/dev/null 2>&1 || continue
      if aio_is "$ac"; then
        AIO_NAME="$an"
        return 0
      fi
      AIO_ERR="KINBOARD_AIO_CONTAINER names $ac, which does not run the all-in-one image (no app.kinboard.aio label, no KINBOARD_AIO=1)"
      return 1
    done
    AIO_ERR="KINBOARD_AIO_CONTAINER names $an, and there is no container of that name on this Docker"
    return 1
  fi
  ids="$(docker ps -aq --no-trunc 2>/dev/null || true)"
  [ -n "$ids" ] || return 1
  # One inspect for all; one that went in the meantime is left out by Docker.
  # An original set aside by a swap counts under its real name.
  # shellcheck disable=SC2086
  names="$(docker container inspect -f '{{.Name}}|{{index .Config.Labels "app.kinboard.aio"}}|{{range .Config.Env}}{{if eq . "KINBOARD_AIO=1"}}env{{end}}{{end}}' $ids 2>/dev/null \
    | awk -F'|' -v sfx="$CM_SUFFIX" '
        $2 == "1" || $3 == "env" {
          n = substr($1, 2)
          if (length(n) > length(sfx) && substr(n, length(n) - length(sfx) + 1) == sfx) n = substr(n, 1, length(n) - length(sfx))
          if (n != "" && !seen[n]++) print n
        }' || true)"
  count="$(printf '%s\n' "$names" | grep -c . || true)"
  [ "${count:-0}" -gt 0 ] || return 1
  if [ "$count" -gt 1 ]; then
    AIO_ERR="this Docker runs $count all-in-one Kinboard containers ($(printf '%s' "$names" | tr '\n' ' ')); set KINBOARD_AIO_CONTAINER on the updater to the one it updates (one updater for each)"
    return 1
  fi
  AIO_NAME="$names"
  return 0
}

# Whether the updater in container $1 looks after an all-in-one container
# (see above). Returns 1 with AIO_ERR set on a refusal.
aio_applies() {
  AIO_ERR=""
  [ -n "$UPDATER" ] || return 1
  if [ -z "${KINBOARD_AIO_CONTAINER:-}" ]; then
    ap="$(stack_labels "$1" | cut -d'|' -f1)"
    if [ -n "$ap" ] && [ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$ap" --filter label=com.docker.compose.service=webapp 2>/dev/null || true)" ]; then
      return 1
    fi
  fi
  aio_find
}

# Whether $UPDATER_DIR is on a volume or folder container $1 mounts.
aio_dir_kept() {
  docker inspect -f '{{range .Mounts}}{{println .Destination}}{{end}}' "$1" 2>/dev/null \
    | awk -v p="${UPDATER_DIR%/}" 'NF { d = $0; sub(/\/$/, "", d); if (d == "" || p == d || index(p, d "/") == 1) f = 1 } END { exit !f }'
}

# The stack is the one all-in-one container (see above).
aio_resolve() {
  ar_self="$(updater_self)"
  if ! aio_dir_kept "$ar_self"; then
    log "ERROR: the updater keeps the journal of an update in progress in $UPDATER_DIR, which is not on a volume or folder of its container: a recreated updater would lose it, and with it the way back from an update cut short. Give it one at $(dirname "$UPDATER_DIR") (docker run ... -v kinboard-updater:$(dirname "$UPDATER_DIR")). Nothing was changed"
    return 1
  fi
  STACK_MODE=container
  AIO=1
  KB_SVC="$AIO_SVC"
  STACK_PROJECT=""
  STACK_ENV_FILE=/dev/null
  unset COMPOSE_FILES
  COMPOSE_FILES=""
  unset TZ
  STACK_NOTE="all-in-one: $AIO_NAME runs the all-in-one image; it is recreated from its own configuration, with only the image changed"
  return 0
}

# The value of variable $2 in image $1's own configuration, or nothing.
image_env() {
  docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null \
    | awk -v k="$2" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' || true
}

# The backup before an all-in-one update (see above). Sets BACKUP_FILE,
# BACKUP_DIR and BACKUP_AT as take_backup does, or returns 1.
aio_backup() {
  ab_cid="$(svc_container "$AIO_SVC" running)"
  if [ -z "$ab_cid" ]; then
    log "ERROR: $AIO_NAME is not running — refusing to update without a backup"
    return 1
  fi
  ab_uid="$(config_env "$AIO_SVC" PUID)"
  ab_gid="$(config_env "$AIO_SVC" PGID)"
  case "${ab_uid:-1000}:${ab_gid:-1000}" in
    *[!0-9:]* | 0:* | *:0)
      log "ERROR: $AIO_NAME has PUID=$ab_uid PGID=$ab_gid, which the image refuses; refusing to update"
      return 1 ;;
  esac
  # As the data's owner, over the server's own socket (where supabase_admin is
  # trusted): the dump lands owned as everything else in /data, and the
  # image's checks decide whether it is a backup.
  # shellcheck disable=SC2016
  # At least one kept: kinboard-backup.sh prunes after it writes, and 0 would
  # remove the dump it has just verified.
  ab_keep="$BACKUP_KEEP"
  case "$ab_keep" in "" | *[!0-9]* | 0) ab_keep=5 ;; esac
  if ! ab_out="$(docker exec -u "${ab_uid:-1000}:${ab_gid:-1000}" -e PGHOST=/run/postgresql -e PGUSER=supabase_admin -e PGDATABASE=postgres -e "BACKUP_KEEP=$ab_keep" "$ab_cid" \
       sh -c 'exec sh /app/kinboard-backup.sh "${KINBOARD_MIGRATE_BACKUP_DIR:-/data/backups}" pre-update' 2>>"$LOG_FILE")"; then
    log "ERROR: the verified dump in $AIO_NAME failed (its reason is the [backup] line above in $LOG_FILE) — refusing to update"
    return 1
  fi
  ab_file="$(printf '%s\n' "$ab_out" | tail -n1)"
  case "$ab_file" in
    /*/pre-update-*.sql.gz) ;;
    *)
      log "ERROR: the dump in $AIO_NAME was not confirmed (it printed '$(printf '%.200s' "$ab_file")') — refusing to update"
      return 1 ;;
  esac
  if ! docker exec -u "${ab_uid:-1000}:${ab_gid:-1000}" "$ab_cid" test -s "$ab_file" >>"$LOG_FILE" 2>&1; then
    log "ERROR: the dump $ab_file is not there after it was verified — refusing to update"
    return 1
  fi
  ab_dir="${ab_file%/*}"
  ab_src="$(container_mount "$ab_cid" /data)"
  case "$ab_src|$ab_dir" in
    /*\|/data/*) BACKUP_DIR="${ab_src%/}${ab_dir#/data}" ;;
    /*\|/data) BACKUP_DIR="${ab_src%/}" ;;
    ?*\|/data/*) BACKUP_DIR="$ab_dir in the Docker volume $ab_src" ;;
    *) BACKUP_DIR="$ab_dir in $AIO_NAME" ;;
  esac
  BACKUP_FILE="${ab_file##*/}"
  BACKUP_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "backup: $BACKUP_FILE in $BACKUP_DIR (the all-in-one image's verified dump of the whole database; the last $ab_keep kept). The uploaded files and the keys stay in /data, which the update does not change"
  return 0
}

# Before an all-in-one container is recreated: whether the new image runs
# another PostgreSQL major than the running one. Then the wait is long enough
# for the image's own upgrade, and roll_back knows to look (aio_pg_confirmed).
aio_pg_plan() {
  AIO_PG_FROM="$(image_env "$(field_for "$AIO_SVC" "$PREVIOUS")" PG_MAJOR)"
  AIO_PG_TO="$(image_env "$(docker image inspect -f '{{.Id}}' "$(field_for "$AIO_SVC" "$CONFIG_IMAGES")" 2>/dev/null || true)" PG_MAJOR)"
  if [ -z "$AIO_PG_FROM" ] || [ -z "$AIO_PG_TO" ] || [ "$AIO_PG_FROM" = "$AIO_PG_TO" ]; then
    AIO_PG_TO=""
    return 0
  fi
  ap_limit="${KINBOARD_PG_UPGRADE_TIMEOUT:-3600}"
  case "$ap_limit" in "" | *[!0-9]*) ap_limit=3600 ;; esac
  [ "$HEALTH_TIMEOUT" -ge "$ap_limit" ] || HEALTH_TIMEOUT="$ap_limit"
  log "the new image runs PostgreSQL $AIO_PG_TO, $AIO_NAME runs $AIO_PG_FROM: the container upgrades the database itself at its first start (a verified dump first, the previous database kept as /data/db.old); waiting up to ${HEALTH_TIMEOUT}s for it"
}

# Whether the PostgreSQL major upgrade that container $1 made has become
# final (the new version ran healthy for a minute: its record says
# confirmed_at), so that the image that ran before would refuse the database.
# $2: an image to read the record with (the previous one: on disk, with a
# shell), $3: the major upgraded to. 0 final, 1 not (no upgrade, a failed one,
# an unconfirmed one), 2 cannot tell.
aio_pg_final() {
  pf_src="$(container_mount "$1" /data)"
  [ -n "$pf_src" ] || return 2
  # Read-only; "phase=none" when there is no record, so that nothing at all
  # means the read failed.
  # shellcheck disable=SC2016
  pf_rec="$(docker run --rm --network none --user 0:0 --entrypoint sh -v "$pf_src:/data:ro" "$2" \
    -c 'f=/data/config/updater/pg-upgrade; if [ -f "$f" ]; then cat "$f"; else echo phase=none; fi' 2>/dev/null || true)"
  [ -n "$pf_rec" ] || return 2
  [ "$(printf '%s\n' "$pf_rec" | sed -n 's/^phase=//p' | head -n1)" = switched ] || return 1
  [ "$(printf '%s\n' "$pf_rec" | sed -n 's/^to=//p' | head -n1)" = "$3" ] || return 1
  [ -n "$(printf '%s\n' "$pf_rec" | sed -n 's/^confirmed_at=//p' | head -n1)" ] || return 1
  return 0
}

# After a failed all-in-one update across a PostgreSQL major: whether the new
# container must stay (aio_keep_new) instead of the original going back. Only
# for the container this update made, as the journal records it: when the
# swap itself failed, the original already runs again and is left alone. That
# container is stopped first, so that its first healthy minute cannot come
# while the record is read; it stays stopped when the original goes back.
# Sets AIO_KEEP_WHY. The upgrade being final, or a record that cannot be read,
# keeps it: the image that made the database runs on it whatever its record
# says, the previous one only when the upgrade was not final.
AIO_KEEP_WHY=""
aio_pg_confirmed() {
  [ -n "$AIO" ] && [ -n "$AIO_PG_TO" ] || return 1
  pc_line="$(cm_journal_get "$AIO_SVC")"
  pc_new="$(printf '%s' "$pc_line" | cut -d' ' -f8)"
  pc_prev="$(field_for "$AIO_SVC" "$PREVIOUS")"
  [ -n "$pc_line" ] && [ -n "$pc_new" ] && [ "$pc_new" != - ] && [ -n "$pc_prev" ] || return 1
  [ "$(svc_container "$AIO_SVC")" = "$pc_new" ] || return 1
  docker stop -t 60 "$pc_new" >>"$LOG_FILE" 2>&1 || true
  pc_rc=0
  aio_pg_final "$pc_new" "$pc_prev" "$AIO_PG_TO" || pc_rc=$?
  case "$pc_rc" in
    0) AIO_KEEP_WHY="the new version ran healthy for a minute before its check failed, so that upgrade is final: the image that ran before refuses a newer database that has been written to" ;;
    2) AIO_KEEP_WHY="its upgrade record could not be read, so going back might meet a database the image that ran before refuses" ;;
    *) return 1 ;;
  esac
  return 0
}

# The failed update's container stays (aio_pg_confirmed): started again, the
# reference pointed at its image, the original removed. Sets OUTCOME.
aio_keep_new() {
  kn_new="$(svc_container "$AIO_SVC")"
  kn_ref="$(field_for "$AIO_SVC" "$CONFIG_IMAGES")"
  kn_img="$(docker inspect -f '{{.Image}}' "$kn_new" 2>/dev/null || true)"
  log "ERROR: NOT ROLLED BACK: the database in $AIO_NAME was upgraded to PostgreSQL $AIO_PG_TO, and $AIO_KEEP_WHY; going back would leave Kinboard stopped. The new version is started again and kept. The dump from before the upgrade is /data/backups/pre-pg$AIO_PG_TO-upgrade-*.sql.gz; the one from before this update is $BACKUP_DIR/$BACKUP_FILE"
  if [ -n "$kn_img" ] && [ -n "$kn_ref" ]; then
    docker tag "$kn_img" "$kn_ref" >>"$LOG_FILE" 2>&1 || log "WARN: could not point $kn_ref back at $kn_img"
  fi
  if ! docker start "$kn_new" >>"$LOG_FILE" 2>&1; then
    log "ERROR: could not start $AIO_NAME ($(printf '%.12s' "$kn_new")) again"
  fi
  cm_finish || true
  OUTCOME=rollback_failed
}

# Before cm_preflight puts the original back after a tick that was cut short:
# the same question as aio_pg_confirmed, from the journal alone (the tick
# that knew the plan is gone). The updater can be stopped or recreated in the
# hour an upgrade may take. Returns 0 when the new container was kept.
aio_preflight_keep() {
  pk_line="$(cm_journal_get "$AIO_SVC")"
  [ -n "$pk_line" ] || return 1
  # shellcheck disable=SC2086
  set -- $pk_line
  pk_name="$3" pk_img="$6" pk_new="$8" pk_want="$9"
  pk_from="$(image_env "$pk_img" PG_MAJOR)"
  pk_to="$(image_env "$pk_want" PG_MAJOR)"
  [ -n "$pk_from" ] && [ -n "$pk_to" ] && [ "$pk_from" != "$pk_to" ] || return 1
  [ "$pk_new" != - ] && [ "$(docker inspect -f '{{.Id}}' "$pk_name" 2>/dev/null || true)" = "$pk_new" ] || return 1
  docker stop -t 60 "$pk_new" >>"$LOG_FILE" 2>&1 || true
  pk_rc=0
  aio_pg_final "$pk_new" "$pk_img" "$pk_to" || pk_rc=$?
  [ "$pk_rc" != 1 ] || return 1
  log "ERROR: the update that was cut short had upgraded $AIO_NAME's database to PostgreSQL $pk_to$([ "$pk_rc" = 0 ] && echo ", and that version ran healthy for a minute: the upgrade is final" || echo ", and its record cannot be read"); the image that ran before would refuse it, so the new container is kept and started, not the original"
  docker start "$pk_new" >>"$LOG_FILE" 2>&1 || log "ERROR: could not start $AIO_NAME ($(printf '%.12s' "$pk_new"))"
  cm_finish || true
  return 0
}

# After a healthy update of a container Unraid's Docker page manages (its
# label net.unraid.docker.managed=dockerman): the digest it now runs, recorded
# in Unraid's update status the way Unraid's own Apply Update records it
# (DockerUpdate::setUpdateStatus: local = remote = that digest). Unraid reads
# `local` from there and only looks at the image when it has nothing, so
# without this its Docker page would show "update ready" until someone
# pressed Apply Update, which would then recreate the container once more.
#
# Through a short-lived container of the updater's own image (jq): the file is
# the host's. `--mount`, never `-v`: a file that is not there is refused, not
# created as a folder in Unraid's place. Only that one entry is written,
# only into a file that holds a JSON object; anything else is left as it is.
aio_unraid_status() {
  us_cid="$(svc_container "$AIO_SVC")"
  [ "$(docker inspect -f '{{index .Config.Labels "net.unraid.docker.managed"}}' "$us_cid" 2>/dev/null || true)" = dockerman ] || return 0
  us_ref="$(docker inspect -f '{{.Config.Image}}' "$us_cid" 2>/dev/null || true)"
  us_img="$(docker inspect -f '{{.Image}}' "$us_cid" 2>/dev/null || true)"
  us_digest="$(image_digest "$us_img" "$(ref_repo "$us_ref")")"
  case "$us_digest" in sha256:*) ;; *) log "WARN: no registry digest for $us_ref; Unraid's Docker page may show \"update ready\" until its Apply Update"; return 0 ;; esac
  # Unraid's key: the reference with its tag (DockerUtil::ensureImageTag).
  us_key="$us_ref"
  case "${us_ref##*/}" in *:*) ;; *) us_key="$us_ref:latest" ;; esac
  us_file="${KINBOARD_UNRAID_STATUS_FILE:-/var/lib/docker/unraid-update-status.json}"
  us_self="$(docker inspect -f '{{.Image}}' "$(updater_self)" 2>/dev/null || true)"
  [ -n "$us_self" ] || return 0
  # shellcheck disable=SC2016
  if docker run --rm --network none --label app.kinboard.unraid-status=1 --entrypoint sh \
       --mount "type=bind,source=$us_file,target=/status.json" -e "K=$us_key" -e "D=$us_digest" "$us_self" \
       -c '[ -f /status.json ] && jq -e "type == \"object\"" /status.json >/dev/null && jq --arg k "$K" --arg d "$D" ".[\$k] = {local: \$d, remote: \$d, status: \"true\"}" /status.json > /tmp/s && [ -s /tmp/s ] && cat /tmp/s > /status.json' \
       >>"$LOG_FILE" 2>&1; then
    log "Unraid: recorded $us_key as $us_digest in $us_file, so its Docker page shows the update as applied"
  else
    log "WARN: could not record the update in Unraid's $us_file; its Docker page may show \"update ready\" until its Apply Update, which then only recreates the container on the same image"
  fi
}

# ---------------------------------------------------------------------------
# The webhook's own image.
#
# The Diun overlay's webhook runs the published kinboard-webhook image, under
# the webapp's tag (docker-compose.diun.yml). Until it was published, every
# git install built the image on its own machine as kinboard-webhook:local,
# and a Docker that could not build (#539: dockerd crashed in the build's
# network hook) had no automatic updates at all.
#
# Which version of that image runs hardly matters: the hook and the tick run
# the checkout's script, which `git pull` keeps current. But it should follow
# what the compose files name: the switch away from kinboard-webhook:local on
# an existing install, a KINBOARD_TAG changed to another channel or pin, a
# newer image under the same tag. No run can recreate the webhook itself: the
# run executes inside it, and Compose would stop it halfway (NEVER_RECREATE).
# So a short-lived container started from the new image does it: it waits for
# this run's lock, so it acts only once this run has ended, then runs
# `up -d --no-deps --force-recreate webhook`. If the new webhook is not
# running, unrestarted, KINBOARD_WEBHOOK_SETTLE seconds (30) later, it tags
# the image the webhook ran before back under the reference and recreates it
# once more, so a broken image never ends the automatic updates.
#
# An update pulls the webhook's image on its own, after the others: a pull
# that fails (no such tag: a KINBOARD_TAG pinned to a version older than the
# published image) costs the webhook its refresh, never the release. A tick
# pulls it only when the reference changed, as for every other service.
# ---------------------------------------------------------------------------

# Run by that container (the new kinboard-webhook image: busybox flock has no
# -w, hence timeout). KB_* come from webhook_refresh below.
WEBHOOK_REFRESH_SH='
set -u
log() { printf "[%s] %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "webhook refresh: $*" >> "$KB_LOG" 2>/dev/null || true; }
exec 9>>"$KB_LOCK"
if ! timeout "$KB_WAIT" flock 9; then
  log "the update run still held its lock after ${KB_WAIT}s; the webhook was not recreated (the next run tries again)"
  exit 1
fi
# shellcheck disable=SC2086
up() { docker compose $KB_ARGS up -d --no-deps --no-build --pull never --force-recreate webhook >> "$KB_LOG" 2>&1; }
settled() {
  sleep "$KB_SETTLE"
  # shellcheck disable=SC2086
  cid="$(docker compose $KB_ARGS ps -q webhook 2>/dev/null | head -n1)"
  [ -n "$cid" ] && [ "$(docker inspect -f "{{.State.Status}}|{{.RestartCount}}|{{.Image}}" "$cid" 2>/dev/null)" = "running|0|$KB_WANT_ID" ]
}
log "recreating the webhook on $KB_WANT ($KB_WANT_ID); it ran $KB_FROM"
if up && settled; then
  log "done: the webhook runs $KB_WANT"
  exit 0
fi
log "ERROR: the webhook on $KB_WANT did not stay up; going back to the image it ran before ($KB_OLD_ID)"
if docker tag "$KB_OLD_ID" "$KB_WANT" >> "$KB_LOG" 2>&1 && up; then
  log "the webhook runs its previous image again (tagged $KB_WANT until the next pull)"
else
  log "ERROR: the webhook did not start again; automatic updates are off until: docker compose up -d webhook (or ./start.sh up)"
fi
exit 1
'

# $1: "pull" (an update: pull the webhook's image first) or "tick" (pull it
# only when its reference changed). Starts the container that recreates the
# webhook after this run when the webhook runs another image than the compose
# files name; never fails the run. Git installs on the Diun overlay only: the
# updater has no webhook, container mode no compose files.
webhook_refresh() {
  [ -z "$UPDATER" ] && [ "$STACK_MODE" != container ] || return 0
  stack_services | grep -qx webhook || return 0
  wh_cid="$(svc_container webhook running)"
  [ -n "$wh_cid" ] || return 0
  wh_ref="$(docker inspect -f '{{.Config.Image}}' "$wh_cid" 2>/dev/null || true)"
  wh_old="$(docker inspect -f '{{.Image}}' "$wh_cid" 2>/dev/null || true)"
  wh_want="$(field_for webhook "$(config_images)")"
  [ -n "$wh_ref" ] && [ -n "$wh_old" ] && [ -n "$wh_want" ] || return 0
  if [ "$1" = pull ] || [ "$wh_ref" != "$wh_want" ]; then
    # --ignore-buildable: a webhook built here (docker-compose.webhook-build.yml)
    # is never pulled, and never built by this script either.
    # shellcheck disable=SC2086
    if ! docker compose $COMPOSE_FILES pull --ignore-buildable webhook >>"$LOG_FILE" 2>&1; then
      log "WARN: could not pull the webhook's image $wh_want; the webhook stays on $wh_ref. (A KINBOARD_TAG pinned to a version older than the published kinboard-webhook has none: set KINBOARD_WEBHOOK_TAG=latest in .env.)"
      return 0
    fi
  fi
  wh_new="$(docker image inspect -f '{{.Id}}' "$wh_want" 2>/dev/null || true)"
  if [ -z "$wh_new" ]; then
    [ "$wh_ref" = "$wh_want" ] || log "the webhook runs $wh_ref; the compose files name $wh_want, which is not on this machine (a webhook built here is built by ./start.sh up, never by this script)"
    return 0
  fi
  [ "$wh_ref" != "$wh_want" ] || [ "$wh_old" != "$wh_new" ] || return 0
  # The lock the container waits for must be inside the project mount it shares.
  case "$GIT_DIR_ABS/" in
    "${PROJECT_DIR%/}/"*) ;;
    *) log "the webhook runs $wh_ref, the compose files name $wh_want; its lock ($GIT_DIR_ABS) is outside $PROJECT_DIR, so it is left for ./start.sh up to recreate"; return 0 ;;
  esac
  wh_project="$(stack_labels "$wh_cid" | cut -d'|' -f1)"
  wh_name="${wh_project:-kinboard}-webhook-refresh"
  # Its mounts are the webhook's own (the project at the same path, the socket,
  # the log folder); the interpolated values the webhook was created with are
  # passed on as they were, an empty one not at all (.env decides then).
  set -- --rm -d --name "$wh_name" --label app.kinboard.webhook-refresh=1 --network none --no-healthcheck \
    --volumes-from "$wh_cid" -w "$(pwd)" \
    -e "KB_ARGS=$COMPOSE_FILES" -e "KB_LOCK=$GIT_DIR_ABS/kinboard-update.lock" -e "KB_LOG=$LOG_FILE" \
    -e "KB_WANT=$wh_want" -e "KB_WANT_ID=$wh_new" -e "KB_OLD_ID=$wh_old" -e "KB_FROM=$wh_ref ($wh_old)" \
    -e "KB_WAIT=${KINBOARD_LOCK_WAIT:-1800}" -e "KB_SETTLE=${KINBOARD_WEBHOOK_SETTLE:-30}"
  [ -z "$WEBHOOK_ENV_COMPOSE_FILES" ] || set -- "$@" -e "COMPOSE_FILES=$WEBHOOK_ENV_COMPOSE_FILES"
  [ -z "$WEBHOOK_ENV_SECRET" ] || set -- "$@" -e "DIUN_WEBHOOK_SECRET=$WEBHOOK_ENV_SECRET"
  if docker run "$@" --entrypoint sh "$wh_new" -c "$WEBHOOK_REFRESH_SH" >>"$LOG_FILE" 2>&1; then
    log "the webhook runs $wh_ref ($wh_old); it is recreated on $wh_want ($wh_new) once this run has ended ($wh_name)"
  else
    log "WARN: could not start $wh_name to recreate the webhook on $wh_want; it stays on $wh_ref until the next run or ./start.sh up"
  fi
  return 0
}

if [ "$MODE" = loop ]; then
  run_tick_loop
fi

# The updater reads the stack's files where they are on the host: from a
# sibling container (see "The updater"). Before the lock, which the sibling
# takes.
if [ -n "$UPDATER" ] && [ -z "${KINBOARD_UPDATER_SIBLING:-}" ]; then
  updater_hop
  # The files are readable here: resolve_stack reads this same container.
  KINBOARD_SELF_CONTAINER="$(updater_self)"
fi

cd "$PROJECT_DIR"

if [ "$MODE" = tick ]; then
  log "=== tick ==="
else
  log "=== self-update fired ==="
  log "PROJECT_DIR=$PROJECT_DIR"
  log "COMPOSE_FILES=$COMPOSE_FILES"
fi

if [ -n "$UPDATER" ]; then
  # No git: the config volume's updater/ folder, which outlives the
  # container (RFC-023 §4.11.3). The lock and the tick marker below go there
  # too, so the loop's tick and one started by hand never run together.
  GIT_DIR_ABS="$UPDATER_DIR"
  STATE_FILE="$UPDATER_DIR/state"
else
  GIT_DIR_ABS="$(git rev-parse --absolute-git-dir 2>/dev/null || echo "$PROJECT_DIR/.git")"
  STATE_FILE="$GIT_DIR_ABS/kinboard-update-state"
fi

# One run at a time. A second one (Diun firing during a hand-started run)
# would read the first one's hash file, recreate what the first is already
# recreating and take a second backup. In .git so a run started on the host
# and one inside the webhook container share it; flock, so a killed run
# leaves no lock behind.
#
# A Diun run that finds a tick holding the lock waits for it instead: Diun
# calls once per release and never again, so giving up would drop the
# release's git pull and setup.sh until the next one. The tick leaves a marker
# while it runs; a killed tick leaves the lock free, so a stale marker costs
# nothing.
#
# The wait is `flock -n` in a loop, not `flock -w`: the webhook image's flock
# is busybox's, which has no -w. `flock -w` there failed at once with
# "unrecognized option", so a Diun run that met a tick never waited: it logged
# "another self-update is running" and the release's git pull and setup.sh
# were dropped until the next one.
TICK_MARKER="$GIT_DIR_ABS/kinboard-update.tick"
# $1: seconds. Takes the lock on fd 9, waiting at most that long.
lock_wait() {
  lw_end=$(( $(date +%s) + $1 ))
  while ! flock -n 9; do
    [ "$(date +%s)" -lt "$lw_end" ] || return 1
    sleep 1
  done
}
if command -v flock >/dev/null 2>&1; then
  exec 9>"$GIT_DIR_ABS/kinboard-update.lock"
  if ! flock -n 9; then
    if [ "$MODE" = update ] && [ -f "$TICK_MARKER" ] \
       && log "a reconciliation tick is running; waiting for it to finish" \
       && lock_wait "${KINBOARD_LOCK_WAIT:-1500}"; then
      :
    else
      log "another self-update is running; leaving it to finish"
      log "=== self-update skipped ==="
      exit 0
    fi
  fi
  if [ "$MODE" = tick ]; then
    echo "$$" > "$TICK_MARKER" 2>/dev/null || true
    trap 'rm -f "$TICK_MARKER"' EXIT
  fi
else
  log "WARN: no flock here; a second run at the same time is not prevented"
fi

if [ "$MODE" = tick ]; then
  if [ "$(tick_switch)" = off ]; then
    log "=== tick: switched off (KINBOARD_UPDATE_TICK=off) ==="
    exit 0
  fi
  tick_allowed || exit 0
else
  ensure_tick_loop
fi

# Which files the stack runs (see above). Read-only; a stack it cannot read
# ends the run here, before the hash file, the pull or anything else.
if ! resolve_stack; then
  if [ "$MODE" = tick ]; then log "=== tick skipped ==="; else log "=== self-update skipped ==="; fi
  exit 1
fi
# Services no run ever recreates: the Diun overlay's two, and the container
# this runs from (the updater's own service: recreating it would end the run
# halfway). The updater's image moves when the household pulls the stack.
NEVER_RECREATE='^(webhook|diun)$'
if [ -n "$UPDATER" ]; then
  if [ "$STACK_MODE" != compose ] && [ "$STACK_MODE" != container ]; then
    log "ERROR: kinboard-updater updates a stack started from compose.yml; this one was started from other files. A git install updates with the Diun overlay instead. Nothing was changed"
    log "=== tick skipped ==="
    exit 1
  fi
  SELF_SERVICE="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$(updater_self)" 2>/dev/null | sed 's/<no value>//' || true)"
  case "$SELF_SERVICE" in
    "" | *[!A-Za-z0-9._-]*) SELF_SERVICE=updater ;;
  esac
  # A git install on compose.yml with the Diun overlay updates itself through
  # its webhook; two updaters with two locks must not run on one stack.
  project="$(stack_labels "$(updater_self)" | cut -d'|' -f1)"
  if [ -n "$project" ] && [ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=webhook 2>/dev/null || true)" ]; then
    log "ERROR: this stack also runs the Diun overlay's webhook, which updates it; kinboard-updater leaves it to that one. Remove one of the two. Nothing was changed"
    log "=== tick skipped ==="
    exit 1
  fi
  NEVER_RECREATE="^(webhook|diun|$(printf '%s' "$SELF_SERVICE" | sed 's/[.]/[.]/g'))\$"
fi
if { [ "$STACK_MODE" = compose ] || [ "$STACK_MODE" = container ]; } && [ "$MODE" = tick ] && [ "$(tick_switch)" = off ]; then
  log "=== tick: switched off (KINBOARD_UPDATE_TICK=off) ==="
  exit 0
fi
if [ "$STACK_MODE" = compose ] && [ "$MODE" = update ]; then
  [ -z "$STACK_NOTE" ] || log "$STACK_NOTE"
  log "this stack runs compose.yml: docker compose $COMPOSE_FILES"
fi
# Container mode (see there): say so, check what it needs, and finish what a
# tick that was cut short left.
if [ "$STACK_MODE" = container ]; then
  log "$STACK_NOTE"
  cm_preflight
fi
DIUN_BEFORE="$(stat -c %Y webapp/docker/diun/diun.yml 2>/dev/null || echo 0)"

if [ "$MODE" = update ]; then
  # The definitions the containers were created from, before `git pull` and
  # setup.sh change them. Kept in .git until the up below has run, so a run that
  # stops in between (a failed backup, a failed pull) leaves the next run what
  # it started from rather than the already-pulled files, which would compare
  # equal and hide the change. The file says when it was written: a container
  # created after that already carries the current definition, so a
  # `./start.sh up` in between does not make it stale.
  #
  #   head <sha before the pull>
  #   written <UTC, to the second>
  #   <service> <hash>   (one per service)
  HASHES_FILE="$GIT_DIR_ABS/kinboard-update-hashes"
  HASHES_BEFORE=""
  HASHES_SINCE=""
  if [ -f "$HASHES_FILE" ]; then
    file_since="$(awk '$1 == "written" { print $2; exit }' "$HASHES_FILE" 2>/dev/null || true)"
    file_hashes="$(grep -E '^[^ ]+ [0-9a-f]{64}$' "$HASHES_FILE" 2>/dev/null || true)"
    if [ -n "$file_since" ] && [ -n "$file_hashes" ]; then
      log "an earlier run stopped before recreating (from $(awk '$1 == "head" { print $2; exit }' "$HASHES_FILE"), $file_since); comparing against what it started from"
      HASHES_BEFORE="$file_hashes"
      HASHES_SINCE="$file_since"
    else
      log "ignoring an unreadable $HASHES_FILE"
      rm -f "$HASHES_FILE"
    fi
  fi
  if [ -z "$HASHES_BEFORE" ]; then
    HASHES_SINCE="$(date -u +%Y-%m-%dT%H:%M:%S)"
    HASHES_BEFORE="$(config_hashes)"
    if [ -n "$HASHES_BEFORE" ]; then
      { echo "head $(git rev-parse HEAD 2>/dev/null || echo unknown)"
        echo "written $HASHES_SINCE"
        printf '%s\n' "$HASHES_BEFORE"
      } > "$HASHES_FILE" 2>/dev/null || true
    else
      log "WARN: docker compose config --hash gave nothing; a changed definition will not be recreated in this run"
    fi
  fi

  # 1. git fetch + pull
  log "git fetch origin main"
  # No network, no GitHub: nothing has been touched yet, and nothing is.
  if ! fetch_out="$(git fetch origin main 2>&1)"; then
    printf '%s\n' "$fetch_out" >> "$LOG_FILE" 2>/dev/null || true
    log "=== self-update skipped: git fetch failed ($(printf '%s\n' "$fetch_out" | grep -v '^[[:space:]]*$' | head -n1)); nothing was changed, retried at the next run ==="
    exit 1
  fi
  [ -z "$fetch_out" ] || printf '%s\n' "$fetch_out" >> "$LOG_FILE" 2>/dev/null || true
  LOCAL_SHA="$(git rev-parse HEAD)"
  REMOTE_SHA="$(git rev-parse origin/main)"

  if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    log "pulling $LOCAL_SHA → $REMOTE_SHA"
    # The git pull brings new compose files and migrations. The IMAGE pull below (steps 3-4)
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
      # A tracked file with a local edit stops a fast-forward as well, even
      # when the edit was a copy we asked for: until 1.18 the wiki said
      # `cp docker-compose.diun.yml.example docker-compose.diun.yml`, over the
      # tracked file. Git refuses even when the copy equals what it would
      # write. A file whose content is exactly a version this repository has
      # had at that path, or at that path plus .example, is nobody's own
      # work, so it is put back to the checkout's version, which the pull then
      # moves on (a copy stays in .git/kinboard-local-copies). Anything else is
      # left alone. Skip-worktree files (kong.yml and diun/diun.yml on some
      # installs, holding keys) are not listed by `git diff`, so never touched.
      git diff --name-only HEAD 2>/dev/null | while IFS= read -r f; do
        [ -f "$f" ] && [ -n "$(git diff --name-only HEAD origin/main -- "$f" 2>/dev/null)" ] || continue
        blob="$(git hash-object -- "$f" 2>/dev/null || true)"
        [ -n "$blob" ] || continue
        if git log --format= --raw --no-abbrev origin/main -- "$f" "$f.example" 2>/dev/null \
            | awk '{ print $3; print $4 }' | grep -qx "$blob"; then
          mkdir -p "$GIT_DIR_ABS/kinboard-local-copies" 2>/dev/null || true
          cp -p "$f" "$GIT_DIR_ABS/kinboard-local-copies/$(printf '%s' "$f" | tr '/' '_').$(date -u +%Y%m%dT%H%M%SZ)" 2>/dev/null || true
          if git checkout -- "$f" 2>/dev/null; then
            log "  put back $f: its local content is a version this repository shipped (copied from an example), not an edit of your own"
          fi
        fi
      done
      if git pull --ff-only origin main >>"$LOG_FILE" 2>&1; then
        log "pulled $REMOTE_SHA after clearing collisions"
      else
        # Still stuck (local commits, real conflicts). Do not abort — the image
        # pull is the point, and new migrations ride in the image regardless.
        log "WARN: git still behind at $LOCAL_SHA; continuing to image pull anyway"
        stuck="$(git diff --name-only HEAD 2>/dev/null | while IFS= read -r f; do
          [ -z "$(git diff --name-only HEAD origin/main -- "$f" 2>/dev/null)" ] || printf '%s ' "$f"; done)"
        if [ -n "$stuck" ]; then
          log "WARN: these files have local edits that this release changes too: $stuck"
          log "WARN: keep your edits elsewhere (an overlay of your own), then: git -C $PROJECT_DIR checkout -- $stuck"
        fi
      fi
    else
      log "pulled $REMOTE_SHA"
    fi
  else
    log "git up-to-date at $LOCAL_SHA"
  fi

  # 2. setup.sh — idempotent. Adds .env keys a release needs; does nothing
  #    when none are missing.
  #    Not for a stack on compose.yml: setup.sh writes webapp/docker/.env,
  #    which that stack does not read, and puts that file's
  #    DIUN_WEBHOOK_SECRET into diun.yml, where a secret the stack's own .env
  #    does not hold would lock Diun out of the webhook.
  if [ "$STACK_MODE" = compose ]; then
    log "not running setup.sh: this stack runs compose.yml, whose secrets kinboard-init keeps"
  elif [ -x ./setup.sh ]; then
    log "running setup.sh --non-interactive"
    ./setup.sh --non-interactive >>"$LOG_FILE" 2>&1 || {
      log "ERROR: setup.sh failed; aborting before touching containers"
      exit 1
    }
  fi
fi

# 3. + 4. compose pull + up -d
# (The updater has no checkout: its compose flags are absolute.)
[ -n "$UPDATER" ] || cd webapp/docker

take_retry_request

# The tick's first run: a baseline, and nothing else (see "The reconciliation
# tick"). What differs is logged, and the next tick applies it.
if [ "$MODE" = tick ] && [ -z "$(state_get baseline)" ]; then
  CONFIG_IMAGES="$(config_images)"
  for svc in $(stack_services | grep -vE "$NEVER_RECREATE" || true); do
    cid="$(svc_container "$svc")"
    ref=""; running=""
    if [ -n "$cid" ]; then
      ref="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
      running="$(docker inspect -f '{{.Image}}' "$cid" 2>/dev/null || true)"
    fi
    want="$(field_for "$svc" "$CONFIG_IMAGES")"
    log "tick baseline: $svc runs ${ref:-nothing} ${running}"
    if [ -n "$want" ] && [ -n "$ref" ] && [ "$want" != "$ref" ]; then
      log "tick baseline: $svc: the compose files and .env name $want; the next tick applies it"
    fi
    if [ -n "$UPDATER" ] && [ -n "$want" ]; then
      if [ "$(ref_repo "$want")" != "$(ref_repo "$(field_for "$KB_SVC" "$CONFIG_IMAGES")")" ]; then
        log "tick baseline: $svc: $want moves only with the compose file"
      elif ref_pinned "$want"; then
        log "tick baseline: $svc: $want is pinned; it never moves"
      else
        log "tick baseline: $svc: $want is watched in the registry from the next tick"
      fi
    fi
  done
  state_set baseline "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "=== tick: first run, baseline recorded; nothing pulled or recreated ==="
  exit 0
fi

# A tick acts on one thing: a service whose container runs another image
# reference than the compose files and .env name now (a KINBOARD_TAG edited
# by hand, a deploy pinned to a sha-… tag and set back). A newer image under
# the same reference is Diun's to announce: its run does the release's git
# pull and setup.sh first, which a tick never does. And a service someone
# stopped is left stopped. So a tick with nothing to apply asks the registry
# nothing, and one that has pulls only those services.
PULL_SVCS=""
if [ "$MODE" = tick ]; then
  CONFIG_IMAGES="$(config_images)"
  if [ -n "$UPDATER" ]; then
    # The Kinboard image (init, db-init and the webapp run it), and which
    # compose file revision the file declares (RFC-023 §4.6). The all-in-one
    # container has no compose file, and no revision to hold for.
    KB_REPO="$(ref_repo "$(field_for "$KB_SVC" "$CONFIG_IMAGES")")"
    FILE_REVISION=""
    [ -n "$AIO" ] || FILE_REVISION="$(config_env webapp KINBOARD_COMPOSE_REVISION)"
    REGISTRY_FAIL=""
    REGISTRY_ASKED=""
    UNWATCHED=""
    if [ -z "$FILE_REVISION" ] && [ -z "$AIO" ]; then
      log "ERROR: this stack's webapp declares no KINBOARD_COMPOSE_REVISION, so it is not the one-file compose.yml kinboard-updater is for. Nothing was changed"
      exit 1
    fi
    # The one-shots run the webapp's image and go with it: a webapp someone
    # stopped keeps all three as they are.
    wcid="$(svc_container "$KB_SVC" running)"
    if [ -z "$wcid" ] || [ "$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.State.ExitCode}}|{{.HostConfig.RestartPolicy.Name}}' "$wcid" 2>/dev/null | cut -d'|' -f1 || true)" != running ]; then
      if [ -n "$AIO" ]; then
        log "=== tick: $AIO_NAME is not running; nothing is updated until it is ==="
        exit 0
      fi
      log "=== tick: the webapp is not running; nothing is updated until it is ==="
      exit 0
    fi
  fi
  for svc in $(stack_services | grep -vE "$NEVER_RECREATE" || true); do
    cid="$(svc_container "$svc")"
    [ -n "$cid" ] || continue
    st="$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.State.ExitCode}}|{{.HostConfig.RestartPolicy.Name}}' "$cid" 2>/dev/null || true)"
    case "$st" in
      running\|* | *\|no) ;;
      *) continue ;;
    esac
    ref="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
    want="$(field_for "$svc" "$CONFIG_IMAGES")"
    if [ -n "$UPDATER" ]; then
      # The updater decides for itself (see "The updater"): the Kinboard
      # image only, by reference and by the registry's digest.
      [ -n "$ref" ] && [ -n "$want" ] && [ -z "$REGISTRY_FAIL" ] || continue
      updater_watch "$svc" "$ref" "$cid" "$want"
      case "$WATCH" in
        pull)
          if [ "$ref" != "$want" ]; then
            log "tick: $svc runs $ref; the compose files and .env name $want"
          else
            log "tick: $svc runs $ref, and the registry has a newer image under it ($WATCH_WHY)"
          fi
          PULL_SVCS="$PULL_SVCS $svc" ;;
        current) REGISTRY_ASKED=1 ;;
        other)
          [ "$ref" = "$want" ] || log "tick: $svc runs $ref; the file names $want, which changes only with your own Up (not applied here)" ;;
        held) log "held $svc: the registry's $want ($WATCH_WHY) was rolled back before; waiting for a newer one" ;;
        compose) log "held $svc: $want ($WATCH_WHY) needs a newer compose file than this one (revision $FILE_REVISION); waiting for the file to change or a newer image" ;;
        fail) REGISTRY_FAIL="$WATCH_WHY" ;;
        unwatched)
          case " $UNWATCHED " in *" $want "*) ;; *) UNWATCHED="$UNWATCHED $want"; log "WARN: cannot watch $want: $WATCH_WHY" ;; esac ;;
      esac
    elif [ -n "$ref" ] && [ -n "$want" ] && [ "$ref" != "$want" ]; then
      log "tick: $svc runs $ref; the compose files and .env name $want"
      PULL_SVCS="$PULL_SVCS $svc"
    fi
  done
  # The webhook, which the loop above leaves out: it follows a reference that
  # changed after this tick (see "The webhook's own image").
  webhook_refresh tick
  if [ -n "$UPDATER" ] && [ -n "$REGISTRY_FAIL" ]; then
    # Nothing has been pulled or touched; a reference change found above
    # waits for the next tick too, so that one tick never does half.
    tick_backoff "$REGISTRY_FAIL"
    exit 0
  fi
  # Only when there is nothing to pull: a pull that then fails must still
  # count as one more failure in a row.
  if [ -n "$UPDATER" ] && [ -n "$REGISTRY_ASKED" ] && [ -z "$PULL_SVCS" ] && [ -n "$(state_get failures)" ]; then
    state_set failures ""
    state_set backoff_until ""
  fi
  if [ -z "$PULL_SVCS" ]; then
    log "=== tick: nothing to do ==="
    exit 0
  fi
fi

# An update pulls every service but the webhook, whose image is pulled on its
# own afterwards (see "The webhook's own image"): a webhook image that cannot
# be pulled must not hold up the release. `--ignore-buildable` skips services
# with a `build:` (a source build of the webapp, docker-compose.build.yml; a
# webhook built here, docker-compose.webhook-build.yml), which have no
# registry counterpart.
if [ "$MODE" = update ] && [ -z "$UPDATER" ] && [ "$STACK_MODE" != container ]; then
  PULL_SVCS="$(stack_services | grep -vx webhook | tr '\n' ' ' || true)"
fi
[ "$MODE" = tick ] || log "docker compose $COMPOSE_FILES pull --ignore-buildable ${PULL_SVCS:-(all services)}"
# The image ids before the pull, so the backup below can tell a real upgrade
# from a no-op run. `config --images` lists what the stack resolves to;
# inspecting each gives the id actually on disk now.
# Every image reference the stack names.
stack_image_refs() {
  if [ "$STACK_MODE" = container ]; then
    config_images | awk '{ print $2 }'
    return 0
  fi
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES config --images 2>/dev/null || true
}
images_now() {
  # Sorted, because `config --images` returns the images in a different order
  # on every call: three consecutive calls on a production host gave three
  # different checksums with every image id unchanged. Unsorted, this compared
  # two shuffles of the same list and nearly always reported a change, so the
  # backup ran on runs that had nothing to upgrade.
  stack_image_refs | sort -u | while read -r ref; do
    docker image inspect -f '{{.Id}}' "$ref" 2>/dev/null || echo "absent:$ref"
  done
}
IMAGES_BEFORE="$(images_now)"

# A pull that fails (no network, the registry down or rate-limiting) ends the
# run here, before anything is backed up or recreated: what it did fetch
# stays on disk and is applied by the run that next gets through. A tick's
# output goes to the log only then, so a quiet tick is one line.
PULL_OUT="${TMPDIR:-/tmp}/kinboard-update-pull.$$"
# $@: the services to pull (all when none). Container mode pulls each one's
# reference once.
stack_pull() {
  if [ "$STACK_MODE" = container ]; then
    for ref in $(for svc in "$@"; do field_for "$svc" "$CONFIG_IMAGES"; done | awk 'NF && !seen[$0]++'); do
      docker pull "$ref" || return 1
    done
    return 0
  fi
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES pull --ignore-buildable "$@"
}
# shellcheck disable=SC2086
if ! stack_pull $PULL_SVCS >"$PULL_OUT" 2>&1; then
  cat "$PULL_OUT" >> "$LOG_FILE" 2>/dev/null || true
  why="$(grep -v '^[[:space:]]*$' "$PULL_OUT" | tail -n1 || true)"
  rm -f "$PULL_OUT"
  case "$why" in
    *429* | *toomanyrequests* | *"Too Many Requests"*) why="the registry is rate-limiting: $why" ;;
  esac
  if [ "$MODE" = tick ]; then
    tick_backoff "the pull failed (${why:-no output})"
    exit 0
  fi
  log "=== self-update skipped: the pull failed (${why:-no output}); nothing was changed, retried at the next run ==="
  exit 1
fi
[ "$MODE" = tick ] || cat "$PULL_OUT" >> "$LOG_FILE" 2>/dev/null || true
rm -f "$PULL_OUT"
state_set failures ""
state_set backoff_until ""
[ "$MODE" != update ] || webhook_refresh pull

IMAGES_AFTER="$(images_now)"

# The updater: a release that needs a newer compose file is held, before any
# backup or recreate (see updater_revision_ok).
if [ -n "$UPDATER" ] && ! updater_revision_ok; then
  log "=== tick: held for a newer compose file; nothing was changed ==="
  exit 0
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
# scheduler not refreshed, etc.). The webhook follows its image after the
# run instead (webhook_refresh, above); diun's definition changes take
# `./start.sh up` on the host.
SERVICES=$(stack_services \
            | grep -vE "$NEVER_RECREATE" \
            | tr '\n' ' ')

# The services whose image or definition changed (see "What to recreate").
# A tick pulled no definitions, so it compares images only.
HASHES_NOW=""
KEEP_HASHES_FILE=""
if [ "$MODE" = update ]; then
  HASHES_NOW="$(config_hashes)"
  if [ -z "$HASHES_NOW" ]; then
    log "WARN: docker compose config --hash gave nothing after the pull; recreating only for images, keeping the hash file for the next run"
    KEEP_HASHES_FILE=1
  fi
else
  HASHES_BEFORE=""
fi
CONFIG_IMAGES="$(config_images)"
# A tick judges only the services it found above.
if [ "$MODE" = tick ]; then
  DECISIONS="$(services_to_recreate "$PULL_SVCS")"
else
  DECISIONS="$(services_to_recreate "$SERVICES")"
fi
printf '%s\n' "$DECISIONS" | while read -r what svc why; do
  case "$what" in
    held) log "held $svc ($why): its image was rolled back before; waiting for a newer one" ;;
    ?*) log "$what $svc ($why)" ;;
  esac
done
RECREATE="$(printf '%s\n' "$DECISIONS" | awk '$1 == "recreate" { printf "%s%s", sep, $2; sep = " " }')"

# The pull has just pointed a held service's tag at the image that was rolled
# back. Point it at the image that runs again, so that a `./start.sh up` or a
# `docker compose up` by hand does not start the broken one.
for svc in $(printf '%s\n' "$DECISIONS" | awk '$1 == "held" { print $2 }'); do
  cid="$(svc_container "$svc")"
  running="$(docker inspect -f '{{.Image}}' "$cid" 2>/dev/null || true)"
  want_ref="$(field_for "$svc" "$CONFIG_IMAGES")"
  # Once is enough where services share the reference (compose.yml's init,
  # db-init and webapp).
  [ "$(docker image inspect -f '{{.Id}}' "$want_ref" 2>/dev/null || true)" != "$running" ] || continue
  if [ -n "$running" ] && [ -n "$want_ref" ] && docker tag "$running" "$want_ref" >>"$LOG_FILE" 2>&1; then
    log "$want_ref points at the image $svc runs again ($running), not the held one"
  fi
done
if printf '%s\n' "$DECISIONS" | grep -q '^skip '; then
  KEEP_HASHES_FILE=1
fi

if [ "$MODE" = tick ] && [ -z "$RECREATE" ]; then
  log "=== tick: nothing to do ==="
  exit 0
fi

# The updater: the services it is about to recreate must keep their data
# (see updater_mounts_match). If not, the pulled tags go back to what runs.
if [ -n "$UPDATER" ] && ! updater_mounts_match; then
  for svc in $RECREATE; do
    cid="$(svc_container "$svc")"
    running="$(docker inspect -f '{{.Image}}' "$cid" 2>/dev/null || true)"
    run_ref="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
    [ -n "$running" ] && [ "$run_ref" = "$(field_for "$svc" "$CONFIG_IMAGES")" ] || continue
    [ "$(docker image inspect -f '{{.Id}}' "$run_ref" 2>/dev/null || true)" != "$running" ] || continue
    docker tag "$running" "$run_ref" >>"$LOG_FILE" 2>&1 || true
  done
  log "=== tick skipped: nothing was backed up or recreated ==="
  exit 1
fi

# What runs now, before anything is touched: the rollback target. In the
# state file too, for whoever reads it after a run that was cut short.
PREVIOUS=""
for svc in $RECREATE; do
  cid="$(svc_container "$svc")"
  id="$(docker inspect -f '{{.Image}}' "$cid" 2>/dev/null || true)"
  ref="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
  PREVIOUS="$PREVIOUS$svc ${id:--} ${ref:--}
"
  digests="$(docker image inspect -f '{{join .RepoDigests " "}}' "$id" 2>/dev/null || true)"
  log "before recreating: $svc runs ${id:-an unreadable image} (${ref:-?}${digests:+; $digests})"
done
{ awk '$1 != "previous"' "$STATE_FILE" 2>/dev/null || true
  printf '%s' "$PREVIOUS" | sed 's/^/previous /'
} > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"

# 3b. Back up, but only when something is actually about to change, and
# before `up -d` recreates anything or the webapp's entrypoint runs a
# migration over the data.
#
# A failure here aborts the upgrade. That is the whole point: staying on the
# current image is recoverable, and discovering after the fact that a
# migration ran with no backup is not. The pulled image stays on disk, and the
# next run, finding the container still on the old one, recreates it then --
# so the backup also keys on what is about to be recreated, not only on what
# this run's pull brought.
#
# A pull that brought new images but recreates nothing (every changed service
# is held back after a rollback, or the image belongs to diun) needs no
# backup, unless `up` below is about to create a missing container from one.
NEW_CONTAINER=""
if printf '%s\n' "$DECISIONS" | grep -q '^skip [^ ]* no-container$'; then NEW_CONTAINER=1; fi
if [ -n "$RECREATE" ] || { [ "$IMAGES_BEFORE" != "$IMAGES_AFTER" ] && [ -n "$NEW_CONTAINER" ]; }; then
  log "new image(s) or changed services (${RECREATE:-none}) — taking a backup before recreating anything"
  if ! take_backup; then
    log "=== self-update ABORTED: no verified backup, nothing was recreated ==="
    exit 1
  fi
else
  log "no image changed; skipping the pre-upgrade backup"
fi

# 3c. Containers of services a release retired (1.15: kong, auth, realtime,
# storage, imgproxy) go before the up rather than during it: Kong held
# WEBAPP_PORT on some installs, and the webapp needs it now. --remove-orphans
# below would catch them too, but only as part of the same up that has to
# bind the port. A service an overlay still defines is left alone. Not on a
# tick: it changes what runs, never what exists.
# A stack on compose.yml (1.18 and later) never had them.
if [ "$MODE" = update ] && [ "$STACK_MODE" != compose ]; then
  COMPOSE="docker compose" COMPOSE_FILES="$COMPOSE_FILES" ENV_FILE=./.env \
    sh ./kinboard-entry.sh retire 2>&1 | while IFS= read -r line; do log "$line"; done
fi

WEBAPP_BEFORE="$(webapp_container)"

# 4. First everything that is missing or stopped, recreating nothing:
# --no-recreate keeps Compose's own hash comparison, which is the one that
# differs between versions, out of the decision. Then the services that did
# change, and only those: --no-deps, or Compose would check their
# dependencies by that same hash and recreate the database along with them.
# A tick skips the first: a service someone stopped stays stopped.
if [ "$MODE" = update ]; then
  log "docker compose $COMPOSE_FILES up -d --no-build --no-recreate --remove-orphans $SERVICES"
  # shellcheck disable=SC2086
  if ! docker compose $COMPOSE_FILES up -d --no-build --no-recreate --remove-orphans $SERVICES >>"$LOG_FILE" 2>&1; then
    log "=== self-update ABORTED: docker compose up failed ==="
    exit 1
  fi
fi

# $1: extra flags for `up` ("--pull never" for a rollback); $2: the services.
# `up -d --no-deps --force-recreate` for them, and nothing else.
#
# With --no-deps Compose keeps only the depends_on between the services it is
# given. On compose.yml, init is what db depends on, and db is not among them,
# so nothing given would wait for init: it would run beside db-init and the
# webapp instead of before them, and a release whose init writes a file they
# read would start them without it. So init goes first, alone, and must have
# exited 0 before the others are started. Returns 1, with UNHEALTHY set, when
# any of it fails. (On the legacy file there is no init: one `up`, as always.)
recreate_services() {
  if [ "$STACK_MODE" = container ]; then
    cm_recreate "$2"
    return $?
  fi
  case " $2 " in
    *" init "*)
      others="$(printf ' %s ' "$2" | sed 's/ init / /; s/^  *//; s/  *$//')"
      log "recreating init first, on its own, and waiting for it to finish${others:+; then $others}"
      # shellcheck disable=SC2086
      if ! docker compose $COMPOSE_FILES up -d $1 --no-build --no-deps --force-recreate init >>"$LOG_FILE" 2>&1; then
        UNHEALTHY="docker compose up failed for init (the log above has its output)
"
        return 1
      fi
      wait_completed init || return 1
      [ -n "$others" ] || return 0
      ;;
    *) others="$2" ;;
  esac
  # shellcheck disable=SC2086
  if ! docker compose $COMPOSE_FILES up -d $1 --no-build --no-deps --force-recreate $others >>"$LOG_FILE" 2>&1; then
    UNHEALTHY="docker compose up failed (the log above has its output)
"
    return 1
  fi
  return 0
}

# Until one-shot $1 has exited 0, for at most KINBOARD_HEALTH_TIMEOUT; 1, with
# UNHEALTHY set, when it exits otherwise, goes or is still running then.
wait_completed() {
  UNHEALTHY=""
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while :; do
    cid="$(svc_container "$1")"
    st="$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.State.ExitCode}}|{{.HostConfig.RestartPolicy.Name}}' "$cid" 2>/dev/null || true)"
    IFS='|' read -r status health restarts code policy <<EOF
$st
EOF
    if [ -z "$cid" ] || [ -z "$st" ]; then
      UNHEALTHY="$1: its container is gone
"
      return 1
    fi
    case "$status" in
      exited)
        [ "$code" = 0 ] && return 0
        UNHEALTHY="$1: exited with code $code
"
        return 1 ;;
      dead)
        UNHEALTHY="$1: exited with code $code
"
        return 1 ;;
    esac
    if [ "$(date +%s)" -ge "$deadline" ]; then
      UNHEALTHY="$1: still not done after ${HEALTH_TIMEOUT}s
"
      return 1
    fi
    sleep "$HEALTH_POLL"
  done
}

# 4c. Recreate, wait for health, and roll back if it does not come (see
# "Health and rollback").
roll_back() {
  printf '%s' "$UNHEALTHY" | while IFS= read -r line; do log "ERROR: $line"; done
  MIGRATION=""
  case " $RECREATE " in *" $KB_SVC "*) MIGRATION="$(failed_migration)" ;; esac
  EXCERPT="$(log_excerpt "$RECREATE")"
  # What each reference names now, read for every service before any is
  # tagged back: on compose.yml init, db-init and webapp share one reference,
  # and once the first has been tagged back the others would read their old
  # image there and take the failure for their definition's.
  NEW_IDS=""
  for svc in $RECREATE; do
    want_ref="$(field_for "$svc" "$CONFIG_IMAGES")"
    [ -n "$want_ref" ] || want_ref="$(printf '%s\n' "$PREVIOUS" | awk -v s="$svc" '$1 == s { print $3; exit }')"
    NEW_IDS="$NEW_IDS$svc $(docker image inspect -f '{{.Id}}' "$want_ref" 2>/dev/null || echo -)
"
  done
  # The webapp last: where services that share a reference ran different
  # images before (a webapp recreated by hand since), the tag ends on the
  # webapp's.
  for svc in $(printf '%s\n' $RECREATE | grep -vx webapp || true) $(printf '%s\n' $RECREATE | grep -x webapp || true); do
    prev_id="$(field_for "$svc" "$PREVIOUS")"
    want_ref="$(field_for "$svc" "$CONFIG_IMAGES")"
    [ -n "$want_ref" ] || want_ref="$(printf '%s\n' "$PREVIOUS" | awk -v s="$svc" '$1 == s { print $3; exit }')"
    new_id="$(field_for "$svc" "$NEW_IDS")"
    [ "$new_id" != - ] || new_id=""
    if [ -n "$new_id" ] && [ "$new_id" != "$prev_id" ] && ! is_held "$new_id"; then
      hold_back "$new_id" "$want_ref"
      log "holding back $want_ref ($new_id) until a newer image appears"
    fi
    if [ "$prev_id" = - ] || ! docker image inspect -f '{{.Id}}' "$prev_id" >/dev/null 2>&1; then
      log "ERROR: the image $svc ran before ($prev_id) is no longer on this host; it cannot go back"
    elif [ "$new_id" = "$prev_id" ]; then
      log "ERROR: $svc runs the same image as before; what failed is its definition (the compose files or .env), which going back to the image cannot undo"
    elif [ "$(docker image inspect -f '{{.Id}}' "$want_ref" 2>/dev/null || true)" = "$prev_id" ]; then
      : # tagged back already, for another service on the same reference
    elif ! docker tag "$prev_id" "$want_ref" >>"$LOG_FILE" 2>&1; then
      log "ERROR: could not tag $prev_id as $want_ref"
    fi
  done
  if [ "$STACK_MODE" = container ] && aio_pg_confirmed; then
    # The all-in-one image's database upgrade is final: going back would
    # stop Kinboard (see "The all-in-one image").
    aio_keep_new
    return 0
  fi
  if [ "$STACK_MODE" = container ]; then
    # The originals themselves, set aside by the swap (see "Container mode").
    log "rolling back: the containers from before the update ($RECREATE) back under their names"
    rb_ok=1
    cm_restore_all || rb_ok=""
  else
    log "rolling back: docker compose $COMPOSE_FILES up -d --pull never --no-build --no-deps --force-recreate $RECREATE"
    rb_ok=1
    recreate_services "--pull never" "$RECREATE" || rb_ok=""
  fi
  if [ -n "$rb_ok" ] && wait_ready "$RECREATE"; then
    OUTCOME=rolled_back
    log "ERROR: ROLLED BACK: $RECREATE run the images they ran before this update again, and are healthy"
    if [ -n "$MIGRATION" ]; then
      log "ERROR: rolled back after migration $MIGRATION failed; the database may hold part of it; the older version runs on it because migrations are additive; the file is retried with the next release"
    else
      log "migrations the new version applied stay: they are additive, and the older version runs on them"
    fi
  else
    OUTCOME=rollback_failed
    printf '%s' "$UNHEALTHY" | while IFS= read -r line; do log "ERROR: after the rollback: $line"; done
    log "ERROR: THE ROLLBACK DID NOT COME UP EITHER. Kinboard may be down. The backup from before the update is $BACKUP_DIR/$BACKUP_FILE"
  fi
}

OUTCOME=none
MIGRATION=""
EXCERPT=""
if [ -n "$RECREATE" ]; then
  if [ "$STACK_MODE" = container ]; then
    log "container mode: recreating $RECREATE from their own configuration with the new image"
  else
    log "docker compose $COMPOSE_FILES up -d --no-build --no-deps --force-recreate $RECREATE"
  fi
  # A PostgreSQL major upgrade inside the all-in-one image takes longer.
  [ -z "$AIO" ] || aio_pg_plan
  up_ok=1
  recreate_services "" "$RECREATE" || up_ok=""
  # The versions for the status record, before a rollback re-tags anything.
  MAIN_SVC="$KB_SVC"
  case " $RECREATE " in *" $KB_SVC "*) ;; *) MAIN_SVC="${RECREATE%% *}" ;; esac
  main_prev_id="$(field_for "$MAIN_SVC" "$PREVIOUS")"
  main_prev_ref="$(printf '%s\n' "$PREVIOUS" | awk -v s="$MAIN_SVC" '$1 == s { print $3; exit }')"
  main_ref="$(field_for "$MAIN_SVC" "$CONFIG_IMAGES")"
  FROM_VERSION="$(image_version "$main_prev_id" "$main_prev_ref")"
  TO_VERSION="$(image_version "$(docker image inspect -f '{{.Id}}' "${main_ref:-$main_prev_ref}" 2>/dev/null || true)" "${main_ref:-$main_prev_ref}")"

  if [ -n "$up_ok" ]; then
    log "waiting up to ${HEALTH_TIMEOUT}s for $RECREATE to come up healthy"
  fi
  if [ -n "$up_ok" ] && wait_ready "$RECREATE"; then
    OUTCOME=updated
    log "healthy: $RECREATE"
    [ "$STACK_MODE" != container ] || cm_finish
    [ -z "$AIO" ] || aio_unraid_status
    for svc in $RECREATE; do
      release_held "$(field_for "$svc" "$CONFIG_IMAGES")"
    done
  else
    log "ERROR: the update to $TO_VERSION did not come up healthy; going back to $FROM_VERSION"
    roll_back
  fi
else
  log "no service changed; none recreated"
fi
if [ "$MODE" = update ]; then
  if [ -n "$KEEP_HASHES_FILE" ]; then
    log "keeping $HASHES_FILE: a service could not be judged in this run, the next one looks again"
  else
    rm -f "$HASHES_FILE"
  fi
fi

# 4b. The scheduler, when the webapp is new (see recreate_scheduler_if_webapp_changed).
recreate_scheduler_if_webapp_changed "$WEBAPP_BEFORE"

# 5. Diun restart — only if diun/diun.yml changed during this run.
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

# 6. The status record Settings reads (instance_settings.update_status): a
# rollback always, an update when the webapp was in it ("Updated to 1.18.0").
if [ "$OUTCOME" = updated ] && [ "$MAIN_SVC" != "$KB_SVC" ]; then
  :
elif [ "$OUTCOME" != none ]; then
  severe=false
  if [ "$OUTCOME" = rollback_failed ] || [ -n "$MIGRATION" ]; then severe=true; fi
  shown_log="$LOG_FILE"
  # The webhook container's log, as the household finds it on the host
  # (docker-compose.diun.yml mounts /var/lib/kinboard-update there).
  [ "$LOG_FILE" != /var/log/kinboard-update.log ] || shown_log=/var/lib/kinboard-update/kinboard-update.log
  [ -z "$UPDATER" ] || shown_log="$(updater_log_location)"
  record="{\"status\":$(json_str "$OUTCOME"),\"at\":$(json_str "$(date -u +%Y-%m-%dT%H:%M:%SZ)"),\"from\":$(json_str "$FROM_VERSION"),\"to\":$(json_str "$TO_VERSION"),\"services\":$(json_str "$RECREATE"),\"backup\":$(json_str "$BACKUP_FILE"),\"backup_dir\":$(json_str "$BACKUP_DIR"),\"backup_at\":$(json_str "$BACKUP_AT"),\"migration\":$(json_str "$MIGRATION"),\"severe\":$severe,\"log_file\":$(json_str "$shown_log"),\"log\":$(json_str "$EXCERPT")}"
  write_status "$record" "$OUTCOME ($FROM_VERSION → $TO_VERSION)" \
    "$(printf '%s' "$record" | sed 's/,"log":".*"}$/,"log":""}/')"
fi

case "$OUTCOME" in
  rolled_back)
    log "=== self-update ROLLED BACK: $TO_VERSION did not start; $FROM_VERSION runs again ==="
    exit 1 ;;
  rollback_failed)
    log "=== self-update FAILED: $TO_VERSION did not start, and going back to $FROM_VERSION did not work either ==="
    exit 1 ;;
esac
if [ "$MODE" = tick ]; then
  log "=== tick done ==="
else
  log "=== self-update done ==="
fi
