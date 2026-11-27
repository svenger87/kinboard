#!/bin/sh
# init-secrets: RFC-023's kinboard-init, unchanged, against /data (RFC-024
# §4.2.2): the environment wins, then the file in /data/config/secrets, then a
# generated value; the same refusals (a database password that disagrees with
# the cluster, a missing one for an existing cluster, a filesystem PostgreSQL
# can't use). Run as PUID:PGID with private modes: the secrets are 0600 in a
# 0700 folder, owned by the one user every process runs as (§6.3).
set -eu
. "$(dirname "$0")/common.sh"

cd /app
exec su-exec "$RUN_UID:$RUN_GID" env \
  KINBOARD_CONFIG_ROOT="$CONFIG" \
  KINBOARD_DB_MOUNT="$DB" \
  KINBOARD_SECRETS_PRIVATE=1 \
  node /app/kinboard-init.mjs
