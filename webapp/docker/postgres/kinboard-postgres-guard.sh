#!/bin/sh
# kinboard-postgres-guard: refuses a data directory this image did not create,
# then hands over to the official entrypoint (RFC-024 §4.4, §11.4).
#
# A data directory opens only under the major version that wrote it, and even
# at the same major it is not safe under another C library: supabase/postgres
# is built against glibc, this image against musl, and a text index built
# under one can be out of order under the other, which corrupts lookups
# without an error. So two refusals, before PostgreSQL sees the directory:
#
#   - PG_VERSION names another major (an existing compose install's
#     supabase/postgres 15 directory, the case that matters): refused;
#   - the right major, but no marker from this image (a directory from
#     supabase/postgres 17, or from Debian's postgres:17): refused.
#
# The marker is written by /docker-entrypoint-initdb.d/00-kinboard-marker.sh,
# which the official entrypoint runs once, when it creates the directory.
# Nothing here writes to an existing directory, and an empty one is left to
# the official entrypoint as before.
set -eu

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
MARKER="$PGDATA/KINBOARD_POSTGRES"
HOWTO="https://github.com/svenger87/kinboard/wiki/Self-hosting#moving-an-install-to-postgresql-17"

refuse() {
  {
    echo "[kinboard-postgres] REFUSED: $1"
    echo "[kinboard-postgres] Nothing in $PGDATA was changed."
    echo "[kinboard-postgres] To start this install as before, put its database image back to the one it was created with"
    echo "[kinboard-postgres]   (for a compose install before stock PostgreSQL: supabase/postgres:15.14.1.159)."
    echo "[kinboard-postgres] To move it to PostgreSQL ${PG_MAJOR}, take a dump with the old image, start a NEW install"
    echo "[kinboard-postgres]   on an empty database folder, and restore the dump into it: $HOWTO"
  } >&2
  exit 1
}

# Only when this container is about to run the server: `docker run … psql`
# or `pg_dump` against another host must still work.
case "${1:-}" in
  postgres | -*)
    if [ -s "$PGDATA/PG_VERSION" ]; then
      found="$(tr -d '[:space:]' < "$PGDATA/PG_VERSION")"
      if [ "$found" != "$PG_MAJOR" ]; then
        refuse "the database folder was created by PostgreSQL $found, and this image is PostgreSQL $PG_MAJOR (kinboard-postgres). A data folder only opens under the version that wrote it."
      fi
      if [ ! -f "$MARKER" ]; then
        refuse "the database folder is PostgreSQL $found, but it was not created by kinboard-postgres (no $MARKER). A folder from another image (supabase/postgres, or a Debian-based postgres) can corrupt text indexes silently under this one. (If this is a new install whose very first start was cut off, it holds no data yet: empty the folder and start again.)"
      fi
    fi
    ;;
esac

exec docker-entrypoint.sh "$@"
