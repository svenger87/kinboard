#!/bin/sh
# init-perms: the only start step that runs as root (RFC-024 §6.3).
#
#   - PUID and PGID: numbers, not 0. Every long-running process, PostgreSQL
#     included, runs as them (1000:1000 by default; Unraid's template sets
#     99:100). An account and a group are added for ids the image does not
#     know, because initdb and PostgreSQL look their user up by id.
#   - /data/{db,storage/files,config,backups}: created, and handed to
#     PUID:PGID when a folder's owner differs (the first start, a changed
#     PUID, or a restore copied in as root). Unchanged ownership touches
#     nothing, so a large photo folder is walked once, not on every start.
#   - The modes: /data/db 0700 (PostgreSQL refuses anything looser), config
#     0700 (it holds the secrets).
#   - /run/postgresql, the server's socket folder: 0700, so only PUID (and
#     root, for `docker exec … psql`) can reach the socket, where local logins
#     are trusted. That uid owns the data files anyway.
set -eu
. "$(dirname "$0")/common.sh"
. "$(dirname "$0")/pg-lib.sh"

for pair in "PUID=$RUN_UID" "PGID=$RUN_GID"; do
  case "${pair#*=}" in
    "" | *[!0-9]* | 0?*) warn "${pair%%=*} must be a number (a user or group id) without leading zeros, got '${pair#*=}'; refusing to start."; exit 1 ;;
  esac
done
# 65534 is reserved: `kinboard import` unpacks archives as it (kinboard-transfer.mjs).
if [ "$RUN_UID" = 65534 ] || [ "$RUN_GID" = 65534 ]; then
  warn "PUID and PGID must not be 65534 (nobody): Kinboard unpacks imported archives as that user. Use the id of the user that owns your data folder."
  exit 1
fi
if [ "$RUN_UID" = 0 ] || [ "$RUN_GID" = 0 ]; then
  warn "PUID and PGID must not be 0: PostgreSQL does not run as root. Use the id of the user that owns your data folder (Unraid: 99 and 100)."
  exit 1
fi

# Accounts for ids the image does not have. A container keeps its own
# /etc/passwd across restarts, so a `kinboard` entry from a previous PUID is
# replaced, never added twice.
sed -i '/^kinboard:/d' /etc/passwd /etc/group /etc/shadow 2>/dev/null || true
if ! awk -F: -v g="$RUN_GID" '$3 == g { found = 1 } END { exit !found }' /etc/group; then
  echo "kinboard:x:$RUN_GID:" >>/etc/group
fi
if ! awk -F: -v u="$RUN_UID" '$3 == u { found = 1 } END { exit !found }' /etc/passwd; then
  echo "kinboard:x:$RUN_UID:$RUN_GID:Kinboard:$DATA:/sbin/nologin" >>/etc/passwd
fi
log "running as $RUN_UID:$RUN_GID ($(awk -F: -v u="$RUN_UID" '$3 == u { print $1; exit }' /etc/passwd))"

if [ -e "$DATA" ] && [ ! -d "$DATA" ]; then
  warn "$DATA is not a folder. Mount a folder (or a volume) at $DATA."
  exit 1
fi
mkdir -p "$DATA"

# A folder (or volume) mounted read-only, or on a filesystem that refuses
# writes, is found here rather than half-way through initdb.
if ! probe="$(mktemp "$DATA/.kinboard-write-test.XXXXXX" 2>/dev/null)"; then
  warn "$DATA is not writable. Mount it read-write."
  exit 1
fi
rm -f "$probe"

# Root follows nothing the data folder's user could have planted: its top
# folders must be folders, not symlinks.
for d in db db.old db.new db.init storage storage/files config config/secrets config/updater backups; do
  if [ -L "$DATA/$d" ]; then
    warn "$DATA/$d is a symlink. Kinboard keeps its data in plain folders under $DATA; replace it with the folder itself."
    exit 1
  fi
done

owner="$RUN_UID:$RUN_GID"
if [ "$(stat -c %u:%g "$DATA")" != "$owner" ]; then
  chown -h "$owner" "$DATA"
fi

# Before /data/db is created below: a major upgrade cut off between its two
# renames left no db, and the previous cluster in db.old (pg-lib.sh). As the
# data's owner, like every move and write under /data: root itself only ever
# creates folders that are missing and hands them over.
as_user sh -c '. "$1/common.sh"; . "$1/pg-lib.sh"; recover_switch' sh "$(dirname "$0")" || exit 1
for d in db storage storage/files config config/updater backups; do
  [ -d "$DATA/$d" ] || { mkdir -p "$DATA/$d"; chown -h "$owner" "$DATA/$d"; }
done
# Each top folder, and whatever is under it, once its owner differs. The
# database, config and backup folders are also searched for a stray file of
# another owner (PostgreSQL refuses to start over one); the uploaded files only
# by their top folder, so thousands of photos are not walked on every start.
# db.old and db.new belong to the same user (the upgrade, §4.3).
for d in db db.old db.new storage config backups; do
  p="$DATA/$d"
  [ -d "$p" ] || continue
  stray=""
  [ "$d" = storage ] || stray="$(find "$p" \( ! -user "$RUN_UID" -o ! -group "$RUN_GID" \) -print -quit 2>/dev/null)"
  if [ "$(stat -c %u:%g "$p")" != "$owner" ] || [ -n "$stray" ]; then
    log "handing $p to $owner"
    # -h: a symlink planted under /data is changed itself, never what it points at.
    chown -R -h "$owner" "$p"
  fi
done
# As their owner: a chmod as root would follow a link swapped in after the check above.
as_user chmod 0700 "$DATA/db" "$DATA/config"
[ -d "$DB_OLD" ] && as_user chmod 0700 "$DB_OLD"
[ -d "$DB_NEW" ] && as_user chmod 0700 "$DB_NEW"

# The server's socket, and the private one a major upgrade's temporary
# servers listen on (pg-lib.sh).
for d in "$SOCKET_DIR" "$TMP_SOCK"; do
  mkdir -p "$d"
  chown -h "$owner" "$d"
  chmod 0700 "$d"
done

log "data folder $DATA ready"
