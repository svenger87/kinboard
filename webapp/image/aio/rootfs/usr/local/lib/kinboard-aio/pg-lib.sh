# Sourced by init-perms (as root, for recover_switch only) and init-db (as
# PUID:PGID): the database folder's lifecycle in the all-in-one image
# (RFC-024 §4.2.2, §4.3, §4.4, §4.7).
#
# /data/db       the live cluster
# /data/db.init  a first initdb in progress; renamed to db when complete
# /data/db.new   a major upgrade's new cluster, until it has answered
# /data/db.old   the cluster before a major upgrade, kept until the new one
#                has run healthy for a minute (and after that, until the
#                household deletes it, in Settings or by hand)
# /data/config/updater/pg-upgrade   the upgrade's record (key=value):
#                phase=started|switching|switched|rolled_back|failed,
#                from, to, dump, at, switched_at, confirmed_at

# The options every cluster of this image is created with. The builtin
# C.UTF-8 provider (PostgreSQL 17) sorts by code point whatever the C library,
# so an index never changes order under a new musl, and a major upgrade's new
# cluster matches the old one exactly. Data checksums on, as PostgreSQL 18
# makes the default, so pg_upgrade finds the same setting on both sides.
INITDB_OPTS="--username=supabase_admin --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --locale-provider=builtin --builtin-locale=C.UTF-8 --locale=C.UTF-8"

pg_version_of() { tr -d '[:space:]' <"$1/PG_VERSION" 2>/dev/null; }

write_marker() {
  {
    echo "kinboard-aio"
    echo "major=$2"
    echo "libc=musl"
    echo "locale_provider=builtin"
    echo "created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$1/$MARKER_NAME"
  chmod 0600 "$1/$MARKER_NAME"
}

# A switch the upgrade did not finish (a power cut between its two renames):
# /data/db is gone, /data/db.old is the untouched previous cluster. Put it
# back; db.new is then a leftover, removed by init-db before anything else.
recover_switch() {
  [ -e "$DB" ] && return 0
  if [ -s "$DB_OLD/PG_VERSION" ]; then
    warn "a PostgreSQL major upgrade was interrupted while switching folders; putting the previous cluster back from $DB_OLD"
    if ! mv "$DB_OLD" "$DB"; then
      warn "REFUSED: could not rename $DB_OLD back to $DB. Rename it by hand (it holds the database), then start again."
      return 1
    fi
    sync_dir "$DATA"
    [ -f "$UPGRADE_STATE" ] && kv_write "$UPGRADE_STATE" "phase=failed" "from=$(kv_get "$UPGRADE_STATE" from)" \
      "to=$(kv_get "$UPGRADE_STATE" to)" "dump=$(kv_get "$UPGRADE_STATE" dump)" "at=$(date -u +%FT%TZ)" "reason=interrupted switch"
  fi
  return 0
}

# A temporary server on a private socket, no TCP: only this script reaches it.
TMP_SOCK=/run/kinboard-upgrade
tmp_start() {  # tmp_start <bin dir> <data dir> <port>
  "$1/pg_ctl" -D "$2" -w -t 600 -s \
    -o "-c listen_addresses='' -c unix_socket_directories=$TMP_SOCK -c port=$3 -c log_line_prefix='[pg-upgrade %m] '" start
}
tmp_stop() {  # tmp_stop <bin dir> <data dir>
  "$1/pg_ctl" -D "$2" -w -t 120 -s -m fast stop
}
tmp_psql() {  # tmp_psql <bin dir> <port> <sql>
  "$1/psql" -X -q -tA -v ON_ERROR_STOP=1 -h "$TMP_SOCK" -p "$2" -U supabase_admin -d postgres -c "$3"
}

# What must be the same before and after: tables, families, recorded
# migrations, and the roles isolation depends on.
FINGERPRINT_SQL="SELECT 'tables=' || (SELECT count(*) FROM pg_tables WHERE schemaname IN ('public', 'kinboard'))
  || ' families=' || (SELECT count(*) FROM public.families)
  || ' migrations=' || (SELECT count(*) FROM kinboard.schema_migrations)
  || ' roles=' || (SELECT string_agg(rolname || ':'
       || CASE WHEN rolsuper THEN 'S' ELSE 's' END || CASE WHEN rolbypassrls THEN 'B' ELSE 'b' END
       || CASE WHEN rolinherit THEN 'I' ELSE 'i' END || CASE WHEN rolcanlogin THEN 'L' ELSE 'l' END, ',' ORDER BY rolname)
       FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres'))"

# The major upgrade (§4.3, §4.7): never without a verified dump, the new
# cluster built in db.new with pg_upgrade in copy mode, and switched by rename
# only after it has answered. Any failure returns non-zero with /data/db as
# the previous image needs it; db.new is removed.
upgrade_cluster() {
  from="$1"
  to="$CUR_MAJOR"
  old_bin="$(pgbin "$from")"
  new_bin="$(pgbin "$to")"
  log "PostgreSQL major upgrade: the database is $from, this image runs $to. A verified dump first, then pg_upgrade into $DB_NEW; $DB is not changed until the new cluster answers."
  kv_write "$UPGRADE_STATE" "phase=started" "from=$from" "to=$to" "at=$(date -u +%FT%TZ)"

  upgrade_failed() {
    warn "PostgreSQL major upgrade from $from to $to FAILED: $1"
    if [ -n "${tmp_running:-}" ]; then tmp_stop "$tmp_running" "$tmp_data" >/dev/null 2>&1 || true; tmp_running=""; fi
    rm -rf "$DB_NEW"
    kv_write "$UPGRADE_STATE" "phase=failed" "from=$from" "to=$to" "dump=${dump:-}" "at=$(date -u +%FT%TZ)" "reason=$1"
    warn "$DB was not upgraded and is as PostgreSQL $from left it: the previous Kinboard image (the tag you ran before) starts on it as before.${dump:+ The verified dump from before this try: $dump}"
    return 1
  }

  # A leftover from an earlier try: never used live (it is only ever renamed
  # into place after it answered, and then it is no longer called db.new).
  rm -rf "$DB_NEW"

  # Room for a second copy of the cluster and the dump.
  need_kb="$(du -sk "$DB" | cut -f1)"
  avail_kb="$(df -Pk "$DATA" | awk 'NR == 2 { print $4 }')"
  want_kb=$((need_kb * 2 + 262144))
  if [ -z "$avail_kb" ] || [ "$avail_kb" -lt "$want_kb" ]; then
    upgrade_failed "not enough free space in $DATA: the upgrade needs about $((want_kb / 1024)) MB (a second copy of the $((need_kb / 1024)) MB database, and a dump), $((${avail_kb:-0} / 1024)) MB are free. Free space, or keep running the previous image."
    return 1
  fi

  # 1. The verified dump, from the old cluster on its own binaries.
  tmp_data="$DB"
  if ! tmp_start "$old_bin" "$DB" 50432; then upgrade_failed "the PostgreSQL $from server did not start on $DB"; return 1; fi
  tmp_running="$old_bin"
  if ! before="$(tmp_psql "$old_bin" 50432 "$FINGERPRINT_SQL")"; then upgrade_failed "could not read the database before the upgrade"; return 1; fi
  if ! dump="$(PGHOST="$TMP_SOCK" PGPORT=50432 PGUSER=supabase_admin PGDATABASE=postgres PG_DUMPALL="$new_bin/pg_dumpall" \
               sh /app/kinboard-backup.sh "$BACKUPS" "pre-pg$to-upgrade")"; then
    dump=""
    upgrade_failed "no verified dump, so no upgrade (the reason is above)"
    return 1
  fi
  if ! tmp_stop "$old_bin" "$DB"; then upgrade_failed "the PostgreSQL $from server did not stop cleanly"; return 1; fi
  tmp_running=""
  kv_write "$UPGRADE_STATE" "phase=started" "from=$from" "to=$to" "dump=$dump" "at=$(date -u +%FT%TZ)"

  # 2. The new cluster, with the old one's checksum setting.
  checksums="--data-checksums"
  if [ "$("$old_bin/pg_controldata" "$DB" | sed -n 's/^Data page checksum version: *//p')" = 0 ]; then
    checksums=""
    "$new_bin/initdb" --help | grep -q -- '--no-data-checksums' && checksums="--no-data-checksums"
  fi
  # shellcheck disable=SC2086
  if ! "$new_bin/initdb" -D "$DB_NEW" $INITDB_OPTS $checksums --pwfile="$SECRETS/postgres_password" >/dev/null; then
    upgrade_failed "initdb of the new cluster failed"; return 1
  fi
  work="$(mktemp -d "$DATA/.pg-upgrade-work.XXXXXX")" || { upgrade_failed "no work folder"; return 1; }
  run_upgrade() {
    ( cd "$work" && "$new_bin/pg_upgrade" --old-bindir="$old_bin" --new-bindir="$new_bin" \
        --old-datadir="$DB" --new-datadir="$DB_NEW" --username=supabase_admin --socketdir="$TMP_SOCK" \
        --old-port=50432 --new-port=50433 --copy "$@" )
  }
  if ! run_upgrade --check; then
    find "$DB_NEW" -path '*pg_upgrade_output.d*' -name '*.txt' -exec sh -c 'for f; do echo "--- $f"; head -n 20 "$f"; done' sh {} + 2>/dev/null >&2
    rm -rf "$work"; upgrade_failed "pg_upgrade --check refused this database (the reason is above)"; return 1
  fi
  if ! run_upgrade; then
    find "$DB_NEW" -path '*pg_upgrade_output.d*' -name '*.log' -exec tail -n 20 {} + 2>/dev/null >&2
    rm -rf "$work"; upgrade_failed "pg_upgrade failed (the reason is above)"; return 1
  fi
  rm -rf "$work"

  # 3. The new cluster must answer, load safeupdate, and hold the same data.
  tmp_data="$DB_NEW"
  if ! tmp_start "$new_bin" "$DB_NEW" 50433; then upgrade_failed "the upgraded cluster did not start"; return 1; fi
  tmp_running="$new_bin"
  # Every index rebuilt under the new major's Unicode tables: pg_upgrade warns
  # that relations using the builtin provider's case and class functions can
  # be affected by a Unicode update (17 to 18 is one). A family's database is
  # small; this takes seconds.
  if ! tmp_psql "$new_bin" 50433 "REINDEX DATABASE postgres" >/dev/null; then upgrade_failed "the upgraded cluster's indexes could not be rebuilt"; return 1; fi
  if ! after="$(tmp_psql "$new_bin" 50433 "$FINGERPRINT_SQL")"; then upgrade_failed "the upgraded cluster does not answer"; return 1; fi
  if [ "$after" != "$before" ]; then upgrade_failed "the upgraded cluster differs (before: $before; after: $after)"; return 1; fi
  if ! tmp_psql "$new_bin" 50433 "LOAD 'safeupdate'" >/dev/null; then
    upgrade_failed "the upgraded cluster cannot load safeupdate, which every PostgREST session needs"; return 1
  fi
  tmp_psql "$new_bin" 50433 "ANALYZE" >/dev/null || true
  if ! tmp_stop "$new_bin" "$DB_NEW"; then upgrade_failed "the upgraded cluster did not stop cleanly"; return 1; fi
  tmp_running=""
  rm -rf "$DB_NEW/pg_upgrade_output.d" "$DB_NEW"/delete_old_cluster.sh
  write_marker "$DB_NEW" "$to"
  sync

  # 4. The switch, by rename. recover_switch undoes a half-done one.
  # Every step checked: a half-done rm or a failed mv must never leave one
  # cluster inside the other with a record that says "switched".
  kv_write "$UPGRADE_STATE" "phase=switching" "from=$from" "to=$to" "dump=$dump" "at=$(date -u +%FT%TZ)" \
    || { upgrade_failed "could not write the upgrade's record"; return 1; }
  if [ -e "$DB_OLD" ]; then
    rm -rf "$DB_OLD"
    [ ! -e "$DB_OLD" ] || { upgrade_failed "could not remove an earlier $DB_OLD"; return 1; }
  fi
  mv "$DB" "$DB_OLD" || { upgrade_failed "could not rename $DB to $DB_OLD"; return 1; }
  if ! mv "$DB_NEW" "$DB"; then
    mv "$DB_OLD" "$DB" || warn "and could not put $DB_OLD back as $DB: rename it by hand"
    upgrade_failed "could not rename $DB_NEW to $DB"; return 1
  fi
  sync_dir "$DATA"
  kv_write "$UPGRADE_STATE" "phase=switched" "from=$from" "to=$to" "dump=$dump" "at=$(date -u +%FT%TZ)" \
    "switched_at=$(date -u +%FT%TZ)" "switched_epoch=$(date +%s)" "confirmed_at=" \
    || warn "the upgrade is done, but its record could not be written; going back to the previous image will be refused"
  log "PostgreSQL upgraded from $from to $to, the same before and after: $before. The previous cluster is kept as $DB_OLD: until this version has run healthy for a minute, going back to the previous image puts it back; after that it can be deleted."
  return 0
}

# The previous image's half of the upgrade (§4.3 step 4, §4.7): the folder is
# a newer major this image wrote no data into, and the upgrade's record says it
# never ran healthy for a minute. The newer cluster is set aside, not deleted.
# A refusal with a reason of its own sets ROLLBACK_REFUSAL for init-db.
rollback_unconfirmed() {
  found="$1"
  ROLLBACK_REFUSAL=""
  [ -f "$UPGRADE_STATE" ] || return 1
  [ "$(kv_get "$UPGRADE_STATE" phase)" = switched ] || return 1
  [ "$(kv_get "$UPGRADE_STATE" from)" = "$CUR_MAJOR" ] || return 1
  [ "$(kv_get "$UPGRADE_STATE" to)" = "$found" ] || return 1
  [ -z "$(kv_get "$UPGRADE_STATE" confirmed_at)" ] || return 1
  # The folder to go back to was deleted (Settings deletes it only after the
  # window below, or by hand): nothing to put back, and nothing is moved.
  if [ ! -e "$DB_OLD" ] && [ ! -L "$DB_OLD" ]; then
    ROLLBACK_REFUSAL="$DB is PostgreSQL $found, newer than this image's $CUR_MAJOR, and the database from before that upgrade ($DB_OLD) is no longer there: it was deleted, so there is nothing to go back to. Run the newer Kinboard image again."
    return 1
  fi
  [ "$(pg_version_of "$DB_OLD")" = "$CUR_MAJOR" ] || return 1
  [ -f "$DB_OLD/$MARKER_NAME" ] || return 1
  # Only soon after the switch. "Never healthy for a minute" is the RFC's
  # sign that the new version never really ran (§4.3 step 4), but a version
  # that serves families while its health check fails would keep writing for
  # days; past this window, going back is refused and says how, rather than
  # quietly setting those writes aside.
  switched="$(kv_get "$UPGRADE_STATE" switched_epoch)"
  case "$switched" in "" | *[!0-9]*) switched="" ;; esac
  # A clock that went backwards (a Raspberry Pi without a real-time clock,
  # before NTP) gives a negative age: outside the window, not inside it.
  if [ -n "$switched" ] && [ "$(date +%s)" -lt "$switched" ]; then switched=""; fi
  window="${KINBOARD_PG_ROLLBACK_WINDOW:-86400}"
  if [ "${KINBOARD_PG_ROLLBACK:-}" != 1 ] && { [ -z "$switched" ] || [ $(( $(date +%s) - switched )) -gt "$window" ]; }; then
    warn "the upgrade to PostgreSQL $found was never confirmed, but it is more than $((window / 3600)) hours old: Kinboard may have written to it since. Not going back on its own; set KINBOARD_PG_ROLLBACK=1 to put $DB_OLD back anyway (the PostgreSQL $found cluster is kept aside, not deleted)."
    return 1
  fi
  aside="$DATA/db.failed-pg$found-$(stamp)"
  warn "the database was upgraded to PostgreSQL $found, but that version never ran healthy for a minute; going back: $DB_OLD becomes $DB again, the PostgreSQL $found cluster is kept as $aside (whatever was written to it is there)"
  mv "$DB" "$aside" || { warn "could not set $DB aside"; return 1; }
  if ! mv "$DB_OLD" "$DB"; then
    mv "$aside" "$DB" || true
    warn "could not rename $DB_OLD to $DB"; return 1
  fi
  sync_dir "$DATA"
  kv_write "$UPGRADE_STATE" "phase=rolled_back" "from=$CUR_MAJOR" "to=$found" "dump=$(kv_get "$UPGRADE_STATE" dump)" \
    "at=$(date -u +%FT%TZ)" "set_aside=$aside"
  return 0
}
