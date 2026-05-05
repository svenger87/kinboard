#!/usr/bin/env bash
# 2-bringup.sh — bring up the local demo stack for screenshot generation.
#
# - Generates demo.env on first run with random secrets (separate from prod)
# - Brings up the stack via docker compose with PROJECT_NAME=kinboard-demo
# - Waits for postgres + webapp to be healthy
#
# Re-runnable; idempotent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCREENSHOT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

cd "$SCREENSHOT_ROOT"

# ----------------------------------------------------------------------
# Generate demo.env if missing
# ----------------------------------------------------------------------
if [[ ! -f demo.env ]]; then
  echo "Generating demo.env (one-time setup)…"

  if [[ ! -f demo.env.example ]]; then
    echo "error: demo.env.example missing — bad checkout?" >&2
    exit 1
  fi

  # Need openssl for secrets
  if ! command -v openssl >/dev/null 2>&1; then
    echo "error: openssl not on PATH; needed to generate demo secrets." >&2
    exit 1
  fi

  POSTGRES_PASSWORD=$(openssl rand -hex 16)
  JWT_SECRET=$(openssl rand -hex 32)

  # Generate ANON_KEY and SERVICE_ROLE_KEY signed with JWT_SECRET.
  # Reuse the same logic webapp/docker/setup.sh uses; for the demo we
  # generate hardcoded role tokens with no expiry.
  jwt_payload() {
    local role="$1"
    printf '{"role":"%s","iss":"supabase-demo","iat":1700000000,"exp":2000000000}' "$role" \
      | base64 -w0 2>/dev/null \
      | tr '+/' '-_' \
      | tr -d '='
  }
  jwt_header=$(printf '{"alg":"HS256","typ":"JWT"}' | base64 -w0 2>/dev/null | tr '+/' '-_' | tr -d '=')
  jwt_sign() {
    local data="$1"
    printf '%s' "$data" \
      | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary \
      | base64 -w0 2>/dev/null \
      | tr '+/' '-_' \
      | tr -d '='
  }

  anon_payload=$(jwt_payload "anon")
  anon_sig=$(jwt_sign "${jwt_header}.${anon_payload}")
  ANON_KEY="${jwt_header}.${anon_payload}.${anon_sig}"

  service_payload=$(jwt_payload "service_role")
  service_sig=$(jwt_sign "${jwt_header}.${service_payload}")
  SERVICE_ROLE_KEY="${jwt_header}.${service_payload}.${service_sig}"

  cp demo.env.example demo.env
  # Patch values into demo.env (sed -i differs between BSD/GNU; use a portable form)
  python_subst() {
    local key="$1" val="$2"
    # Escape forward slashes + ampersands for sed
    local esc=$(printf '%s' "$val" | sed -E 's,[\&/.],\\&,g')
    sed -i.bak -E "s|^${key}=.*|${key}=${esc}|" demo.env
  }
  python_subst POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
  python_subst JWT_SECRET "$JWT_SECRET"
  python_subst ANON_KEY "$ANON_KEY"
  python_subst SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
  rm -f demo.env.bak

  echo "  Generated demo.env."
else
  echo "demo.env already present — using as-is."
fi

# ----------------------------------------------------------------------
# Source demo.env so PROJECT_NAME etc. are visible to docker compose
# ----------------------------------------------------------------------
set -a
# shellcheck disable=SC1091
source ./demo.env

# DATA_DIR in demo.env may be "./data" (relative). docker compose with
# --project-directory webapp/docker would resolve that to webapp/docker/data
# which collides with a prod-on-localhost. Force it to an absolute path
# inside the screenshots dir so the demo volume stays isolated.
DATA_DIR="$SCREENSHOT_ROOT/data"
mkdir -p "$DATA_DIR/db" "$DATA_DIR/storage"
export DATA_DIR
# Absolute paths used by the compose override for re-mounting init.sql
# at the right lexical name. Relative paths in compose override files
# resolve against --project-directory (webapp/docker), not this dir, so
# we have to materialize these as absolute.
export REPO_ROOT
export SCREENSHOT_ROOT
set +a

PROJECT_NAME="${PROJECT_NAME:-kinboard-demo}"

# ----------------------------------------------------------------------
# Render a DEMO-specific kong.yml with our demo ANON_KEY +
# SERVICE_ROLE_KEY signed by our demo JWT_SECRET. We render to
# screenshots/kong.yml (gitignored, regenerated on every bring-up) and
# mount THAT into the kong container via the override — leaving prod's
# kong.yml at $REPO_ROOT/webapp/docker/kong.yml untouched.
# ----------------------------------------------------------------------
KONG_SOURCE=""
if [[ -f "$REPO_ROOT/webapp/docker/kong.yml.example" ]]; then
  KONG_SOURCE="$REPO_ROOT/webapp/docker/kong.yml.example"
elif [[ -f "$REPO_ROOT/webapp/docker/kong.yml" ]]; then
  # Use prod's kong.yml as the template — it has real values that we'll
  # replace via key-string substitution (it has prod's actual keys at
  # this point but those will get overwritten with our demo keys).
  KONG_SOURCE="$REPO_ROOT/webapp/docker/kong.yml"
fi

if [[ -n "$KONG_SOURCE" ]]; then
  echo "Rendering screenshots/kong.yml from $(basename "$KONG_SOURCE") with demo keys + CORS for :${WEBAPP_PORT:-3201}…"
  awk -v anon="$ANON_KEY" -v svc="$SERVICE_ROLE_KEY" -v port="${WEBAPP_PORT:-3201}" '
    /key:[[:space:]]*REPLACE_WITH_ANON_KEY/ { sub(/REPLACE_WITH_ANON_KEY/, anon); print; next }
    /key:[[:space:]]*REPLACE_WITH_SERVICE_ROLE_KEY/ { sub(/REPLACE_WITH_SERVICE_ROLE_KEY/, svc); print; next }
    # If the source is a prod kong.yml, replace any pre-existing key
    # values for the anon and DASHBOARD consumers with our demo keys.
    /^    key:/ && prev ~ /consumer: anon/ { print "    key: " anon; next }
    /^    key:/ && prev ~ /consumer: DASHBOARD/ { print "    key: " svc; next }
    # Inject the demo webapp origin into every cors plugin allowed-origins
    # list. The marker is `- http://localhost:3001` (the highest port the
    # canonical kong.yml whitelists); add a new line right after it.
    /^[[:space:]]*-[[:space:]]+http:\/\/localhost:3001[[:space:]]*$/ {
      print
      print "            - http://localhost:" port
      next
    }
    { prev=$0; print }
  ' "$KONG_SOURCE" > "$SCREENSHOT_ROOT/kong.yml"
else
  echo "warning: no kong.yml.example or kong.yml found — kong auth will fail." >&2
fi

# ----------------------------------------------------------------------
# Bring up the stack
# ----------------------------------------------------------------------
echo ""
echo "Bringing up demo stack (project: $PROJECT_NAME)…"

# Note: we run docker compose from this dir (screenshots/) but use the prod
# compose file's directory for relative bind paths to resolve. The override
# file is in this dir.
docker compose \
  -f "$REPO_ROOT/webapp/docker/docker-compose.yml" \
  -f docker-compose.override.yml \
  --env-file demo.env \
  --project-directory "$REPO_ROOT/webapp/docker" \
  --project-name "$PROJECT_NAME" \
  up -d --no-build db kong rest auth realtime storage imgproxy

echo ""
echo "Waiting for postgres to accept connections…"
for i in $(seq 1 60); do
  if docker exec "${PROJECT_NAME}-db" pg_isready -U postgres >/dev/null 2>&1; then
    echo "  Postgres ready."
    break
  fi
  sleep 1
  if [[ $i -eq 60 ]]; then
    echo "  timeout: postgres didn't come up." >&2
    exit 2
  fi
done

# ----------------------------------------------------------------------
# Set passwords for supabase service roles to match POSTGRES_PASSWORD.
# The supabase/postgres image's migrate.sh only ALTERs supabase_admin;
# the other roles (authenticator, supabase_auth_admin, supabase_storage_admin)
# are created with empty passwords by the supabase migrations and only get
# their real passwords from /etc/postgresql.schema.sql which doesn't run
# reliably in some image versions. Without this, PostgREST and gotrue can't
# connect and crash-loop.
# ----------------------------------------------------------------------
echo ""
echo "Aligning supabase role passwords with POSTGRES_PASSWORD…"
# IMPORTANT: authenticator + supabase_auth_admin + supabase_storage_admin
# are RESERVED roles in supabase/postgres. Only supabase_admin (a real
# superuser, not the "postgres" role) can ALTER them. Without this step,
# auth + rest + storage + realtime all crash-loop with "password
# authentication failed for user authenticator" because their connection
# strings use POSTGRES_PASSWORD but the actual role passwords stay empty.
# Also: pg_hba.conf has a 127.0.0.1 trust rule that masks the issue from
# local-only psql tests.
docker exec -i "${PROJECT_NAME}-db" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<SQL >/dev/null
ALTER USER authenticator           WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER supabase_auth_admin     WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER supabase_storage_admin  WITH PASSWORD '${POSTGRES_PASSWORD}';
-- supabase/realtime expects a _realtime schema (with underscore) for its
-- own migration tracking. Some versions of supabase/postgres don't create
-- it automatically; if it's missing realtime crash-loops with
-- "ERROR 3F000 (invalid_schema_name) no schema has been selected".
CREATE SCHEMA IF NOT EXISTS _realtime;
GRANT ALL ON SCHEMA _realtime TO supabase_admin;
SQL

# Restart the dependent services so they pick up the now-valid passwords.
# (They're crash-looping on startup with the wrong creds; recreate fixes it.)
echo "Restarting auth + rest + realtime + storage so they reconnect…"
docker compose \
  -f "$REPO_ROOT/webapp/docker/docker-compose.yml" \
  -f docker-compose.override.yml \
  --env-file demo.env \
  --project-directory "$REPO_ROOT/webapp/docker" \
  --project-name "$PROJECT_NAME" \
  restart auth rest realtime storage >/dev/null

# ----------------------------------------------------------------------
# Status
# ----------------------------------------------------------------------
echo ""
echo "Demo stack up. Containers:"
docker ps --filter "name=${PROJECT_NAME}-" --format "  {{.Names}}\t{{.Status}}"
echo ""
echo "Postgres reachable inside docker as: ${PROJECT_NAME}-db:5432"
echo ""
echo "Next:"
echo "  1. ./scripts/3-restore.sh       # restore prod-dump.sql.gz into demo db"
echo "  2. ./scripts/4-anonymize.mjs    # scrub PII"
echo "  3. ./scripts/5-bringup-app.sh   # start webapp + mocks"
