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
exec su-exec "$RUN_UID:$RUN_GID" sh /app/kinboard-db-init.sh
