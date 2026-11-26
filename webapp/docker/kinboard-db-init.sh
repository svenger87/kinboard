#!/bin/sh
# kinboard-db-init: the one-shot database step of a one-file install
# (RFC-023 §4.1, §4.2). Run from the webapp image as
# `command: ["kinboard-db-init"]`, after `db` is healthy; `rest` and `webapp`
# wait for it to complete successfully.
#
#   1. Aligns `authenticator`'s password (PostgREST's login role, which the
#      supabase/postgres image creates with an empty one) with the database
#      password. The password is read from the secrets store by the
#      entrypoint's own rules and handed to psql as a variable, never pasted
#      into the SQL text, so any character in it is safe.
#   2. Applies the base schema, /app/initdb/init.sql (a byte-for-byte copy of
#      webapp/docker/init.sql), when `public.families` does not exist, in one
#      transaction: a failure leaves nothing that the check would mistake for
#      a finished schema, and the next start tries again. On an existing
#      database the check is false and nothing runs.
#
# The legacy webapp/docker/docker-compose.yml does not use this: its db-init
# keeps its own script, and its db applies init.sql from a bind mount.
set -eu

tag="[kinboard-db-init]"
HOST="${POSTGRES_HOST:-db}"
PORT="${POSTGRES_PORT:-5432}"
DB="${POSTGRES_DB:-postgres}"
# The bootstrap superuser of the supabase/postgres image: `postgres` is not
# one, and cannot alter the reserved `authenticator` role or install pg_cron.
ADMIN="${KINBOARD_DB_ADMIN:-supabase_admin}"
INIT_SQL="${KINBOARD_INIT_SQL:-/app/initdb/init.sql}"
READER="${KINBOARD_SECRETS_READER:-/app/secrets-store.mjs}"

if ! PGPASSWORD="$(node "$READER" --get POSTGRES_PASSWORD)"; then
  echo "$tag no database password in the environment or the secrets store; did kinboard-init run?" >&2
  exit 1
fi
export PGPASSWORD

admin_psql() {
  psql -X -h "$HOST" -p "$PORT" -U "$ADMIN" -d "$DB" "$@"
}

# On a first start the database reports healthy while its own init scripts
# are still running, before `authenticator` exists.
i=0
until [ "$(admin_psql -tAq -c "SELECT 1 FROM pg_roles WHERE rolname = 'authenticator'" 2>/tmp/db-init.err || true)" = "1" ]; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "$tag the role 'authenticator' still does not exist after 120 s, or $ADMIN cannot log in to $HOST:$PORT." >&2
    if [ -s /tmp/db-init.err ]; then
      echo "$tag the last error was: $(tail -n 1 /tmp/db-init.err)" >&2
    fi
    exit 1
  fi
  echo "$tag waiting for the database's roles to exist ($i)..."
  sleep 2
done

# \getenv reads the password from this process's environment into a psql
# variable; :'pw' quotes it as a literal on the client side, so the server
# receives it inside the statement. For that one transaction nothing that
# would record the statement does: not log_statement, not the error log
# (log_min_error_statement), not the slow-statement log, and not
# pg_stat_statements (a placeholder setting where the module is not loaded).
admin_psql -v ON_ERROR_STOP=1 -q <<'SQL'
\getenv pw PGPASSWORD
BEGIN;
SET LOCAL log_statement = 'none';
SET LOCAL log_min_error_statement = 'panic';
SET LOCAL log_min_duration_statement = -1;
SET LOCAL pg_stat_statements.track_utility = off;
ALTER ROLE authenticator WITH PASSWORD :'pw';
COMMIT;
SQL
echo "$tag authenticator password aligned."

if ! schema="$(admin_psql -tAq -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public.families') IS NOT NULL")"; then
  echo "$tag could not check for the base schema." >&2
  exit 1
fi
case "$schema" in
  t)
    echo "$tag base schema present; init.sql not applied."
    ;;
  f)
    echo "$tag empty database: applying the base schema (init.sql) in one transaction..."
    if ! admin_psql -v ON_ERROR_STOP=1 -q --single-transaction -f "$INIT_SQL" >/dev/null; then
      echo "$tag init.sql failed and was rolled back; the database is as empty as before. The next start tries again." >&2
      exit 1
    fi
    echo "$tag base schema applied."
    ;;
  *)
    echo "$tag unexpected answer checking for the base schema: '$schema'" >&2
    exit 1
    ;;
esac
