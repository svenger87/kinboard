#!/usr/bin/env bash
# test-backup-restore.sh — take a database backup, lose everything, put it back.
#
# Phase 0 asks for an automated backup/restore test against the *current*
# schema, and the "current schema" half is the point. Kinboard already has an
# application-level export/import round trip (e2e/restore.spec.ts), which
# checks that a family's data survives a trip through /api/export and
# /api/import. That is a different promise from the one a self-hoster actually
# relies on at 23:00 when a disk has died: a `pg_dump` taken by yesterday's
# version, restored into today's image.
#
# The failure this guards against is not "the dump is corrupt". It is that a
# dump restores fine and then the *current* migrations will not apply on top of
# it — an ordering assumption, an object created outside a migration, a
# constraint that only holds for data created after it existed. Nobody
# discovers that until they need the backup, which is the worst possible moment
# to discover it.
#
# What one run does:
#   1. build the image under test and bring up a clean stack
#   2. seed the demo family, and record what is in it
#   3. pg_dump the whole cluster, the way a self-hoster's backup would
#   4. destroy everything — containers, volumes, the data directory
#   5. bring up a bare database and restore the dump into it
#   6. start the current webapp against the restored database, so its
#      migrations run over restored data rather than an empty schema
#   7. assert the family, its rows, and the schema all came back, and that the
#      app answers
#
# Usage:
#   ./test-backup-restore.sh          # one full cycle
#   ./test-backup-restore.sh 3        # repeat, for a flapping failure
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$SCRIPT_DIR" || exit 1

ITERATIONS="${1:-1}"

RIG_PROJECT="kbbak"
RIG_DATA="/mnt/user/appdata/kinboard-backup-data"
RIG_WEBAPP_PORT=3041
RIG_POSTGRES_PORT=5472
RIG_KONG_HTTP_PORT=8140
RIG_KONG_HTTPS_PORT=8583
RIG_GO2RTC_HTTP_PORT=1996
RIG_GO2RTC_WEBRTC_PORT=8586
RIG_NETWORK_SUBNET="10.222.0.0/24"
RIG_DEMO_CODE="BKUP01"

# shellcheck source=test-rig-common.sh
. "$SCRIPT_DIR/test-rig-common.sh"

RIG_COMPOSE=(-f docker-compose.yml)
DUMP_DIR="$(mktemp -d)"
DUMP="$DUMP_DIR/kinboard.sql"

cleanup() { rm -rf "$DUMP_DIR"; }
trap cleanup EXIT

# A count per table, as one string. Comparing this before and after is a
# stronger check than picking a few tables by hand, because it also catches a
# table that came back *empty* — which a spot check of the tables somebody
# thought to name would miss entirely.
snapshot_rows() {
  # Exact counts, not n_live_tup: that is an estimate maintained by autovacuum
  # and reads 0 for a table it has not visited yet, which would make this
  # comparison pass for entirely the wrong reason.
  psql_rig -c "
    SELECT string_agg(t || '=' || n, ',' ORDER BY t) FROM (
      SELECT relname AS t,
             (xpath('/row/cnt/text()',
                    query_to_xml('SELECT count(*) AS cnt FROM public.' || quote_ident(relname),
                                 false, true, '')))[1]::text::bigint AS n
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
        -- Instance state, not family data. The rebuilt stack's scheduler
        -- checks in before the restore happens, so this legitimately holds a
        -- row on the new side and none on the old. Comparing it would report a
        -- healthy restore as a failure.
        AND relname <> 'system_heartbeats'
    ) s;"
}

snapshot_schema() {
  psql_rig -c "
    SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public')
        || '/' || (SELECT count(*) FROM pg_policies WHERE schemaname='public')
        || '/' || (SELECT count(*) FROM information_schema.triggers WHERE trigger_schema='public');"
}

run_cycle() {
  local n="$1"
  printf '\n\033[1m-- backup/restore cycle %s/%s --\033[0m\n' "$n" "$ITERATIONS"

  rig_teardown
  rm -rf "$RIG_DATA"

  # -- 1. a stack to back up ------------------------------------------------
  if ! compose RIG_COMPOSE up -d >/dev/null 2>&1; then
    fail "cycle $n: stack would not start"
    return 1
  fi
  rig_wait_healthy "cycle $n before backup" 60 || return 1

  step "seeding the demo family"
  ( cd "$SCRIPT_DIR" && COMPOSE_FILES="-f docker-compose.yml" \
      ./start.sh seed-demo >/dev/null 2>&1 ) || step "seed-demo reported a problem (continuing)"

  local rows_before schema_before families_before
  rows_before="$(snapshot_rows)"
  schema_before="$(snapshot_schema)"
  families_before="$(psql_rig -c 'SELECT count(*) FROM families;')"

  if [ "${families_before:-0}" -lt 1 ]; then
    fail "cycle $n: nothing to back up — no families were seeded"
    return 1
  fi
  step "before: ${families_before} families, schema ${schema_before}"

  # -- 2. the backup the documentation tells people to take -----------------
  # Exactly the command in docs/wiki/Self-hosting.md, because the point is to
  # test what a self-hoster actually has, not a better backup invented here.
  # -U supabase_admin, and no -t: both are load-bearing and both are explained
  # there.
  if ! docker exec "${RIG_PROJECT}-db" pg_dump -U supabase_admin -F c postgres > "$DUMP" 2>/dev/null; then
    fail "cycle $n: pg_dump failed"
    return 1
  fi
  # The docs' own verification step. A dump broken by the permission or TTY
  # traps still produces a plausible file, so size proves nothing.
  # Captured, not piped into grep. `grep -q` exits as soon as it matches,
  # pg_restore then dies of SIGPIPE, and under `set -o pipefail` that reads as
  # the check having failed — on a dump that is perfectly good.
  local toc
  toc=$(docker exec -i "${RIG_PROJECT}-db" pg_restore -l < "$DUMP" 2>/dev/null)
  case "$toc" in
    *"Archive created at"*) : ;;
    *) fail "cycle $n: the dump is not a valid archive"; return 1 ;;
  esac
  step "dump: $(du -h "$DUMP" | cut -f1), valid archive"

  # -- 3. lose everything ---------------------------------------------------
  rig_teardown
  rm -rf "$RIG_DATA"
  step "destroyed the stack and its data directory"

  # -- 4. rebuild, then put the data back -----------------------------------
  # Order matters, and this is the part no documentation stated.
  #
  # Kinboard's schema arrives in two halves: the baseline is mounted into the
  # database image as zz-init.sql and runs at initdb, and the migrations on top
  # of it are applied by the webapp container as it starts. So the full stack
  # has to come up FIRST, or the restore targets a schema that predates soft
  # delete and device sessions.
  #
  # And the restore is --data-only. A plain schema+data pg_restore collides
  # with the schema initdb already created, and the COPY steps fail alongside
  # the CREATEs — leaving a database that looks restored and holds no rows.
  if ! compose RIG_COMPOSE up -d >/dev/null 2>&1; then
    fail "cycle $n: stack would not come up for the restore"
    return 1
  fi
  rig_wait_healthy "cycle $n rebuilt, before restore" 70 || return 1

  # --disable-triggers, so the data does not have to arrive in foreign-key
  # order. It needs superuser, which is the other reason for supabase_admin.
  docker exec -i "${RIG_PROJECT}-db" pg_restore -U supabase_admin -d postgres \
    --data-only --disable-triggers -n public \
    > "$DUMP_DIR/restore.out" 2> "$DUMP_DIR/restore.err" < "$DUMP"
  local restore_rc=$?

  # `grep -c` prints 0 and exits non-zero when nothing matches, so the usual
  # `|| echo 0` appends a second 0 and the comparison below dies on "0\n0".
  local errs
  errs=$(grep -c 'error:' "$DUMP_DIR/restore.err" 2>/dev/null)
  errs=${errs:-0}
  if [ "$restore_rc" -ne 0 ] || [ "$errs" -gt 0 ]; then
    fail "cycle $n: pg_restore exit ${restore_rc}, ${errs} errors"
    grep 'error:' "$DUMP_DIR/restore.err" | head -8 | sed 's/^/     /'
  else
    pass "restored with no errors"
  fi

  # -- 6. did it all come back? ---------------------------------------------
  local rows_after schema_after families_after
  rows_after="$(snapshot_rows)"
  schema_after="$(snapshot_schema)"
  families_after="$(psql_rig -c 'SELECT count(*) FROM families;')"

  if [ "$families_after" != "$families_before" ]; then
    fail "cycle $n: families ${families_before} -> ${families_after}"
  else
    pass "families survived (${families_after})"
  fi

  if [ "$schema_after" != "$schema_before" ]; then
    fail "cycle $n: schema tables/policies/triggers ${schema_before} -> ${schema_after}"
  else
    pass "schema intact (${schema_after})"
  fi

  if [ "$rows_after" != "$rows_before" ]; then
    fail "cycle $n: row counts differ after restore"
    step "  before: ${rows_before}"
    step "  after:  ${rows_after}"
  else
    pass "every table has the rows it had"
  fi

  # The migration runner refuses to start against a half-applied schema, so a
  # healthy webapp proves the current migrations applied cleanly on the rebuilt
  # stack. Checked rather than inferred.
  if compose RIG_COMPOSE logs webapp 2>&1 | grep -qiE 'migration attempt [0-9]+ failed|giving up'; then
    fail "cycle $n: migrations retried or gave up against the restored database"
  else
    pass "current migrations applied over the restored data"
  fi

  # And that the app can actually read what came back, not merely boot.
  local status
  status=$(curl -sf --max-time 10 "$BASE_URL/api/health" | tr -d ' \n')
  case "$status" in
    *'"db":true'*) pass "the restored instance answers and reaches its database" ;;
    *) fail "cycle $n: /api/health did not report a working database: ${status:-<no answer>}" ;;
  esac
}

say "Kinboard backup/restore loop"
step "cycles: $ITERATIONS"

rig_require_free_ports || exit 1
rig_prepare_env

say "Building the image under test"
if ! compose RIG_COMPOSE build webapp >/dev/null 2>&1; then
  red "the image did not build"
  exit 1
fi
step "built from $(git -C "$REPO_ROOT" rev-parse --short HEAD) + working tree"

started=$SECONDS
failed_cycles=()
for i in $(seq 1 "$ITERATIONS"); do
  run_cycle "$i" || failed_cycles+=("$i")
done
rig_teardown
rm -rf "$RIG_DATA"

say "Result"
step "elapsed: $(( (SECONDS-started)/60 ))m$(( (SECONDS-started)%60 ))s"
if [ ${#FAILURES[@]} -eq 0 ]; then
  grn "${ITERATIONS}/${ITERATIONS} clean backup/restore cycles"
  exit 0
fi
red "failed cycles: ${failed_cycles[*]:-none} (${#FAILURES[@]} assertions)"
for f in "${FAILURES[@]}"; do red "  - $f"; done
exit 1
