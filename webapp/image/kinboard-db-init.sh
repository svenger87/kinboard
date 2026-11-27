#!/bin/sh
# kinboard-db-init: the one-shot database step of a one-file install
# (RFC-023 §4.1, §4.2). Run from the webapp image as
# `command: ["kinboard-db-init"]`, after `db` is healthy; `rest` and `webapp`
# wait for it to complete successfully.
#
#   0. Tells the two database images apart (RFC-024 §4.5). supabase/postgres
#      (every existing install) creates the API roles itself; nothing below
#      changes for it. Stock PostgreSQL (kinboard-postgres:17, new installs)
#      gets the role bootstrap (stock-postgres-bootstrap.sql, RFC-024 §4.2.1)
#      in one transaction the first time, and on every start a check of the
#      attributes isolation depends on; a database that can't load safeupdate
#      is refused before anything is created.
#   1. Aligns `authenticator`'s password (PostgREST's login role, which the
#      supabase/postgres image creates with an empty one) with the database
#      password; on stock PostgreSQL `postgres`'s too, which no image init
#      sets there. The password is read from the secrets store by the
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
BOOTSTRAP_SQL="${KINBOARD_BOOTSTRAP_SQL:-/app/initdb/stock-postgres-bootstrap.sql}"
READER="${KINBOARD_SECRETS_READER:-/app/secrets-store.mjs}"

if ! PGPASSWORD="$(node "$READER" --get POSTGRES_PASSWORD)"; then
  echo "$tag no database password in the environment or the secrets store; did kinboard-init run?" >&2
  exit 1
fi
export PGPASSWORD

admin_psql() {
  psql -X -h "$HOST" -p "$PORT" -U "$ADMIN" -d "$DB" "$@"
}

# On a first start the database reports healthy over its socket while its own
# init scripts are still running, before it listens on the network.
i=0
until [ "$(admin_psql -tAq -c "SELECT 1" 2>/tmp/db-init.err || true)" = "1" ]; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "$tag $ADMIN still cannot log in to $HOST:$PORT after 120 s." >&2
    if [ -s /tmp/db-init.err ]; then
      echo "$tag the last error was: $(tail -n 1 /tmp/db-init.err)" >&2
    fi
    exit 1
  fi
  # A refused login won't fix itself by waiting: the server is up, and the
  # password or the superuser's name is wrong (a database image that doesn't
  # create supabase_admin, or a password file that isn't this database's).
  if grep -qE 'password authentication failed|role "[^"]*" does not exist' /tmp/db-init.err 2>/dev/null; then
    echo "$tag the database refused $ADMIN: $(tail -n 1 /tmp/db-init.err)" >&2
    echo "$tag Kinboard's database image creates $ADMIN with the stored password on its first start; this one did not." >&2
    exit 1
  fi
  echo "$tag waiting for the database to accept connections ($i)..."
  sleep 2
done

# Which image. supabase/postgres ships its own extensions (supabase_vault,
# pg_graphql) as files on disk, there from the first second whatever its init
# scripts have done so far; stock PostgreSQL has neither. Asked of the files,
# not of the roles, because on supabase/postgres the roles may not exist yet.
if ! flavour="$(admin_psql -tAq -v ON_ERROR_STOP=1 -c "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_available_extensions WHERE name IN ('supabase_vault', 'pg_graphql')) THEN 'supabase' ELSE 'stock' END")"; then
  echo "$tag could not tell which database image this is." >&2
  exit 1
fi

case "$flavour" in
  supabase)
    # Its init scripts create the roles; wait until they have.
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
    ;;
  stock)
    echo "$tag stock PostgreSQL: checking the roles PostgREST and the policies rely on."
    # Without safeupdate, a filterless UPDATE or DELETE through PostgREST
    # would empty a table across every family; supabase/postgres refuses it,
    # and no new install may be weaker (RFC-024 §11.12). Checked before
    # anything is created, so a plain postgres image stops here, untouched.
    if ! admin_psql -tAq -c "LOAD 'safeupdate'" >/dev/null 2>/tmp/db-init.err; then
      echo "$tag this PostgreSQL can't load safeupdate ($(tail -n 1 /tmp/db-init.err))." >&2
      echo "$tag Kinboard on stock PostgreSQL needs the kinboard-postgres image, which carries it; a plain postgres image is refused. Nothing was changed." >&2
      exit 1
    fi
    if ! has_roles="$(admin_psql -tAq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_roles WHERE rolname = 'authenticator'")"; then
      echo "$tag could not check for the roles." >&2
      exit 1
    fi
    if [ "$has_roles" = "0" ]; then
      echo "$tag empty database: creating the roles, default privileges, extensions schema and publication in one transaction..."
      # The same care as the password below: the bootstrap gives `postgres`
      # and `authenticator` the password, as a psql variable, with nothing
      # that would record the statement switched on.
      if ! admin_psql -v ON_ERROR_STOP=1 -q -v "bootstrap=$BOOTSTRAP_SQL" <<'SQL'
\getenv pw PGPASSWORD
BEGIN;
SET LOCAL log_statement = 'none';
SET LOCAL log_min_error_statement = 'panic';
SET LOCAL log_min_duration_statement = -1;
SET LOCAL pg_stat_statements.track_utility = off;
\i :bootstrap
COMMIT;
SQL
      then
        echo "$tag the role bootstrap failed and was rolled back; the database is as empty as before. The next start tries again." >&2
        exit 1
      fi
      echo "$tag roles created."
    fi
    # On every start: the attributes whose loss would be silent. A wrong
    # BYPASSRLS shows one family another's rows; an INHERIT on authenticator
    # hands its sessions rights before the role switch; a missing preload
    # lets a filterless write through. Refuse rather than serve.
    if ! problems="$(admin_psql -tAq -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'the role ' || r || ' is missing'
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role', 'authenticator', 'postgres']) AS r
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
UNION ALL
SELECT rolname || ' is a superuser' FROM pg_roles
 WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres') AND rolsuper
UNION ALL
SELECT rolname || ' bypasses row-level security' FROM pg_roles
 WHERE rolname IN ('anon', 'authenticated', 'authenticator') AND rolbypassrls
UNION ALL
SELECT 'service_role does not bypass row-level security' FROM pg_roles
 WHERE rolname = 'service_role' AND NOT rolbypassrls
UNION ALL
SELECT 'authenticator inherits its members'' rights' FROM pg_roles
 WHERE rolname = 'authenticator' AND rolinherit
UNION ALL
SELECT rolname || ' can log in, create roles or databases, or replicate' FROM pg_roles
 WHERE rolname IN ('anon', 'authenticated', 'service_role')
   AND (rolcanlogin OR rolcreaterole OR rolcreatedb OR rolreplication)
UNION ALL
SELECT 'authenticator can create roles or databases, or replicate' FROM pg_roles
 WHERE rolname = 'authenticator' AND (rolcreaterole OR rolcreatedb OR rolreplication)
UNION ALL
SELECT m.rolname || ' is a member of ' || g.rolname
  FROM pg_auth_members a JOIN pg_roles m ON m.oid = a.member JOIN pg_roles g ON g.oid = a.roleid
 WHERE m.rolname IN ('anon', 'authenticated', 'service_role')
UNION ALL
-- PostgREST's role switch and nothing else: SET ROLE reaches every role
-- authenticator is a member of.
SELECT 'authenticator is a member of ' || g.rolname
  FROM pg_auth_members a JOIN pg_roles m ON m.oid = a.member JOIN pg_roles g ON g.oid = a.roleid
 WHERE m.rolname = 'authenticator' AND g.rolname NOT IN ('anon', 'authenticated', 'service_role')
UNION ALL
-- From PostgreSQL 16 a membership inherits by its own option, not by the
-- member's INHERIT (on 15 the column is absent and the member's decides).
SELECT 'authenticator holds the rights of ' || g.rolname || ' before the role switch'
  FROM pg_auth_members a JOIN pg_roles m ON m.oid = a.member JOIN pg_roles g ON g.oid = a.roleid
 WHERE m.rolname = 'authenticator' AND coalesce((to_jsonb(a) ->> 'inherit_option')::boolean, m.rolinherit)
UNION ALL
-- ADMIN OPTION on an API role would let its holder alter it or hand it out.
SELECT m.rolname || ' holds ADMIN OPTION on ' || g.rolname
  FROM pg_auth_members a JOIN pg_roles m ON m.oid = a.member JOIN pg_roles g ON g.oid = a.roleid
 WHERE a.admin_option AND g.rolname IN ('anon', 'authenticated', 'service_role', 'authenticator')
UNION ALL
-- A setting for one database overrides the role's own.
SELECT 'authenticator''s session_preload_libraries in database ' || d.datname || ' leaves out safeupdate'
  FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole JOIN pg_database d ON d.oid = s.setdatabase,
       unnest(s.setconfig) AS c
 WHERE r.rolname = 'authenticator' AND c LIKE 'session_preload_libraries=%'
   AND c !~ '^session_preload_libraries=(.*[ ,])?"?safeupdate"?($|[ ,])'
UNION ALL
SELECT 'authenticator does not preload safeupdate'
 WHERE NOT EXISTS (
   SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole, unnest(s.setconfig) AS c
    WHERE r.rolname = 'authenticator' AND s.setdatabase = 0
      AND c ~ '^session_preload_libraries=(.*[ ,])?"?safeupdate"?($|[ ,])')
UNION ALL
SELECT 'uuid-ossp is not in the extensions schema' FROM pg_extension e
 WHERE e.extname = 'uuid-ossp' AND e.extnamespace::regnamespace::text <> 'extensions'
UNION ALL
SELECT 'the publication supabase_realtime is missing or not owned by postgres'
 WHERE NOT EXISTS (
   SELECT 1 FROM pg_publication p JOIN pg_roles o ON o.oid = p.pubowner
    WHERE p.pubname = 'supabase_realtime' AND o.rolname = 'postgres');
SQL
)"; then
      echo "$tag could not check the roles." >&2
      exit 1
    fi
    if [ -n "$problems" ]; then
      echo "$tag REFUSED: this database's roles are not what Kinboard's row-level security relies on:" >&2
      printf '%s\n' "$problems" | sed "s/^/$tag   - /" >&2
      echo "$tag Nothing was changed. Fix the roles above as the superuser, or start a new install on an empty database folder." >&2
      exit 1
    fi
    echo "$tag roles checked."
    ;;
  *)
    echo "$tag unexpected answer telling the database image apart: '$flavour'" >&2
    exit 1
    ;;
esac

# \getenv reads the password from this process's environment into a psql
# variable; :'pw' quotes it as a literal on the client side, so the server
# receives it inside the statement. For that one transaction nothing that
# would record the statement does: not log_statement, not the error log
# (log_min_error_statement), not the slow-statement log, and not
# pg_stat_statements (a placeholder setting where the module is not loaded).
stock=false
if [ "$flavour" = stock ]; then stock=true; fi
admin_psql -v ON_ERROR_STOP=1 -q -v "stock=$stock" <<'SQL'
\getenv pw PGPASSWORD
BEGIN;
SET LOCAL log_statement = 'none';
SET LOCAL log_min_error_statement = 'panic';
SET LOCAL log_min_duration_statement = -1;
SET LOCAL pg_stat_statements.track_utility = off;
ALTER ROLE authenticator WITH PASSWORD :'pw';
\if :stock
ALTER ROLE postgres WITH PASSWORD :'pw';
\endif
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
