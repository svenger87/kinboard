# Sourced by every kinboard-aio start step and service (RFC-024 §4.2.2).
# Paths, the image's build record, and small helpers. No side effects.

# shellcheck disable=SC2034  # used by the scripts that source this
# shellcheck source=/dev/null
. "${KINBOARD_AIO_BUILD:-/etc/kinboard-aio/build}"

DATA="${KINBOARD_DATA:-/data}"
DB="$DATA/db"
DB_NEW="$DATA/db.new"
DB_OLD="$DATA/db.old"
DB_INIT="$DATA/db.init"
CONFIG="$DATA/config"
SECRETS="$CONFIG/secrets"
STATE="$CONFIG/updater"
UPGRADE_STATE="$STATE/pg-upgrade"
BACKUPS="$DATA/backups"
STORAGE="$DATA/storage"
SOCKET_DIR=/run/postgresql
MARKER_NAME=KINBOARD_AIO

# The image's own major (pg_major from the build record) and the binaries of a major.
CUR_MAJOR="$pg_major"
pgbin() { echo "/usr/libexec/postgresql$1"; }
has_major() { [ -x "$(pgbin "$1")/postgres" ]; }

log() { echo "[kinboard-aio] $*"; }
warn() { echo "[kinboard-aio] $*" >&2; }

# The ids every process runs as (§6.3). Checked by init-perms; here only read.
RUN_UID="${PUID:-1000}"
RUN_GID="${PGID:-1000}"
# As PUID:PGID: from root through su-exec, already that user otherwise.
as_user() {
  if [ "$(id -u)" = 0 ]; then su-exec "$RUN_UID:$RUN_GID" "$@"; else "$@"; fi
}

# key=value files, as the start records are kept (one value per key, no quoting).
kv_get() { sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n 1; }
# kv_write <file> key=value...: through a temporary file and a rename. Only
# ever called as PUID:PGID, the owner of /data (never as root, who would write
# wherever a planted link points); it still refuses a symlink in its place.
kv_write() {
  f="$1"; shift
  if [ "$(id -u)" = 0 ]; then warn "kv_write $f as root refused"; return 1; fi
  if [ -L "$f" ] || [ -L "$(dirname "$f")" ]; then warn "refusing to write $f: it is a symlink"; return 1; fi
  mkdir -p "$(dirname "$f")" || return 1
  t="$(mktemp "$f.tmp.XXXXXX")" || return 1
  for pair in "$@"; do printf '%s\n' "$pair" >>"$t"; done
  mv -f "$t" "$f"
}

# fsync a directory's entries after a rename (busybox sync takes a path).
sync_dir() { sync "$1" 2>/dev/null || sync; }

stamp() { date -u +%Y%m%dT%H%M%SZ; }

# Stops the container (S6_BEHAVIOUR_IF_STAGE2_FAILS=2 does the same for a
# failed start step); the reason is already in the log.
halt_container() {
  warn "stopping the container."
  /run/s6/basedir/bin/halt 2>/dev/null || kill -TERM 1
}
