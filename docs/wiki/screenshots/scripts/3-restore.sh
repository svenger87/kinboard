#!/usr/bin/env bash
# 3-restore.sh — restore the prod dump into the demo postgres.
#
# Pre-reqs: 1-clone-prod-db.sh (dump exists) and 2-bringup.sh (postgres up).
# This script is idempotent and destructive: it WIPES the demo public schema
# before restoring, so re-running gives you a clean copy.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCREENSHOT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$SCREENSHOT_ROOT"

if [[ ! -f demo.env ]]; then
  echo "error: demo.env missing — run scripts/2-bringup.sh first." >&2
  exit 1
fi
# shellcheck disable=SC1091
source ./demo.env

PROJECT_NAME="${PROJECT_NAME:-kinboard-demo}"
DB_CONTAINER="${PROJECT_NAME}-db"
DUMP="$SCREENSHOT_ROOT/dump/prod-dump.sql.gz"

if [[ ! -f "$DUMP" ]]; then
  echo "error: $DUMP missing — run scripts/1-clone-prod-db.sh first." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  echo "error: $DB_CONTAINER not running — run scripts/2-bringup.sh first." >&2
  exit 1
fi

echo "Applying schema migrations to bring demo up to prod's level…"
# Prod has these applied via webapp/deploy.sh step 1. Without them, columns
# like events.person_id don't exist in our fresh init.sql schema and the
# data restore fails with "column does not exist" on every event row.
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
for migration in "$REPO_ROOT"/webapp/docker/migration*.sql; do
  [ -f "$migration" ] || continue
  name=$(basename "$migration")
  echo "  → $name"
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=0 < "$migration" >/dev/null 2>&1 || true
done

# Supabase ships a `schema_migrations` tracking table for its own migrations.
# pg_dump --schema=public picks it up, but our init.sql doesn't create it
# (it's normally created in the supabase auth schema, not public). The dump
# would otherwise fail trying to INSERT INTO it. Create a minimal compatible
# table here so those INSERTs land harmlessly.
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version TEXT PRIMARY KEY
);
SQL

echo ""
echo "Wiping demo public schema rows…"
# Truncate every public table CASCADE so we don't fight foreign keys on restore.
# Schema itself stays.
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('TRUNCATE TABLE public.%I CASCADE', r.tablename);
    END LOOP;
END $$;
SQL

echo "Restoring $(du -h "$DUMP" | cut -f1) of compressed dump…"
# Defer FK constraints during restore so out-of-order INSERTs don't fail.
# The dump's INSERTs go in arbitrary table order, but child rows (e.g.
# shopping_items.source_device_id → devices.id) need the parent row first.
RESTORE_LOG=$(mktemp)
{
  echo "BEGIN;"
  echo "SET CONSTRAINTS ALL DEFERRED;"
  gunzip -c "$DUMP"
  echo "COMMIT;"
} | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=0 >"$RESTORE_LOG" 2>&1
ERR_COUNT=$(grep -c "^ERROR" "$RESTORE_LOG" || true)
if [ "$ERR_COUNT" -gt 0 ]; then
  echo "  $ERR_COUNT errors during restore (sample below):"
  grep "^ERROR" "$RESTORE_LOG" | sort | uniq -c | sort -rn | head -5 | sed 's/^/    /'
fi
rm -f "$RESTORE_LOG"

# Sanity check
ROWS=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAc \
  "SELECT count(*) FROM public.events")
PEOPLE=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAc \
  "SELECT count(*) FROM public.people")
RECIPES=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAc \
  "SELECT count(*) FROM public.recipes")

echo ""
echo "Restored. Sanity check:"
echo "  events:  $ROWS"
echo "  people:  $PEOPLE"
echo "  recipes: $RECIPES"
echo ""
echo "Next: scripts/4-anonymize.mjs   (scrub PII before any screenshots)"
echo ""
echo "  ⚠ Until anonymized, this DB has REAL PRODUCTION DATA."
echo "    Do not capture screenshots, share the volume, or commit anything"
echo "    derived from it before running step 4."
