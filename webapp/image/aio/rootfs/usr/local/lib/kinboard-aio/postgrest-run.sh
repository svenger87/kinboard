#!/bin/sh
# PostgREST (RFC-024 §4.2.2): on 127.0.0.1:3010 only; the webapp's /rest/v1
# is the one way in. Its secrets by "@file", as compose.yml's.
exec 2>&1
. "$(dirname "$0")/common.sh"
exec su-exec "$RUN_UID:$RUN_GID" env \
  PGRST_DB_URI="@$SECRETS/db_uri" \
  PGRST_JWT_SECRET="@$SECRETS/jwt_secret" \
  PGRST_DB_SCHEMAS=public,graphql_public \
  PGRST_DB_ANON_ROLE=anon \
  PGRST_SERVER_HOST=127.0.0.1 \
  PGRST_SERVER_PORT=3010 \
  /usr/local/bin/postgrest
