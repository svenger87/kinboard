#!/bin/sh
# The webapp: the image's own entrypoint, unchanged, started as root so it can
# hand the uploaded files to PUID:PGID; it runs the migrations (after a
# verified dump when any are pending, RFC-024 §4.7) and then the server as
# PUID:PGID with the internal scheduler (KINBOARD_SCHEDULER=internal).
exec 2>&1
. "$(dirname "$0")/common.sh"
umask "${UMASK:-022}"
cd /app
exec /app/webapp-entrypoint.sh
