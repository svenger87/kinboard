#!/bin/sh
# migrate.sh — the one migration runner.
#
# Applies webapp/docker/migrations/NNN_*.sql in numeric order and records each
# file in kinboard.schema_migrations with its checksum. Run by the webapp
# container on every start (webapp-entrypoint.sh) and by `./start.sh migrate`
# from the host; both go through this file, so there is one opinion on what the
# schema should be.
#
# What is applied:
#   - a file with no row in schema_migrations,
#   - a file whose checksum differs from the recorded one. Migrations here have
#     always been edited in place and re-applied on the next boot; that keeps
#     working, which is why every migration must stay idempotent.
#   Everything else is skipped. A boot with nothing new runs no migration SQL.
#
# Upgrading an install that predates the table: nothing is recorded yet, so the
# first run applies every file — exactly what every boot did before — and
# records them. No mapping from the old migration_zzz_*.sql names is needed.
#
# The numbered names replace the alphabetical `migration_zzzz_` convention. The
# container's glob sorted bytewise and a host shell under en_US did not, so the
# two applied the same files in different orders and the host run failed a
# dozen of them on a fresh database. Numbers sort the same everywhere.
#
# Env:
#   MIGRATIONS_DIR  directory holding NNN_*.sql (default: next to this script)
#   PSQL            command that runs psql against the database, reading SQL
#                   from stdin. Default: psql with POSTGRES_HOST/PORT/USER/DB.
#                   start.sh passes `docker exec -i <db> psql -U postgres ...`.
#
# Exit status: 0 when every pending file applied, 1 on the first failure (the
# failed file stays pending, so the next run retries it).

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$SCRIPT_DIR/migrations}"
PSQL="${PSQL:-psql -h ${POSTGRES_HOST:-db} -p ${POSTGRES_PORT:-5432} -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-postgres}}"

log() { echo "[migrate] $*"; }

# shellcheck disable=SC2086
sql() { $PSQL -X -q -v ON_ERROR_STOP=1 "$@"; }

if [ ! -d "$MIGRATIONS_DIR" ]; then
  log "no migrations directory at $MIGRATIONS_DIR; nothing to do"
  exit 0
fi

# A schema of its own, so PostgREST (which serves public) never exposes it and
# the row-level-security coverage of public tables is not its concern.
sql <<'SQL'
CREATE SCHEMA IF NOT EXISTS kinboard;
REVOKE ALL ON SCHEMA kinboard FROM PUBLIC;
CREATE TABLE IF NOT EXISTS kinboard.schema_migrations (
  name       text PRIMARY KEY,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

# Everything recorded, in one round trip: "name checksum" per line.
recorded="$(sql -tA -F ' ' <<'SQL'
SELECT name, checksum FROM kinboard.schema_migrations;
SQL
)"

applied=0
skipped=0
for file in "$MIGRATIONS_DIR"/[0-9]*.sql; do
  [ -f "$file" ] || continue
  name="$(basename "$file")"
  case "$name" in
    *[!a-z0-9_.]*) log "refusing $name: migration names are [a-z0-9_] only" >&2; exit 1 ;;
  esac
  sum="$(sha256sum "$file" | cut -c1-64)"

  if printf '%s\n' "$recorded" | grep -qxF "$name $sum"; then
    skipped=$((skipped + 1))
    continue
  fi

  if printf '%s\n' "$recorded" | grep -q "^$name "; then
    log "re-applying $name (changed since it was recorded)"
  else
    log "applying $name"
  fi

  if ! sql < "$file"; then
    log "FAILED: $name" >&2
    exit 1
  fi

  # Recorded only after it applied. The name and checksum are ours (digits,
  # lowercase, underscores; hex), never user input, so plain interpolation is
  # safe here.
  sql <<SQL
INSERT INTO kinboard.schema_migrations (name, checksum) VALUES ('$name', '$sum')
ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now();
SQL
  applied=$((applied + 1))
done

# PostgREST caches the schema; a new column is not queryable until it reloads.
if [ "$applied" -gt 0 ]; then
  sql -c "NOTIFY pgrst, 'reload schema';" >/dev/null 2>&1 || true
fi

log "done: $applied applied, $skipped already up to date"
