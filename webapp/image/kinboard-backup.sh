#!/bin/sh
# kinboard-backup.sh: one verified database dump, or a non-zero exit
# (RFC-024 §4.7).
#
#   kinboard-backup.sh <folder> <prefix>
#
# Writes <folder>/<prefix>-<UTC stamp>.sql.gz, a pg_dumpall of the whole
# cluster (roles included), and prints its path on stdout. Used by the
# all-in-one image before any pending migration (webapp-entrypoint.sh, when
# KINBOARD_MIGRATE_BACKUP_DIR is set) and before a PostgreSQL major upgrade
# (aio/rootfs/usr/local/lib/kinboard-aio/pg-lib.sh). Compose installs are
# not affected: nothing there calls it.
#
# The checks are kinboard-self-update.sh's (its "BACKUP" step), because each
# one has caught a dump that was not a backup:
#   - the dump goes to a file and its exit status is checked, never piped
#     into gzip (a pipeline reports gzip's status, and a failed dump becomes a
#     plausible-looking small archive);
#   - it holds at least KINBOARD_BACKUP_MIN_TABLES `CREATE TABLE`s (50), the
#     families table and the PostgREST login role;
#   - the compressed file is tested (gzip -t) before it takes its real name,
#     so a half-written file is never mistaken for a backup.
# It is written under a dot-name and renamed only once verified; mode 0600,
# because a dump holds every family's data. The newest BACKUP_KEEP (5) of this
# prefix are kept.
#
# One backup at a time: with KINBOARD_BACKUP_LOCK set (the all-in-one image
# sets it), this waits for the lock the scheduled backups hold while they run
# (kinboard-scheduled-backup.mjs, started by the webapp), up to
# KINBOARD_BACKUP_LOCK_WAIT seconds (1800), and holds it until it exits. So
# kinboard-updater's dump before an update (taken with this script) waits for
# a scheduled backup to finish instead of running beside it, and the update
# then stops the container with no scheduled backup half written. The
# migrations' and the PostgreSQL upgrade's dumps run before the webapp starts,
# so nothing else holds it then.
#
# Env: PGHOST, PGPORT, PGUSER (the superuser, supabase_admin), PGPASSWORD;
# PG_DUMPALL (default pg_dumpall; the major upgrade passes the old major's
# server-matching client, or the newest), BACKUP_KEEP, KINBOARD_BACKUP_MIN_TABLES,
# KINBOARD_BACKUP_LOCK, KINBOARD_BACKUP_LOCK_WAIT.
set -u

dir="${1:-}"
prefix="${2:-}"
tag="[backup]"
case "$prefix" in
  "" | *[!a-z0-9-]*) echo "$tag usage: kinboard-backup.sh <folder> <prefix: a-z, 0-9, ->" >&2; exit 2 ;;
esac
[ -n "$dir" ] || { echo "$tag usage: kinboard-backup.sh <folder> <prefix>" >&2; exit 2; }

keep="${BACKUP_KEEP:-5}"
min_tables="${KINBOARD_BACKUP_MIN_TABLES:-50}"
dumpall="${PG_DUMPALL:-pg_dumpall}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$dir/$prefix-$stamp.sql.gz"
tmp_sql="$dir/.$prefix-$stamp.sql.partial"
tmp_gz="$dir/.$prefix-$stamp.sql.gz.partial"

cleanup() { rm -f "$tmp_sql" "$tmp_gz"; }
fail() { echo "$tag NOT VERIFIED: $*" >&2; cleanup; exit 1; }

umask 077
mkdir -p "$dir" 2>/dev/null || fail "cannot create the backup folder $dir"
[ -d "$dir" ] && [ -w "$dir" ] || fail "the backup folder $dir is not a writable folder"

lock="${KINBOARD_BACKUP_LOCK:-}"
if [ -n "$lock" ]; then
  lock_wait="${KINBOARD_BACKUP_LOCK_WAIT:-1800}"
  case "$lock_wait" in "" | *[!0-9]*) lock_wait=1800 ;; esac
  # Tried in a subshell first: a redirection that fails on `exec` ends the script.
  if ! command -v flock >/dev/null 2>&1; then
    echo "$tag no flock here: not waiting for a scheduled backup" >&2
  elif ! (: >>"$lock") 2>/dev/null; then
    echo "$tag cannot open the backup lock $lock: not waiting for a scheduled backup" >&2
  else
    exec 9>>"$lock"
    waited=0
    while ! flock -n 9; do
      [ "$waited" -eq 0 ] && echo "$tag a scheduled backup is running; waiting for it to finish (up to ${lock_wait}s)" >&2
      [ "$waited" -ge "$lock_wait" ] && fail "a scheduled backup still held the backup lock after ${lock_wait}s"
      sleep 2
      waited=$((waited + 2))
    done
  fi
fi

if ! "$dumpall" --no-password >"$tmp_sql" 2>"$tmp_sql.err"; then
  msg="$(tail -n 3 "$tmp_sql.err" 2>/dev/null | tr '\n' ' ')"
  rm -f "$tmp_sql.err"
  fail "pg_dumpall failed: $msg"
fi
rm -f "$tmp_sql.err"

tables="$(grep -c '^CREATE TABLE ' "$tmp_sql" 2>/dev/null || true)"
[ -n "$tables" ] || tables=0
[ "$tables" -ge "$min_tables" ] || fail "the dump has only $tables tables (at least $min_tables expected)"
grep -q '^CREATE TABLE public\.families ' "$tmp_sql" || fail "the dump has no public.families table"
grep -q '^CREATE ROLE authenticator;' "$tmp_sql" || fail "the dump has no authenticator role (not a whole-cluster dump?)"

gzip -c "$tmp_sql" >"$tmp_gz" || fail "could not compress the dump"
gzip -t "$tmp_gz" 2>/dev/null || fail "the compressed dump does not read back"
[ -s "$tmp_gz" ] || fail "the compressed dump is empty"
chmod 0600 "$tmp_gz"
sync "$tmp_gz" 2>/dev/null || sync
mv "$tmp_gz" "$final" || fail "could not rename the verified dump into place"
rm -f "$tmp_sql"
sync "$dir" 2>/dev/null || sync

# Keep the newest $keep of this prefix. The stamp sorts by time.
# shellcheck disable=SC2012
ls -1 "$dir" 2>/dev/null | grep -E "^$prefix-[0-9]{8}T[0-9]{6}Z\.sql\.gz\$" | sort -r | tail -n +"$((keep + 1))" | while read -r old; do
  rm -f "$dir/$old" && echo "$tag removed the old backup $old" >&2
done

echo "$tag verified: $final ($tables tables, $(wc -c <"$final" | tr -d ' ') bytes)" >&2
printf '%s\n' "$final"
