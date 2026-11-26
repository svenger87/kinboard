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
# Required env / mounts (configured by docker-compose.diun.yml.example):
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

LOG_FILE="${LOG_FILE:-/var/log/kinboard-update.log}"
PROJECT_DIR="${PROJECT_DIR:-/project}"
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml}"

MODE=update
case "${1:-}" in
  "") ;;
  --tick) MODE=tick ;;
  --tick-loop) MODE=loop ;;
  *) echo "usage: $0 [--tick | --tick-loop]" >&2; exit 2 ;;
esac

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
STACK_MODE=legacy
# The .env the stack's compose files are interpolated from.
STACK_ENV_FILE="$PROJECT_DIR/webapp/docker/.env"

# The value of $1 in the stack's .env, as written there (quotes removed), or
# nothing.
env_value() {
  grep -E "^$1=" "$STACK_ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"' || true
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
tar --numeric-owner -czf "$part" -C "$src" . || fail "tar could not write the archive"
chmod 0600 "$part" 2>/dev/null || true
chk="$(mktemp -d)" || fail "no temporary folder to verify in"
tar --numeric-owner -xzpf "$part" -C "$chk" || fail "the archive does not extract"
n=0
list="$(cd "$src" && find . -print)" || fail "cannot list $src"
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
  # shellcheck disable=SC2086
  cid="$(docker compose $COMPOSE_FILES ps -aq "$1" 2>/dev/null | head -n1 || true)"
  [ -n "$cid" ] || return 0
  docker inspect -f '{{range .Mounts}}{{if eq .Destination "'"$2"'"}}{{if eq .Type "volume"}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}' "$cid" 2>/dev/null || true
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

  if [ "$STACK_MODE" = compose ]; then
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
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES ps -aq webapp 2>/dev/null | head -n1
}

# $1: the webapp container id from before `up -d` (empty if none ran).
recreate_scheduler_if_webapp_changed() {
  before="$1"
  after="$(webapp_container)"
  if [ -z "$after" ] || [ "$before" = "$after" ]; then
    log "webapp not recreated; scheduler left as it is"
    return 0
  fi
  # shellcheck disable=SC2086
  if ! docker compose $COMPOSE_FILES config --services 2>/dev/null | grep -x cron >/dev/null; then
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
    # shellcheck disable=SC2086
    cid="$(docker compose $COMPOSE_FILES ps -aq "$svc" 2>/dev/null | head -n1 || true)"
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
hold_back() {
  is_held "$1" || echo "held $1 $2 $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$STATE_FILE"
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
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES ps -q db 2>/dev/null | head -n1 || true
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
  if printf '%s\n' "INSERT INTO public.instance_settings (key, value) VALUES ('update_status', :'v')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();" \
     | docker exec -i "$db" psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 -v "v=$1" >>"$LOG_FILE" 2>&1; then
    log "status for Settings: $2"
  elif [ -n "${3:-}" ] && [ "$3" != "$1" ] && printf '%s\n' "INSERT INTO public.instance_settings (key, value) VALUES ('update_status', :'v')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();" \
     | docker exec -i "$db" psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 -v "v=$3" >>"$LOG_FILE" 2>&1; then
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
      # shellcheck disable=SC2086
      cid="$(docker compose $COMPOSE_FILES ps -aq "$svc" 2>/dev/null | head -n1 || true)"
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
  # shellcheck disable=SC2086
  cid="$(docker compose $COMPOSE_FILES ps -aq webapp 2>/dev/null | head -n1 || true)"
  smoke_deadline=$(( $(date +%s) + SMOKE_TIMEOUT ))
  while :; do
    # CRON_SECRET is the webapp container's own: single quotes, expanded there.
    # On compose.yml it is not in the container's environment at all: the
    # entrypoint exports it from the secrets store to the server only, and a
    # `docker exec` shell has the container's configured environment. So the
    # store's file, where there is one (kinboard-init, RFC-023 §4.1);
    # without it every check there was a 401, and passed on health alone.
    # shellcheck disable=SC2016
    out="$(docker exec "$cid" sh -c 's="${CRON_SECRET:-$(cat /kinboard/secrets/cron_secret 2>/dev/null)}"; curl -s -m 30 -w "\n%{http_code}" -H "Authorization: Bearer $s" "http://localhost:3000/api/health?deep=1"' 2>/dev/null || true)"
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
  case " $1 " in *" webapp "*) smoke_check || return 1 ;; esac
  return 0
}

# The migration the webapp's entrypoint gave up on, from its log
# (migrate.sh: "[migrate] FAILED: <file>"), or nothing.
failed_migration() {
  # shellcheck disable=SC2086
  cid="$(docker compose $COMPOSE_FILES ps -aq webapp 2>/dev/null | head -n1 || true)"
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
  # private key is base64url, a shape nothing below would catch.
  secrets="$( { tr -d '\r' < "${STACK_ENV_FILE:-$PROJECT_DIR/webapp/docker/.env}" 2>/dev/null || true
    [ "${STACK_MODE:-}" != compose ] || stored_secrets; } \
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
  docker exec "$db" sh -c 'for f in /kinboard/secrets/*; do [ -f "$f" ] && printf "STORED_SECRET=%s\n" "$(cat "$f")"; done' 2>/dev/null || true
}

# The last lines each of the given services' containers logged, for Details,
# with secrets taken out (redact).
log_excerpt() {
  for svc in $1; do
    # shellcheck disable=SC2086
    cid="$(docker compose $COMPOSE_FILES ps -aq "$svc" 2>/dev/null | head -n1 || true)"
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
if [ ! -d "$PROJECT_DIR" ]; then
  log "ERROR: PROJECT_DIR=$PROJECT_DIR is not a folder here; nothing was changed"
  exit 1
fi
if [ ! -e "$PROJECT_DIR/.git" ]; then
  log "this install has no git checkout ($PROJECT_DIR has no .git), so it is not updated from here; nothing was pulled, run or changed. Update it with Pull and Up in your Compose UI, or: docker compose pull && docker compose up -d"
  exit 0
fi
# A checkout, but of something else: a stack folder some Compose UIs keep in
# a repository of their own (Komodo's and Portainer's git stacks, say), with
# compose.yml in it. Its `origin main` is the household's own repository.
# Only a checkout git can read is judged here; one it refuses (owned by
# another user) goes on and fails at `git fetch`, as it always has.
if git -C "$PROJECT_DIR" rev-parse --git-dir >/dev/null 2>&1 \
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

if [ "$MODE" = loop ]; then
  run_tick_loop
fi

cd "$PROJECT_DIR"

if [ "$MODE" = tick ]; then
  log "=== tick ==="
else
  log "=== self-update fired ==="
  log "PROJECT_DIR=$PROJECT_DIR"
  log "COMPOSE_FILES=$COMPOSE_FILES"
fi

GIT_DIR_ABS="$(git rev-parse --absolute-git-dir 2>/dev/null || echo "$PROJECT_DIR/.git")"
STATE_FILE="$GIT_DIR_ABS/kinboard-update-state"

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
TICK_MARKER="$GIT_DIR_ABS/kinboard-update.tick"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$GIT_DIR_ABS/kinboard-update.lock"
  if ! flock -n 9; then
    if [ "$MODE" = update ] && [ -f "$TICK_MARKER" ] \
       && log "a reconciliation tick is running; waiting for it to finish" \
       && flock -w "${KINBOARD_LOCK_WAIT:-1500}" 9; then
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
if [ "$STACK_MODE" = compose ] && [ "$MODE" = tick ] && [ "$(tick_switch)" = off ]; then
  log "=== tick: switched off (KINBOARD_UPDATE_TICK=off) ==="
  exit 0
fi
if [ "$STACK_MODE" = compose ] && [ "$MODE" = update ]; then
  [ -z "$STACK_NOTE" ] || log "$STACK_NOTE"
  log "this stack runs compose.yml: docker compose $COMPOSE_FILES"
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
cd webapp/docker

take_retry_request

# The tick's first run: a baseline, and nothing else (see "The reconciliation
# tick"). What differs is logged, and the next tick applies it.
if [ "$MODE" = tick ] && [ -z "$(state_get baseline)" ]; then
  CONFIG_IMAGES="$(config_images)"
  # shellcheck disable=SC2086
  for svc in $(docker compose $COMPOSE_FILES config --services 2>/dev/null | grep -vE '^(webhook|diun)$' || true); do
    # shellcheck disable=SC2086
    cid="$(docker compose $COMPOSE_FILES ps -aq "$svc" 2>/dev/null | head -n1 || true)"
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
  # shellcheck disable=SC2086
  for svc in $(docker compose $COMPOSE_FILES config --services 2>/dev/null | grep -vE '^(webhook|diun)$' || true); do
    # shellcheck disable=SC2086
    cid="$(docker compose $COMPOSE_FILES ps -aq "$svc" 2>/dev/null | head -n1 || true)"
    [ -n "$cid" ] || continue
    st="$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.State.ExitCode}}|{{.HostConfig.RestartPolicy.Name}}' "$cid" 2>/dev/null || true)"
    case "$st" in
      running\|* | *\|no) ;;
      *) continue ;;
    esac
    ref="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
    want="$(field_for "$svc" "$CONFIG_IMAGES")"
    if [ -n "$ref" ] && [ -n "$want" ] && [ "$ref" != "$want" ]; then
      log "tick: $svc runs $ref; the compose files and .env name $want"
      PULL_SVCS="$PULL_SVCS $svc"
    fi
  done
  if [ -z "$PULL_SVCS" ]; then
    log "=== tick: nothing to do ==="
    exit 0
  fi
fi

[ "$MODE" = tick ] || log "docker compose $COMPOSE_FILES pull --ignore-buildable"
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

# A pull that fails (no network, the registry down or rate-limiting) ends the
# run here, before anything is backed up or recreated: what it did fetch
# stays on disk and is applied by the run that next gets through. A tick's
# output goes to the log only then, so a quiet tick is one line.
PULL_OUT="${TMPDIR:-/tmp}/kinboard-update-pull.$$"
# shellcheck disable=SC2086
if ! docker compose $COMPOSE_FILES pull --ignore-buildable $PULL_SVCS >"$PULL_OUT" 2>&1; then
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

IMAGES_AFTER="$(images_now)"

# Changes to THIS script do not need that out-of-band step any more: the hook
# runs it through the project directory mount (diun/hooks.yaml), so the next
# run after a `git pull` executes the new version. It used to run a copy
# mounted as a single file, which stayed at the version on disk when the
# webhook started — and since the webhook is excluded below, that was forever.
#
# Exclude webhook + diun from the recreate. The script is currently
# executing INSIDE the webhook container — if compose recreates it, the
# script gets SIGKILL'd mid-flight and can't finish (half-done state,
# scheduler not refreshed, etc.). Self-updating those two services is
# done out-of-band via `docker compose build webhook && docker compose
# up -d webhook diun` from the host when their definitions change.
# shellcheck disable=SC2086
SERVICES=$(docker compose $COMPOSE_FILES config --services 2>/dev/null \
            | grep -vE '^(webhook|diun)$' \
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
  # shellcheck disable=SC2086
  cid="$(docker compose $COMPOSE_FILES ps -aq "$svc" 2>/dev/null | head -n1 || true)"
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

# What runs now, before anything is touched: the rollback target. In the
# state file too, for whoever reads it after a run that was cut short.
PREVIOUS=""
for svc in $RECREATE; do
  # shellcheck disable=SC2086
  cid="$(docker compose $COMPOSE_FILES ps -aq "$svc" 2>/dev/null | head -n1 || true)"
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
    # shellcheck disable=SC2086
    cid="$(docker compose $COMPOSE_FILES ps -aq "$1" 2>/dev/null | head -n1 || true)"
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
  case " $RECREATE " in *" webapp "*) MIGRATION="$(failed_migration)" ;; esac
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
  log "rolling back: docker compose $COMPOSE_FILES up -d --pull never --no-build --no-deps --force-recreate $RECREATE"
  if recreate_services "--pull never" "$RECREATE" && wait_ready "$RECREATE"; then
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
  log "docker compose $COMPOSE_FILES up -d --no-build --no-deps --force-recreate $RECREATE"
  up_ok=1
  recreate_services "" "$RECREATE" || up_ok=""
  # The versions for the status record, before a rollback re-tags anything.
  MAIN_SVC=webapp
  case " $RECREATE " in *" webapp "*) ;; *) MAIN_SVC="${RECREATE%% *}" ;; esac
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
if [ "$OUTCOME" = updated ] && [ "$MAIN_SVC" != webapp ]; then
  :
elif [ "$OUTCOME" != none ]; then
  severe=false
  if [ "$OUTCOME" = rollback_failed ] || [ -n "$MIGRATION" ]; then severe=true; fi
  shown_log="$LOG_FILE"
  # The webhook container's log, as the household finds it on the host
  # (docker-compose.diun.yml mounts /var/lib/kinboard-update there).
  [ "$LOG_FILE" != /var/log/kinboard-update.log ] || shown_log=/var/lib/kinboard-update/kinboard-update.log
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
