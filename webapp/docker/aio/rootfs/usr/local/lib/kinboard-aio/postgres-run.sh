#!/bin/sh
# The PostgreSQL server (RFC-024 §4.2.2): as PUID:PGID, on 127.0.0.1 and the
# socket folder only. Its s6 service stops it with SIGINT (fast shutdown: a
# clean checkpoint, no recovery on the next start) within timeout-down.
exec 2>&1
. "$(dirname "$0")/common.sh"
umask 077
exec su-exec "$RUN_UID:$RUN_GID" "$(pgbin "$CUR_MAJOR")/postgres" -D "$DB" \
  -c listen_addresses=127.0.0.1 \
  -c port="$POSTGRES_PORT" \
  -c unix_socket_directories="$SOCKET_DIR" \
  -c unix_socket_permissions=0700 \
  -c logging_collector=off \
  -c log_line_prefix='%m [%p] ' \
  -c log_timezone=UTC
