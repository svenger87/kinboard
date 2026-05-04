#!/usr/bin/env bash
# Familyboard — local Docker operations.
#
# Usage:
#   ./start.sh up        # bring stack up
#   ./start.sh down      # tear down
#   ./start.sh restart   # rebuild webapp + restart
#   ./start.sh logs      # tail logs
#   ./start.sh status    # show container state
#   ./start.sh migrate   # apply migration*.sql files
#   ./start.sh seed-demo # load optional demo family + subjects
#
# To use the Traefik override:
#   COMPOSE_FILES="-f docker-compose.yml -f docker-compose.traefik.yml" ./start.sh up

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "error: $SCRIPT_DIR/.env is missing." >&2
  echo "       run \`./setup.sh\` from the repo root, or copy" >&2
  echo "       .env.example to .env and fill in the values." >&2
  exit 1
fi

COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml}"
if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  COMPOSE="docker compose"
fi

cmd="${1:-up}"

# Source .env so PROJECT_NAME / POSTGRES_PASSWORD are available to the
# helper functions below.
set -a
# shellcheck disable=SC1091
source ./.env
set +a
PROJECT_NAME="${PROJECT_NAME:-familyboard}"

# After the stack is up, ALTER the supabase service-role passwords to
# match POSTGRES_PASSWORD. The supabase/postgres image's migrate.sh
# only sets supabase_admin's password; authenticator,
# supabase_auth_admin, and supabase_storage_admin are created by the
# supabase migrations with empty passwords and only get their real
# values from /etc/postgresql.schema.sql which doesn't run reliably
# in some image versions. Without this step rest/auth/storage/realtime
# crash-loop with "password authentication failed for user
# authenticator". Idempotent.
align_role_passwords() {
  echo "→ aligning supabase role passwords with POSTGRES_PASSWORD"
  # Wait for db to be ready (up to 60s)
  for i in $(seq 1 60); do
    if docker exec "${PROJECT_NAME}-db" pg_isready -U postgres >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  docker exec -i "${PROJECT_NAME}-db" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL || true
ALTER USER authenticator           WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER supabase_auth_admin     WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER supabase_storage_admin  WITH PASSWORD '${POSTGRES_PASSWORD}';
-- supabase/realtime needs a _realtime schema (with leading underscore)
-- for its own migration tracking; some image versions don't auto-create.
CREATE SCHEMA IF NOT EXISTS _realtime;
SQL
  # Restart any deps that were already crash-looping with the old (empty)
  # creds so they pick up the now-valid passwords.
  docker restart "${PROJECT_NAME}-rest" "${PROJECT_NAME}-auth" \
    "${PROJECT_NAME}-storage" "${PROJECT_NAME}-realtime" >/dev/null 2>&1 || true
}

# Apply every webapp/docker/migration*.sql to the running DB.
# Each migration file uses `IF NOT EXISTS` / `IF EXISTS` guards so re-running
# is a no-op. We call this from `up` so a fresh install gets the full schema
# (init.sql only ships the original tables; six migrations add columns the
# webapp depends on, e.g. devices.hardware_id / devices.fingerprint, and
# tables like recipes / meals / notification_preferences).
run_migrations() {
  set +e
  local found=0 migration
  for migration in migration*.sql; do
    [[ -f "$migration" ]] || continue
    found=1
    echo "→ $migration"
    docker exec -i "${PROJECT_NAME:-familyboard}-db" \
      psql -U postgres -d postgres < "$migration"
  done
  if [[ $found -eq 1 ]]; then
    docker exec "${PROJECT_NAME:-familyboard}-db" \
      psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema';" >/dev/null 2>&1 || true
    docker restart "${PROJECT_NAME:-familyboard}-rest" >/dev/null 2>&1 || true
  fi
  set -e
}

case "$cmd" in
  up)
    $COMPOSE $COMPOSE_FILES up -d
    align_role_passwords
    run_migrations
    $COMPOSE $COMPOSE_FILES ps
    ;;
  down)
    $COMPOSE $COMPOSE_FILES down
    ;;
  restart)
    $COMPOSE $COMPOSE_FILES build --no-cache webapp
    $COMPOSE $COMPOSE_FILES up -d --no-deps webapp
    $COMPOSE $COMPOSE_FILES up -d --no-deps --force-recreate cron
    ;;
  logs)
    shift || true
    $COMPOSE $COMPOSE_FILES logs -f --tail=200 "$@"
    ;;
  status|ps)
    $COMPOSE $COMPOSE_FILES ps
    ;;
  migrate)
    run_migrations
    ;;
  seed-demo)
    # Apply the optional demo dataset (gated — explicit opt-in).
    if [[ ! -f seed-demo.sql ]]; then
      echo "error: seed-demo.sql not found in $SCRIPT_DIR" >&2
      exit 1
    fi
    echo "→ seeding demo family (idempotent)"
    docker exec -i "${PROJECT_NAME:-familyboard}-db" \
      psql -U postgres -d postgres < seed-demo.sql
    ;;
  *)
    echo "unknown command: $cmd" >&2
    sed -n '4,16p' "$0"
    exit 2
    ;;
esac
