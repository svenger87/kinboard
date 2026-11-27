#!/bin/sh
# db-ready: waits for PostgreSQL, then RFC-023's kinboard-db-init, unchanged
# (RFC-024 §4.2.2): on an empty cluster the role bootstrap
# (stock-postgres-bootstrap.sql) and init.sql, each in one transaction; on
# every start the check of the roles isolation depends on and of safeupdate,
# which refuses rather than serves. Runs as PUID:PGID.
set -eu
. "$(dirname "$0")/common.sh"

# Crash recovery after a power cut can take a while on a Raspberry Pi.
i=0
until pg_isready -q -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U supabase_admin -d postgres; do
  i=$((i + 1))
  if [ "$i" -gt 300 ]; then
    warn "PostgreSQL did not accept connections within 10 minutes; its log above says why."
    exit 1
  fi
  sleep 2
done

cd /app
# Then, an import cut off before its commit (the container killed, the power
# gone) is undone, before PostgREST and the webapp read the secrets it may
# have replaced (kinboard-transfer.mjs resumeAtStart). That never stops a
# start: the next `kinboard import` tries the same again.
exec su-exec "$RUN_UID:$RUN_GID" sh -c 'sh /app/kinboard-db-init.sh || exit 1
  node /app/kinboard-transfer.mjs resume || echo "[kinboard-aio] could not check for an import cut off before its commit; the next kinboard import does" >&2'
