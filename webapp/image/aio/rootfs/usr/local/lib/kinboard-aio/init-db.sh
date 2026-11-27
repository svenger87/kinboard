#!/bin/sh
# init-db: what /data/db holds decides what happens before PostgreSQL starts
# (RFC-024 §4.2.2, §4.3, §4.4, §4.7). Runs as PUID:PGID.
#
#   empty                    initdb, into db.init, renamed to db when complete
#   this image's major       start as is (and say once that db.old can go)
#   an older major           the major upgrade (pg-lib.sh), if this image
#                            carries that major's binaries; otherwise refused
#   a newer major            a rollback: if the upgrade that wrote it never ran
#                            healthy for a minute, the previous cluster is put
#                            back; otherwise refused, with what to do
#   a folder another image   refused: a compose install's supabase/postgres
#   wrote (no marker)        folder (glibc, PostgreSQL 15) is never opened here;
#                            moving between the shapes is `kinboard export` and
#                            `kinboard import` (§4.4)
#
# A refusal exits non-zero, and the container stops with the reason as the
# last lines of its log (S6_BEHAVIOUR_IF_STAGE2_FAILS=2). Nothing in /data/db
# is changed by a refusal.
set -u
. "$(dirname "$0")/common.sh"
. "$(dirname "$0")/pg-lib.sh"
# s6 runs start steps as root; this one works as the data's owner.
if [ "$(id -u)" = 0 ]; then exec su-exec "$RUN_UID:$RUN_GID" "$0" "$@"; fi
umask 077

HOWTO="https://github.com/svenger87/kinboard/wiki/All-in-one"
refuse() {
  warn "REFUSED: $1"
  warn "Nothing in $DB was changed. See $HOWTO"
  exit 1
}

# A first initdb cut off half-way never held data.
if [ -d "$DB_INIT" ]; then
  log "removing $DB_INIT, an initdb that did not finish"
  rm -rf "$DB_INIT"
fi
# db.new is only ever an upgrade in progress; this is a new start.
if [ -d "$DB_NEW" ] && [ -d "$DB" ]; then
  log "removing $DB_NEW, a PostgreSQL upgrade that did not finish ($DB was not touched by it)"
  rm -rf "$DB_NEW"
fi

[ -d "$DB" ] || refuse "$DB is missing"

if [ ! -s "$DB/PG_VERSION" ]; then
  if [ -n "$(ls -A "$DB" 2>/dev/null)" ]; then
    refuse "$DB holds files but no PostgreSQL cluster (no PG_VERSION). Empty it if this is a new install, or restore the folder from a backup."
  fi
  # Never a new cluster while an older one waits beside it: that is a switch
  # that could not be put back, or a rollback's leftover, and a new database
  # here would hide the real one (and a later upgrade would remove db.old).
  for other in "$DB_OLD" "$DATA"/db.failed-pg*; do
    if [ -s "$other/PG_VERSION" ]; then
      refuse "$DB is empty, but $other holds a PostgreSQL $(pg_version_of "$other") cluster. If that is this install's database, rename it to $DB; if it is not needed, move it out of $DATA. Kinboard does not create a new database beside it."
    fi
  done
  log "new install: creating the PostgreSQL $CUR_MAJOR cluster"
  [ -s "$SECRETS/postgres_password" ] || refuse "no database password in $SECRETS (init-secrets did not run?)"
  # shellcheck disable=SC2086
  if ! "$(pgbin "$CUR_MAJOR")/initdb" -D "$DB_INIT" $INITDB_OPTS --data-checksums --pwfile="$SECRETS/postgres_password" >/dev/null; then
    rm -rf "$DB_INIT"
    warn "initdb failed; the next start tries again."
    exit 1
  fi
  write_marker "$DB_INIT" "$CUR_MAJOR"
  sync
  rmdir "$DB" && mv "$DB_INIT" "$DB" || { warn "could not move the new cluster into $DB"; exit 1; }
  sync_dir "$DATA"
  log "PostgreSQL $CUR_MAJOR cluster created in $DB"
  exit 0
fi

found="$(pg_version_of "$DB")"
case "$found" in *[!0-9]* | "") refuse "$DB/PG_VERSION does not name a PostgreSQL major ('$found')" ;; esac

if [ ! -f "$DB/$MARKER_NAME" ]; then
  refuse "$DB holds a PostgreSQL $found cluster that this image did not create (no $MARKER_NAME marker): most likely a compose install's database folder. A data folder from another image is never opened here, because text indexes built under another C library can be silently out of order. Move an install with 'kinboard export' on the old one and 'kinboard import' on this one."
fi

if [ "$found" = "$CUR_MAJOR" ]; then
  phase="$(kv_get "$UPGRADE_STATE" phase)"
  if [ -d "$DB_OLD" ] && [ "$phase" = switched ] && [ -n "$(kv_get "$UPGRADE_STATE" confirmed_at)" ]; then
    log "$DB_OLD (PostgreSQL $(pg_version_of "$DB_OLD"), $(du -sm "$DB_OLD" | cut -f1) MB) is the cluster from before the upgrade to $CUR_MAJOR, which has run healthy since $(kv_get "$UPGRADE_STATE" confirmed_at). It is no longer needed: delete it in Settings (the install's family, with the settings PIN) or delete the folder, to free the space."
  fi
  exit 0
fi

if [ "$found" -lt "$CUR_MAJOR" ]; then
  if ! has_major "$found"; then
    refuse "$DB is PostgreSQL $found, and this image runs $CUR_MAJOR without $found's programs, so it cannot upgrade it. Start a Kinboard version that carries both first (the release notes of the version that moved to PostgreSQL $CUR_MAJOR say which), or move with 'kinboard export' and 'kinboard import'."
  fi
  if [ "${KINBOARD_PG_UPGRADE:-auto}" = off ]; then
    refuse "$DB is PostgreSQL $found and this image runs $CUR_MAJOR; KINBOARD_PG_UPGRADE=off, so it was not upgraded. Run the previous image, or remove the setting to upgrade (a verified dump is taken first)."
  fi
  upgrade_cluster "$found" || exit 1
  exit 0
fi

# A newer major than this image: the household went back to a previous tag.
if rollback_unconfirmed "$found"; then
  exit 0
fi
detail=""
if [ "$(kv_get "$UPGRADE_STATE" to)" = "$found" ] && [ -n "$(kv_get "$UPGRADE_STATE" dump)" ]; then
  detail=" The verified dump taken before that upgrade is $(kv_get "$UPGRADE_STATE" dump)."
fi
[ -z "${ROLLBACK_REFUSAL:-}" ] || refuse "$ROLLBACK_REFUSAL$detail"
refuse "$DB is PostgreSQL $found, newer than this image's $CUR_MAJOR, and has been in use since its upgrade, so going back would lose what was written there. Run the newer Kinboard image again.$detail"
