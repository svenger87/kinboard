# shellcheck shell=bash
# Shared machinery for the disposable test stacks. Sourced, never executed.
#
# There is more than one rig now (upgrade paths, fresh installs), and the part
# they must agree on is *isolation*: if two rigs drift onto the same port,
# project name or network subnet they corrupt each other's runs, and the
# failure looks like a product bug rather than a harness bug. So the settings
# live in one file with one allocation table.
#
# Port and subnet allocation on this host — check here before adding a rig:
#
#   stack            project   webapp  postgres  kong   subnet
#   ---------------- --------- ------- --------- ------ ------------
#   production       kinboard    3002      5433   8101   10.201.0.0/24
#   UX audit         kbaudit     3010      5442   8110   10.209.0.0/24
#   upgrade paths    kbupg       3021      5452   8120   10.220.0.0/24
#   fresh installs   kbfresh     3031      5462   8130   10.221.0.0/24
#
# A caller sets its RIG_* block and then sources this file.

: "${RIG_PROJECT:?rig must set RIG_PROJECT}"
: "${RIG_DATA:?rig must set RIG_DATA}"
: "${RIG_WEBAPP_PORT:?rig must set RIG_WEBAPP_PORT}"

RIG_DEMO_CODE="${RIG_DEMO_CODE:-RIG001}"
BASE_URL="http://localhost:${RIG_WEBAPP_PORT}"
BASE_COMPOSE=(-f docker-compose.yml)

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
step() { printf '   %s\n' "$*"; }

FAILURES=()
fail() { red "   FAIL: $*"; FAILURES+=("$*"); }
pass() { grn "   ok:   $*"; }

compose() {
  local -n files=$1; shift
  ( cd "$SCRIPT_DIR" && \
    COMPOSE_PROJECT_NAME="$RIG_PROJECT" \
    docker compose -p "$RIG_PROJECT" "${files[@]}" "$@" )
}

psql_rig() {
  docker exec -i "${RIG_PROJECT}-db" psql -U postgres -d postgres -tA "$@"
}

# Tearing down with the base file is enough: the overlays only ever change the
# webapp image, never the set of services, so every container, volume and
# network in the project is reachable from here.
rig_teardown() {
  compose BASE_COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
}

rig_wait_healthy() {
  local label="$1" budget="${2:-90}"
  step "waiting for the stack to answer ($label, up to $((budget*5))s)"
  for i in $(seq 1 "$budget"); do
    if curl -sfo /dev/null --max-time 3 "$BASE_URL/api/setup/status"; then
      step "ready after $((i*5))s"
      return 0
    fi
    sleep 5
  done
  fail "$label: stack never became ready"
  step "--- webapp logs (last 40) ---"
  compose BASE_COMPOSE logs --tail=40 webapp 2>&1 | sed 's/^/     /' || true
  return 1
}

# A port already in use produces a compose error that reads like a Kinboard
# fault. Say plainly which rig or service is squatting instead.
rig_require_free_ports() {
  local busy=()
  for p in "$RIG_WEBAPP_PORT" "$RIG_POSTGRES_PORT" "$RIG_KONG_HTTP_PORT"; do
    if ss -lnt 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}\$"; then
      busy+=("$p")
    fi
  done
  if [ ${#busy[@]} -gt 0 ]; then
    red "ports already in use: ${busy[*]}"
    red "another rig is probably still up — check: docker ps --filter name=${RIG_PROJECT}"
    return 1
  fi
  return 0
}

rig_prepare_env() {
  say "Preparing an isolated .env"
  if [ ! -f "$SCRIPT_DIR/.env" ]; then
    # setup.sh substitutes real JWTs into kong.yml (and touches diun.yml).
    # Production marks both skip-worktree so they can never be committed;
    # a fresh worktree gets them as ordinary tracked files, so `git add -A`
    # here would commit generated keys. Mirror production's protection
    # before running setup.sh, not after.
    ( cd "$REPO_ROOT" && git update-index --skip-worktree \
        webapp/docker/kong.yml webapp/docker/diun/diun.yml 2>/dev/null ) || true
    step "marked kong.yml + diun.yml skip-worktree (as production does)"
    ( cd "$REPO_ROOT" && ./setup.sh --non-interactive >/dev/null )
    step "generated secrets via setup.sh --non-interactive"
  else
    step "reusing existing rig .env"
  fi

  local -A overrides=(
    [PROJECT_NAME]="$RIG_PROJECT"
    [COMPOSE_PROJECT_NAME]="$RIG_PROJECT"
    [DATA_DIR]="$RIG_DATA"
    [WEBAPP_PORT]="$RIG_WEBAPP_PORT"
    [POSTGRES_PORT]="$RIG_POSTGRES_PORT"
    [KONG_HTTP_PORT]="$RIG_KONG_HTTP_PORT"
    [KONG_HTTPS_PORT]="$RIG_KONG_HTTPS_PORT"
    [GO2RTC_HTTP_PORT]="$RIG_GO2RTC_HTTP_PORT"
    [GO2RTC_WEBRTC_PORT]="$RIG_GO2RTC_WEBRTC_PORT"
    [KINBOARD_PROJECT_DIR]="$REPO_ROOT"
    [KINBOARD_DEMO_FAMILY_CODE]="$RIG_DEMO_CODE"
    [NETWORK_SUBNET]="$RIG_NETWORK_SUBNET"
  )
  for key in "${!overrides[@]}"; do
    local val="${overrides[$key]}"
    if grep -q "^${key}=" "$SCRIPT_DIR/.env"; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$SCRIPT_DIR/.env"
    else
      printf '%s=%s\n' "$key" "$val" >> "$SCRIPT_DIR/.env"
    fi
  done
  # COMPOSE_FILES in .env would override the explicit -f lists the rigs pass.
  sed -i '/^COMPOSE_FILES=/d' "$SCRIPT_DIR/.env"

  # setup.sh copies webapp/.env.example to webapp/.env.local verbatim, and that
  # file carries NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000. Next inlines
  # NEXT_PUBLIC_* at BUILD time. .dockerignore now keeps it out of the build
  # context, but a rig that builds should not depend on that single layer, and
  # nothing here needs the file.
  if [ -f "$REPO_ROOT/webapp/.env.local" ]; then
    rm -f "$REPO_ROOT/webapp/.env.local"
    step "removed webapp/.env.local that setup.sh created"
  fi
  step "ports: webapp=$RIG_WEBAPP_PORT db=$RIG_POSTGRES_PORT kong=$RIG_KONG_HTTP_PORT"
  step "data:  $RIG_DATA"
}
