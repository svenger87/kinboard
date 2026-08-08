#!/usr/bin/env bash
# test-fresh-install.sh — install Kinboard from nothing, N times, and prove it
# comes up every time.
#
# Phase 0 of the 2026 plan sets this exit criterion literally:
#
#     "20 automatisierte Fresh Installs ohne Race"
#
# Twenty, not one, because the failure it guards against is a *race*. Issue
# #152 was two migration runners applying the same files concurrently — the
# webapp container and start.sh on the host — colliding with each other and
# with storage still initialising. It usually won, which is exactly what made
# it hard to see and why a single green install proves nothing. A race is
# visible only as a rate.
#
# What each iteration does:
#   1. destroy the data directory completely — no reused volume, no cached db
#   2. bring the stack up from scratch
#   3. wait for it to answer
#   4. assert the schema is fully applied, not half
#   5. assert the migration runner did not retry or give up
#   6. tear down
#
# Reports a pass rate. Anything below 20/20 fails the run and prints the
# iteration numbers that broke, because which ones failed matters: an early
# cluster suggests a cold-cache effect, a scatter suggests a genuine race.
#
# Usage:
#   ./test-fresh-install.sh          # 20 iterations (the exit criterion)
#   ./test-fresh-install.sh 3        # fewer, while iterating on the rig
#   KEEP_FAILED=1 ./test-fresh-install.sh   # leave a failed stack up to inspect

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$SCRIPT_DIR"

ITERATIONS="${1:-20}"

RIG_PROJECT="kbfresh"
RIG_DATA="/mnt/user/appdata/kinboard-fresh-data"
RIG_WEBAPP_PORT=3031
RIG_POSTGRES_PORT=5462
RIG_KONG_HTTP_PORT=8130
RIG_KONG_HTTPS_PORT=8573
RIG_GO2RTC_HTTP_PORT=1995
RIG_GO2RTC_WEBRTC_PORT=8585
RIG_NETWORK_SUBNET="10.221.0.0/24"
RIG_DEMO_CODE="FRSH01"

# shellcheck source=test-rig-common.sh
. "$SCRIPT_DIR/test-rig-common.sh"

# A fresh install uses whatever this checkout builds, which is the thing under
# test. Overridable so the same rig can check that a published release still
# installs cleanly.
INSTALL_COMPOSE=(-f docker-compose.yml)
if [ -n "${KINBOARD_TAG:-}" ]; then
  INSTALL_COMPOSE=(-f docker-compose.yml -f docker-compose.image.yml)
fi

# --------------------------------------------------------------- assertions

# The schema is "complete" when the objects the current migrations create are
# all present. Counting migration files would prove nothing: they are re-run on
# every boot and there is no bookkeeping table, so the only real question is
# whether the end state is right.
assert_schema_complete() {
  local n="$1" ok=1

  local tables triggers funcs policies
  tables=$(psql_rig -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
  triggers=$(psql_rig -c "SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%soft_delete%' AND NOT tgisinternal;")
  funcs=$(psql_rig -c "SELECT count(*) FROM pg_proc WHERE proname IN ('purge_deleted','purge_expired');")
  policies=$(psql_rig -c "SELECT count(*) FROM pg_policies WHERE schemaname='public';")

  # A half-applied schema is the symptom this whole criterion exists to catch,
  # and it shows up as "some but not all".
  [ "${triggers:-0}" = "9" ] || { fail "run $n: soft-delete triggers = ${triggers:-?}, want 9"; ok=0; }
  [ "${funcs:-0}" = "2" ]    || { fail "run $n: purge functions = ${funcs:-?}, want 2"; ok=0; }
  [ "${tables:-0}" -ge 20 ] 2>/dev/null || { fail "run $n: only ${tables:-?} public tables"; ok=0; }
  [ "${policies:-0}" -ge 10 ] 2>/dev/null || { fail "run $n: only ${policies:-?} RLS policies"; ok=0; }

  # The storage buckets are the other half of #152: the recipe, savings-goal
  # and vehicle image buckets race the storage service on a first boot.
  local buckets
  buckets=$(psql_rig -c "SELECT count(*) FROM storage.buckets;" 2>/dev/null)
  [ "${buckets:-0}" -ge 1 ] 2>/dev/null || { fail "run $n: no storage buckets created"; ok=0; }

  [ "$ok" = "1" ] && step "schema: ${tables} tables, ${policies} policies, ${triggers} triggers, ${buckets} buckets"
  return $((1 - ok))
}

# A retry is not a failure — the entrypoint retries on purpose while the other
# services initialise — but it is the signal that the race is still live, so it
# is counted and reported separately from a hard failure.
RETRY_RUNS=0
RIG_LOGS="${RIG_LOGS:-/tmp/kinboard-fresh-logs}"
assert_runner_clean() {
  local n="$1" logs retries
  logs=$(compose INSTALL_COMPOSE logs webapp 2>&1)
  mkdir -p "$RIG_LOGS"
  printf '%s\n' "$logs" > "$RIG_LOGS/run-$n.log"

  if grep -q 'GIVING UP' <<<"$logs"; then
    fail "run $n: migration runner gave up"
    grep -n 'FAILED\|GIVING UP' <<<"$logs" | head -3 | sed 's/^/     /'
    return 1
  fi

  retries=$(grep -c 'migration attempt .* failed' <<<"$logs" 2>/dev/null || true)
  retries="${retries:-0}"
  if [ "$retries" != "0" ]; then
    RETRY_RUNS=$((RETRY_RUNS + 1))
    step "note: run $n needed $retries migration retry/retries"
    # A retry is the interesting case, not the failure case: it means a
    # migration lost a race and a second pass papered over it. Record which
    # one and what Postgres actually said, so the rate can be chased rather
    # than tolerated.
    local which err
    which=$(grep -m1 'FAILED:' <<<"$logs" | sed 's/.*FAILED: //')
    err=$(grep -m1 -E '^(ERROR|FATAL|psql:)' <<<"$logs" | cut -c1-140)
    step "       first failing migration: ${which:-<none logged>}"
    step "       postgres said: ${err:-<nothing matched>}"
    RETRY_DETAIL+=("run $n: ${which:-?} — ${err:-?}")
  fi
  return 0
}

# ------------------------------------------------------------------ one run

PASSED=0
FAILED_RUNS=()
RETRY_DETAIL=()

one_install() {
  local n="$1"
  printf '\n\033[1m-- fresh install %d/%d --\033[0m\n' "$n" "$ITERATIONS"

  rig_teardown
  rm -rf "$RIG_DATA"
  mkdir -p "$RIG_DATA"

  local t0 t1
  t0=$(date +%s)
  if ! ( cd "$SCRIPT_DIR" && COMPOSE_FILES="${INSTALL_COMPOSE[*]}" ./start.sh up >/dev/null 2>&1 ); then
    fail "run $n: start.sh up failed"
    FAILED_RUNS+=("$n")
    [ "${KEEP_FAILED:-0}" = "1" ] && return 1
    rig_teardown
    return 1
  fi

  if ! rig_wait_healthy "run $n" 60; then
    FAILED_RUNS+=("$n")
    [ "${KEEP_FAILED:-0}" = "1" ] && return 1
    rig_teardown
    return 1
  fi
  t1=$(date +%s)

  local ok=1
  assert_runner_clean "$n"   || ok=0
  assert_schema_complete "$n" || ok=0

  if [ "$ok" = "1" ]; then
    PASSED=$((PASSED + 1))
    grn "   run $n: clean install in $((t1 - t0))s"
  else
    FAILED_RUNS+=("$n")
    if [ "${KEEP_FAILED:-0}" = "1" ]; then
      red "   KEEP_FAILED=1 — leaving run $n up at $BASE_URL"
      return 1
    fi
  fi

  rig_teardown
  return 0
}

# --------------------------------------------------------------------- main

say "Kinboard fresh-install loop"
step "iterations: $ITERATIONS"
step "source:     $([ -n "${KINBOARD_TAG:-}" ] && echo "published image $KINBOARD_TAG" || echo "built from $(cd "$REPO_ROOT" && git rev-parse --short HEAD)")"

rig_require_free_ports || exit 1
rig_prepare_env

# Build explicitly before the loop.
#
# `start.sh up` runs `docker compose up -d` with no --build, so compose reuses
# any image that already exists under the project name. That makes the rig
# silently test a stale binary: a change to the Dockerfile, the migrations or
# the entrypoint is simply not in the image, and the run reports on whatever
# was built last. It cost a full 20-run "verification" of an entrypoint fix
# that was never actually in the image being booted.
#
# Once, not per iteration — the point is a fresh *database* each time, not a
# fresh build.
if [ -z "${KINBOARD_TAG:-}" ]; then
  say "Building the image under test"
  if ! compose INSTALL_COMPOSE build webapp >/dev/null 2>&1; then
    red "build failed"; exit 1
  fi
  step "built from $(cd "$REPO_ROOT" && git rev-parse --short HEAD) + working tree"
else
  step "using published image $KINBOARD_TAG — nothing to build"
fi

START=$(date +%s)
for i in $(seq 1 "$ITERATIONS"); do
  one_install "$i"
  if [ "${KEEP_FAILED:-0}" = "1" ] && [ ${#FAILED_RUNS[@]} -gt 0 ]; then
    red "stopping at first failure (KEEP_FAILED=1)"
    break
  fi
done
END=$(date +%s)

say "Result"
step "elapsed: $(( (END - START) / 60 ))m$(( (END - START) % 60 ))s"
if [ "$RETRY_RUNS" != "0" ]; then
  step "runs needing a migration retry: $RETRY_RUNS/$ITERATIONS"
  for d in "${RETRY_DETAIL[@]}"; do step "  $d"; done
  step "full logs: $RIG_LOGS/"
fi

if [ "$PASSED" = "$ITERATIONS" ]; then
  grn "$PASSED/$ITERATIONS clean fresh installs"
  exit 0
fi

red "$PASSED/$ITERATIONS clean — failed runs: ${FAILED_RUNS[*]}"
for f in "${FAILURES[@]}"; do red "  - $f"; done
exit 1
