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
#   stack            project   webapp  postgres  old kong  subnet
#   ---------------- --------- ------- --------- --------- ------------
#   production       kinboard    3002      5433      8101  10.201.0.0/24
#   UX audit         kbaudit     3010      5442      8110  10.209.0.0/24
#   upgrade paths    kbupg       3021      5452      8120  10.220.0.0/24
#   devbox dev stack kbfresh     (next dev :3000) 5462 (8130) 10.221.0.0/24
#   fresh installs   kbinstall   3033      5464         -  10.223.0.0/24
#     (also test-integration-api.sh; renamed from kbfresh, whose name, port
#     and /mnt/user/appdata/kinboard-fresh-data the devbox's own stack uses —
#     a rig teardown there is `down -v` plus deleting the data directory)
#   backup/restore   kbbak       3041      5472      8140  10.222.0.0/24
#
# Kong left the stack in 1.15. Its port column stays for the upgrade rig,
# whose "before" half still runs a release that has Kong.
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
  ( cd "$DOCKER_DIR" && \
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

# Every rig's compose project. start.sh refuses an .env naming one of these
# unless KINBOARD_RIG=1 (keep the two lists the same).
RIG_PROJECTS="kbupg kbinstall kbbak"

# A run that fails, is interrupted or is killed must not leave a stack behind.
# Until #539 an aborted run left its containers up beside the real install, and
# nothing said how to get rid of them. rig_prepare_env arms this once the rig
# is about to create something, so a rig that refuses to start (busy ports,
# someone else's .env) never tears down a stack it did not make.
#   RIG_TEARDOWN  the function that removes this rig's stack (rig_teardown)
#   RIG_KEEP=1    leave it up on purpose (KEEP_UP / KEEP_FAILED)
#   rig_at_exit   queue a rig's own cleanup (temp dirs), run before teardown
RIG_TEARDOWN="${RIG_TEARDOWN:-rig_teardown}"
RIG_KEEP="${RIG_KEEP:-0}"
RIG_AT_EXIT=()
rig_at_exit() { RIG_AT_EXIT+=("$1"); }

rig_leftover_hint() {
  step "leftover $RIG_PROJECT containers? docker compose -p $RIG_PROJECT down -v --remove-orphans  (data: $RIG_DATA)"
}

rig_on_exit() {
  local rc=$? c
  trap - EXIT INT TERM
  for c in "${RIG_AT_EXIT[@]}"; do eval "$c" || true; done
  if [ "$RIG_STACK_ARMED" = "1" ]; then
    if [ "$RIG_KEEP" != "1" ]; then
      "$RIG_TEARDOWN" || true
    fi
    rig_leftover_hint
  fi
  rig_restore_checkout
  exit "$rc"
}

rig_install_traps() {
  trap rig_on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

RIG_STACK_ARMED=0
rig_arm_teardown() {
  RIG_STACK_ARMED=1
  rig_install_traps
}

# ------------------------------------------------- the checkout the rig runs in
#
# Running setup.sh in a checkout has two side effects on it, and until this
# block the rigs left both behind:
#
#   - setup.sh creates webapp/.env.local when there is none, and the rig then
#     deleted webapp/.env.local unconditionally — so a developer's own file,
#     the one `next dev` reads, was gone after any rig run.
#   - the rig marks webapp/docker/kong.yml and diun/diun.yml skip-worktree
#     before setup.sh writes a secret into diun.yml, so the secret can never be
#     committed. Both stayed marked, with the rig's secret in them, so the
#     checkout's git status went quiet about two tracked files for good.
#
# So the rig notes what it found before setup.sh runs, and puts it back on
# every way out (normal exit, failure, Ctrl-C, TERM): the two files' content
# and skip-worktree flag, and an .env.local only if this run created it. A
# checkout that had them skip-worktree with real secrets — the owner's —
# gets exactly that back; any other checkout gets its tracked files back.
RIG_GUARDED_FILES=(webapp/docker/kong.yml webapp/docker/diun/diun.yml)
RIG_ENV_LOCAL_FOUND=""
RIG_CHECKOUT_SNAPSHOT=""

rig_guard_checkout() {
  [ -z "$RIG_CHECKOUT_SNAPSHOT" ] || return 0
  RIG_CHECKOUT_SNAPSHOT=$(mktemp -d "${TMPDIR:-/tmp}/kinboard-rig-checkout.XXXXXX")
  if [ -e "$REPO_ROOT/webapp/.env.local" ]; then RIG_ENV_LOCAL_FOUND=1; else RIG_ENV_LOCAL_FOUND=0; fi
  local f i=0 tag
  for f in "${RIG_GUARDED_FILES[@]}"; do
    tag=$(cd "$REPO_ROOT" && git ls-files -v -- "$f" 2>/dev/null | cut -c1) || tag=""
    printf '%s\n' "${tag:--}" > "$RIG_CHECKOUT_SNAPSHOT/$i.flag"
    if [ -e "$REPO_ROOT/$f" ]; then cp -p "$REPO_ROOT/$f" "$RIG_CHECKOUT_SNAPSHOT/$i.file"; fi
    i=$((i+1))
  done
  rig_install_traps
}

# setup.sh writes webapp/.env.local only when there is none. Remove it again
# only if it was not there before this run.
rig_drop_own_env_local() {
  if [ "$RIG_ENV_LOCAL_FOUND" = "0" ] && [ -e "$REPO_ROOT/webapp/.env.local" ]; then
    rm -f "$REPO_ROOT/webapp/.env.local"
    step "removed the webapp/.env.local setup.sh created"
  fi
}

rig_restore_checkout() {
  [ -n "$RIG_CHECKOUT_SNAPSHOT" ] && [ -d "$RIG_CHECKOUT_SNAPSHOT" ] || return 0
  rig_drop_own_env_local
  local f i=0 tag
  for f in "${RIG_GUARDED_FILES[@]}"; do
    if [ -e "$RIG_CHECKOUT_SNAPSHOT/$i.file" ]; then
      cp -p "$RIG_CHECKOUT_SNAPSHOT/$i.file" "$REPO_ROOT/$f"
    fi
    tag=$(cat "$RIG_CHECKOUT_SNAPSHOT/$i.flag" 2>/dev/null) || tag=""
    # S = skip-worktree; '-' = not tracked (nothing to set).
    case "$tag" in
      S) ( cd "$REPO_ROOT" && git update-index --skip-worktree -- "$f" ) >/dev/null 2>&1 || true ;;
      -|"") ;;
      *) ( cd "$REPO_ROOT" && git update-index --no-skip-worktree -- "$f" ) >/dev/null 2>&1 || true ;;
    esac
    i=$((i+1))
  done
  rm -rf "$RIG_CHECKOUT_SNAPSHOT"
  RIG_CHECKOUT_SNAPSHOT=""
  step "checkout restored: ${RIG_GUARDED_FILES[*]} as found, webapp/.env.local $([ "$RIG_ENV_LOCAL_FOUND" = 1 ] && echo kept || echo 'not left behind')"
}

# Delete the rig's data directory, and be sure it went.
#
# Postgres and storage write as root inside their containers, so on any host
# where the rig is not run as root a plain `rm -rf` fails on those files. It
# fails *quietly* — the exit status was never checked — and the next boot then
# reuses the old cluster. On a GitHub runner that turned "destroy everything
# and restore the backup" into "restore the backup on top of the data that was
# already there", which surfaced as a wall of duplicate-key errors from
# pg_restore and looked like a bug in the restore rather than in the teardown.
#
# So: try the cheap way, fall back to a root container for what is left, and
# then assert the directory really is empty rather than assuming it.
rig_destroy_data() {
  [ -n "${RIG_DATA:-}" ] || return 0
  [ -e "$RIG_DATA" ] || return 0

  rm -rf "$RIG_DATA" 2>/dev/null

  if [ -e "$RIG_DATA" ]; then
    # Same uid as the files, no sudo needed, works the same everywhere.
    docker run --rm -v "$RIG_DATA":/target alpine:3 \
      sh -c 'rm -rf /target/* /target/.[!.]* /target/..?* 2>/dev/null; true' >/dev/null 2>&1
    rm -rf "$RIG_DATA" 2>/dev/null
  fi

  if [ -e "$RIG_DATA" ] && [ -n "$(ls -A "$RIG_DATA" 2>/dev/null)" ]; then
    fail "could not empty $RIG_DATA — a stale cluster would be reused"
    ls -la "$RIG_DATA" | head -5 | sed 's/^/     /'
    return 1
  fi
  return 0
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
  for p in "$RIG_WEBAPP_PORT" "$RIG_POSTGRES_PORT" ${RIG_KONG_HTTP_PORT:+"$RIG_KONG_HTTP_PORT"}; do
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
  # The rig rewrites webapp/docker/.env for its own throwaway stack — project
  # name, DATA_DIR, ports, subnet — and drops COMPOSE_FILES. In an installed
  # copy that .env is the install's: after #539's run, the next
  # `./start.sh up` would have started the rig's empty copy instead of the
  # family's Kinboard. So only an .env a rig wrote, or none, is used.
  if [ -f "$DOCKER_DIR/.env" ]; then
    local owner
    owner=$(sed -n 's/^PROJECT_NAME=//p' "$DOCKER_DIR/.env" | tail -1 | tr -d "\"' \r")
    case " $RIG_PROJECTS " in
      *" ${owner:-kinboard} "*) ;;
      *)
        red "REFUSING: $DOCKER_DIR/.env belongs to an install (PROJECT_NAME=${owner:-kinboard})."
        red "A rig rewrites that file for its throwaway stack. Run rigs in a checkout of their own:"
        red "  git worktree add ../kinboard-rig origin/main"
        exit 1 ;;
    esac
  fi
  # From here on the rig changes the checkout; note what it looks like first.
  rig_guard_checkout
  if [ ! -f "$DOCKER_DIR/.env" ]; then
    # setup.sh substitutes a secret into diun.yml (and, before 1.15, real
    # JWTs into kong.yml).
    # Production marks both skip-worktree so they can never be committed;
    # a fresh worktree gets them as ordinary tracked files, so `git add -A`
    # here would commit generated keys. Mirror production's protection
    # before running setup.sh, not after — for the length of the run only:
    # rig_restore_checkout puts back the flags and content found.
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
    [KONG_HTTP_PORT]="${RIG_KONG_HTTP_PORT:-8199}"
    [KONG_HTTPS_PORT]="${RIG_KONG_HTTPS_PORT:-8599}"
    [GO2RTC_HTTP_PORT]="$RIG_GO2RTC_HTTP_PORT"
    [GO2RTC_WEBRTC_PORT]="$RIG_GO2RTC_WEBRTC_PORT"
    [KINBOARD_PROJECT_DIR]="$REPO_ROOT"
    [KINBOARD_DEMO_FAMILY_CODE]="$RIG_DEMO_CODE"
    [NETWORK_SUBNET]="$RIG_NETWORK_SUBNET"
  )
  for key in "${!overrides[@]}"; do
    local val="${overrides[$key]}"
    if grep -q "^${key}=" "$DOCKER_DIR/.env"; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$DOCKER_DIR/.env"
    else
      printf '%s=%s\n' "$key" "$val" >> "$DOCKER_DIR/.env"
    fi
  done
  # COMPOSE_FILES in .env would override the explicit -f lists the rigs pass.
  sed -i '/^COMPOSE_FILES=/d' "$DOCKER_DIR/.env"

  # setup.sh copies webapp/.env.example to webapp/.env.local when there is
  # none, and nothing here needs it. A developer's own .env.local stays: it is
  # theirs, .dockerignore keeps it out of every build context, and the
  # upgrade rig checks its built image for the file's URLs anyway.
  rig_drop_own_env_local
  step "ports: webapp=$RIG_WEBAPP_PORT db=$RIG_POSTGRES_PORT"
  step "data:  $RIG_DATA"
  rig_arm_teardown
}
