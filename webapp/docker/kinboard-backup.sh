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
# Env: PGHOST, PGPORT, PGUSER (the superuser, supabase_admin), PGPASSWORD;
# PG_DUMPALL (default pg_dumpall; the major upgrade passes the old major's
# server-matching client, or the newest), BACKUP_KEEP, KINBOARD_BACKUP_MIN_TABLES.
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
