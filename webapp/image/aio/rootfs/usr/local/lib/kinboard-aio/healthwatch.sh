#!/bin/sh
# healthwatch: the first healthy minute (RFC-024 §4.3 step 4, §4.7).
#
# Once /api/health has answered 200 for a minute without a miss:
#   - /data/config/updater/last-good records this version, so a later
#     version whose migrations fail names it as the one to go back to;
#   - a PostgreSQL major upgrade is confirmed: from now on the previous image
#     no longer puts the old cluster back (data has been written to this one),
#     and db.old can be deleted.
# Then it sleeps; s6 stops it with the rest.
exec 2>&1
. "$(dirname "$0")/common.sh"
# Everything it reads and writes is in the data folder: as its owner, never root.
if [ "$(id -u)" = 0 ]; then exec su-exec "$RUN_UID:$RUN_GID" "$0" "$@"; fi

healthy_since=""
while :; do
  if curl -sf -o /dev/null --max-time 10 "http://127.0.0.1:${PORT:-3000}/api/health"; then
    now="$(date +%s)"
    [ -n "$healthy_since" ] || healthy_since="$now"
    [ $((now - healthy_since)) -ge "${KINBOARD_HEALTHY_SECONDS:-60}" ] && break
  else
    healthy_since=""
  fi
  sleep 5
done

at="$(date -u +%FT%TZ)"
if kv_write "$STATE/last-good" "version=$version" "revision=$revision" "pg_major=$pg_major" "at=$at"; then
  log "healthy for a minute: $version recorded as the last version that ran healthy on this data"
else
  warn "healthy for a minute, but could not record it in $STATE/last-good"
fi
if [ "$(kv_get "$UPGRADE_STATE" phase)" = switched ] && [ -z "$(kv_get "$UPGRADE_STATE" confirmed_at)" ] \
   && [ "$(kv_get "$UPGRADE_STATE" to)" = "$CUR_MAJOR" ]; then
  if kv_write "$UPGRADE_STATE" "phase=switched" "from=$(kv_get "$UPGRADE_STATE" from)" "to=$(kv_get "$UPGRADE_STATE" to)" \
    "dump=$(kv_get "$UPGRADE_STATE" dump)" "at=$(kv_get "$UPGRADE_STATE" at)" "switched_at=$(kv_get "$UPGRADE_STATE" switched_at)" \
    "switched_epoch=$(kv_get "$UPGRADE_STATE" switched_epoch)" "confirmed_at=$at"; then
    log "the PostgreSQL $CUR_MAJOR upgrade is confirmed. $DB_OLD is no longer needed and can be deleted in Settings to free the space."
  else
    warn "could not record that the PostgreSQL $CUR_MAJOR upgrade is confirmed (disk full?); fix that, or going back to the previous image could set this database aside"
  fi
fi
exec s6-pause
