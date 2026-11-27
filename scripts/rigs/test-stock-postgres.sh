#!/usr/bin/env bash
# test-stock-postgres.sh — the gates for stock PostgreSQL (RFC-024 §6.5, phase 3).
#
# New installs may run kinboard-postgres:17 (stock PostgreSQL 17 plus
# safeupdate) instead of supabase/postgres 15, with the role bootstrap in
# kinboard-db-init. Isolation between families is the same plain PostgreSQL
# either way, but only if the bootstrap reproduces every role attribute,
# membership and default privilege exactly; a mistake there is silent. So:
#
#   compare     supabase/postgres 15, kinboard-postgres on postgres:15 and on
#               postgres:17, each prepared by the image under test exactly as
#               a stack does (kinboard-db-init, then migrate.sh), then their
#               security surface dumped and compared: 15 vs 15 isolates the
#               image's differences, 15 vs 17 the version's. Only the
#               reviewed lines in stock-postgres/expected-*.txt may differ.
#               Then each protection removed on purpose, and the comparison
#               must fail: authenticated with BYPASSRLS, a missing grant,
#               uuid-ossp in public, safeupdate not preloaded, a policy
#               dropped. And the original mistake for real: a bootstrap that
#               puts uuid-ossp in public is refused by kinboard-db-init, and
#               the 30 routine grants it leaks fail the comparison.
#   filterless  On all three databases, PostgREST straight (no app guard): an
#               UPDATE and a DELETE without a filter, as the service role and
#               as a family, are refused by safeupdate and change no row.
#               Then with the preload removed, the rows are gone: the check
#               can fail.
#   stack       A fresh install from compose.yml with the database image
#               swapped for kinboard-postgres:17, nothing else: init and
#               db-init exit 0, the bootstrap ran, /api/health db:true, a
#               family created and joined, the security dump identical to
#               the compare phase's. Then e2e/rls-matrix.spec.ts against it.
#   red         On that stack, each protection removed: the matrix spec and
#               kinboard-db-init's own check must fail, and pass again once
#               it is put back.
#   specs       (RIG_DB_SPECS=1) the database specs that use the helper
#               (e2e/whole-database.ts) and need no browser, 18 files, pointed
#               at that stack with KINBOARD_DB_CONTAINER: all must pass.
#   legacy      compose.yml as it is (supabase/postgres): installed with the
#               previous image, then this build. The security dump is the
#               same before and after, and the same as a fresh install's:
#               nothing changes for an existing install.
#   guard       kinboard-postgres refuses that PostgreSQL 15 data folder, and
#               a PostgreSQL 17 folder another image wrote, and changes
#               neither.
#   move        That install moved to kinboard-postgres:17 the documented
#               way (dump, new install, restore): the family is back and its
#               join code works; the nightly backup's pg_dumpall works.
#
# Usage:
#   KINBOARD_RIG=1 scripts/rigs/test-stock-postgres.sh
#   RIG_IMAGE=<image:tag>               the webapp image (default: built from this checkout)
#   KINBOARD_POSTGRES_IMAGE=<image:tag> the stock database image (default: built from
#                                       webapp/image/postgres)
#   FROM_IMAGE=<image:tag>              the legacy phase's previous image (default:
#                                       ghcr.io/svenger87/kinboard:main)
#   RIG_PHASES="compare filterless stack red specs legacy guard move"   a subset
#   RIG_DB_SPECS=1                      run the database specs (default 1; 0 skips the specs phase)
#   KEEP_FAILED=1                       leave the stack up after a failure
#   RIG_COMPOSE_TIMEOUT, RIG_SPECS_TIMEOUT  deadlines in seconds (600, 900)
#
# Isolation: its own containers (kbspg-*), network (kbspg-net, Docker's choice
# of subnet), loopback ports 3053 (webapp) and 3054 (PostgREST). The stack and
# legacy phases run compose.yml, whose container and volume names are fixed
# (kinboard-*), so like test-one-file.sh it refuses to start while any of
# them exists. It touches nothing in the checkout.

set -uo pipefail

RIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=rig-intent.sh
. "$RIG_DIR/rig-intent.sh"
rig_require_intent "$@"; set -- "${RIG_ARGS[@]}"
REPO_ROOT="$(cd "$RIG_DIR/../.." && pwd)"
DOCKER_DIR="$REPO_ROOT/webapp/docker"
IMAGE_DIR="$REPO_ROOT/webapp/image"
HERE="$RIG_DIR/stock-postgres"

RIG_PHASES="${RIG_PHASES:-compare filterless stack red specs legacy guard move}"
RIG_DB_SPECS="${RIG_DB_SPECS:-1}"
KEEP_FAILED="${KEEP_FAILED:-0}"
FROM_IMAGE="${FROM_IMAGE:-ghcr.io/svenger87/kinboard:main}"
NET="kbspg-net"
PROJECT="kbspg"
WEBAPP_PORT=3053
REST_PORT=3054
BASE_URL="http://localhost:${WEBAPP_PORT}"
CONTAINERS=(kinboard-init kinboard-db kinboard-db-init kinboard-rest kinboard-webapp kinboard-go2rtc)
VOLUMES=(kinboard-db kinboard-storage kinboard-config)

# The images compose.yml pins, read from it rather than repeated here.
SUPABASE_IMAGE="$(sed -n 's/^    image: \(supabase\/postgres:[^ ]*\)$/\1/p' "$REPO_ROOT/compose.yml")"
POSTGREST_IMAGE="$(sed -n 's/^    image: \(postgrest\/postgrest:[^ ]*\)$/\1/p' "$REPO_ROOT/compose.yml")"

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
step() { printf '   %s\n' "$*"; }
FAILURES=()
CHECKS=0
fail() { red "   FAIL: $*"; FAILURES+=("$*"); CHECKS=$((CHECKS + 1)); }
pass() { grn "   ok:   $*"; CHECKS=$((CHECKS + 1)); }
want() { case " $RIG_PHASES " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
# The devbox's heavy-check slot when there is one (CLAUDE.md); an array, not a
# function, so `timeout` can run it.
SLOT=(); command -v kinboard-heavy-slot >/dev/null && SLOT=(kinboard-heavy-slot)

# Every wait has a deadline (CI's job once ran for 57 minutes with nothing to
# say why). On a timeout: what was being waited for, and the stack's state.
COMPOSE_TIMEOUT="${RIG_COMPOSE_TIMEOUT:-600}"
SPECS_TIMEOUT="${RIG_SPECS_TIMEOUT:-900}"
stack_diag() {
  echo "     --- containers"
  docker ps -a --filter name=kinboard- --filter name=kbspg- --format '     {{.Names}}\t{{.Status}}\t{{.Image}}'
  local c
  for c in kinboard-db kinboard-db-init kinboard-rest kinboard-webapp; do
    docker container inspect "$c" >/dev/null 2>&1 || continue
    echo "     --- $c ($(docker inspect -f '{{.State.Status}} exit={{.State.ExitCode}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c"))"
    docker logs --tail 80 "$c" 2>&1 | sed 's/^/       /'
  done
}
# deadline <seconds> <what is being waited for> <command...>
deadline() {
  local secs="$1" what="$2"; shift 2
  timeout --kill-after=30 "$secs" "$@"
  local rc=$?
  if [ "$rc" = 124 ] || [ "$rc" = 137 ]; then
    red "   TIMED OUT after ${secs}s waiting for: $what"
    stack_diag
  fi
  return "$rc"
}

WORK=""
BUILT=()
PULLED=()
GIT_BEFORE=""
STACK_UP=0
STACK_OK=0   # the stock stack came up healthy: red and specs need it

remove_compare() {
  docker ps -a --format '{{.Names}}' | grep -E '^kbspg-' | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker volume ls --format '{{.Name}}' | grep -E '^kbspg-' | xargs -r docker volume rm >/dev/null 2>&1 || true
}
remove_stack() {
  docker rm -f "${CONTAINERS[@]}" >/dev/null 2>&1 || true
  docker network rm "${PROJECT}_kinboard" >/dev/null 2>&1 || true
  docker volume rm "${VOLUMES[@]}" >/dev/null 2>&1 || true
  STACK_UP=0
}

on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if [ "$KEEP_FAILED" = "1" ] && [ ${#FAILURES[@]} -gt 0 ]; then
    red "KEEP_FAILED=1: containers kbspg-* and kinboard-* are left up, logs in $WORK"
    WORK=""
  else
    remove_compare
    remove_stack
    local i; for i in "${BUILT[@]}" "${PULLED[@]}"; do docker image rm "$i" >/dev/null 2>&1 || true; done
  fi
  [ -n "$WORK" ] && rm -rf "$WORK"
  if [ -n "$GIT_BEFORE" ] && [ "$(git -C "$REPO_ROOT" status --porcelain=v1 2>/dev/null)" != "$GIT_BEFORE" ]; then
    red "   the checkout changed during the run"; [ "$rc" = 0 ] && rc=1
  fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---------------------------------------------------------------- preflight

say "Kinboard stock PostgreSQL gates (RFC-024 §6.5)"
for tool in docker curl jq openssl sha256sum; do command -v "$tool" >/dev/null || { red "needs $tool"; exit 1; }; done
[ -n "$SUPABASE_IMAGE" ] && [ -n "$POSTGREST_IMAGE" ] || { red "could not read the db and rest images from compose.yml"; exit 1; }
if docker ps -a --format '{{.Names}}' | grep -qE '^kbspg-'; then red "kbspg-* containers exist: another run of this rig?"; exit 1; fi
if want stack || want legacy || want guard || want red; then
  taken=()
  for c in "${CONTAINERS[@]}"; do docker container inspect "$c" >/dev/null 2>&1 && taken+=("container $c"); done
  for v in "${VOLUMES[@]}"; do docker volume inspect "$v" >/dev/null 2>&1 && taken+=("volume $v"); done
  if [ ${#taken[@]} -gt 0 ]; then
    red "REFUSING: this host already has ${taken[*]} (a one-file install, or another rig). compose.yml fixes those names."
    exit 1
  fi
  for p in "$WEBAPP_PORT" "$REST_PORT"; do
    ss -lnt 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}\$" && { red "port $p is in use"; exit 1; }
  done
  ss -lnu 2>/dev/null | awk '{print $4}' | grep -qE "[:.]8555\$" && { red "udp 8555 (go2rtc, fixed in compose.yml) is in use"; exit 1; }
fi

GIT_BEFORE="$(git -C "$REPO_ROOT" status --porcelain=v1 2>/dev/null)" || GIT_BEFORE=""
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kinboard-stock-pg.XXXXXX")"
rev="$(git -C "$REPO_ROOT" rev-parse --short=7 HEAD)"

if [ -z "${RIG_IMAGE:-}" ]; then
  RIG_IMAGE="kinboard-stock-pg-rig:$rev"
  say "Building the webapp image ($RIG_IMAGE)"
  deadline 2400 "the webapp image build" "${SLOT[@]}" docker build -q --build-arg BUILD_REVISION="$rev" -f "$IMAGE_DIR/Dockerfile" -t "$RIG_IMAGE" "$REPO_ROOT/webapp" >/dev/null \
    || { red "webapp build failed"; exit 1; }
  BUILT+=("$RIG_IMAGE")
fi
baked="$(docker run --rm --entrypoint sh "$RIG_IMAGE" -c 'grep -rlE "localhost:(8000|8130)" /app/.next/ 2>/dev/null | wc -l')"
[ "$baked" = "0" ] || { red "$RIG_IMAGE has a localhost API address baked in; build it from a clean checkout"; exit 1; }

# The Dockerfile's own pin of postgres:17-alpine, and the same file on 15.
BASE17="$(sed -n 's/^ARG BASE=//p' "$IMAGE_DIR/postgres/Dockerfile")"
BASE15="${BASE15:-postgres:15-alpine}"
if [ -z "${KINBOARD_POSTGRES_IMAGE:-}" ]; then
  KINBOARD_POSTGRES_IMAGE="kinboard-postgres-rig:17-$rev"
  say "Building kinboard-postgres ($KINBOARD_POSTGRES_IMAGE, on $BASE17)"
  deadline 1200 "the kinboard-postgres build" "${SLOT[@]}" docker build -q -t "$KINBOARD_POSTGRES_IMAGE" "$IMAGE_DIR/postgres" >/dev/null || { red "kinboard-postgres build failed"; exit 1; }
  BUILT+=("$KINBOARD_POSTGRES_IMAGE")
fi
PG15_IMAGE=""
if want compare || want filterless; then
  PG15_IMAGE="kinboard-postgres-rig:15-$rev"
  deadline 1200 "the kinboard-postgres (15) build" "${SLOT[@]}" docker build -q --build-arg BASE="$BASE15" -t "$PG15_IMAGE" "$IMAGE_DIR/postgres" >/dev/null || { red "kinboard-postgres (15) build failed"; exit 1; }
  BUILT+=("$PG15_IMAGE")
fi
step "webapp $RIG_IMAGE; stock db $KINBOARD_POSTGRES_IMAGE; supabase db $SUPABASE_IMAGE; rest $POSTGREST_IMAGE"

PW="$(openssl rand -hex 16)"
JWT="$(openssl rand -hex 32)"

# HS256, as PostgREST verifies it.
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() {
  local payload="$1" secret="$2" input
  input="$(printf '{"alg":"HS256","typ":"JWT"}' | b64url).$(printf '%s' "$payload" | b64url)"
  printf '%s.%s' "$input" "$(printf '%s' "$input" | openssl dgst -sha256 -hmac "$secret" -binary | b64url)"
}

# ------------------------------------------------------- compare databases

declare -A DB_IMAGE=()
DUMP="$HERE/security-dump.sql"

# psql as the superuser inside a database container; SQL on stdin.
su_psql() { local c="$1"; shift; deadline 300 "psql in $c" docker exec -i "$c" psql -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }
dump_db() { su_psql "$1" < "$DUMP" | LC_ALL=C sort; }
# A dump taken inside a transaction that first applies $2, then rolled back.
dump_with() { { echo "BEGIN;"; printf '%s\n' "$2"; cat "$DUMP"; echo "ROLLBACK;"; } | su_psql "$1" | LC_ALL=C sort; }

start_db() {
  local name="$1" image="$2"
  docker run -d --name "$name" --network "$NET" -e POSTGRES_PASSWORD="$PW" "$image" >/dev/null
}
# The image under test prepares it the way a stack does.
prepare_db() {
  local name="$1"; shift
  deadline 300 "kinboard-db-init against $name" docker run --rm --network "$NET" -e POSTGRES_HOST="$name" -e POSTGRES_PASSWORD="$PW" "$@" "$RIG_IMAGE" kinboard-db-init \
    >"$WORK/$name.db-init.log" 2>&1 || return 1
  migrate_db "$name"
}
migrate_db() {
  deadline 600 "migrate.sh against $1" docker run --rm --network "$NET" -e POSTGRES_HOST="$1" -e POSTGRES_USER=postgres -e PGPASSWORD="$PW" \
    --entrypoint sh "$RIG_IMAGE" /app/migrate.sh >"$WORK/$1.migrate.log" 2>&1
}

compare_pair() {
  local label="$1" left="$2" right="$3" expected="$4"
  if "$HERE/compare-dumps.sh" "$left" "$right" "$HERE/$expected" >"$WORK/compare.out" 2>&1; then
    pass "$label: $(tail -n 1 "$WORK/compare.out" | sed 's/^compare-dumps: //')"
  else
    fail "$label"; sed 's/^/     /' "$WORK/compare.out" | head -40
  fi
}
# A comparison that must fail, and must name the sabotage.
compare_red() {
  local label="$1" right="$2" needle="$3"
  if "$HERE/compare-dumps.sh" "$WORK/pg15.dump" "$right" "$HERE/expected-stock15-vs-stock17.txt" >"$WORK/compare.out" 2>&1; then
    fail "red: $label went unnoticed by the comparison"
  elif grep -qE -- "$needle" "$WORK/compare.out"; then
    pass "red: $label fails the comparison ($(grep -c '^  [<>]' "$WORK/compare.out") unexplained line(s), e.g. $(grep -m1 -E -- "$needle" "$WORK/compare.out" | sed 's/^ *//' | cut -c1-110))"
  else
    fail "red: $label failed the comparison, but not on the line expected ($needle)"; sed 's/^/     /' "$WORK/compare.out" | head -10
  fi
}

if want compare || want filterless; then
  say "compare: three databases, prepared by the image under test"
  docker network create "$NET" >/dev/null
  DB_IMAGE=([kbspg-supa15]="$SUPABASE_IMAGE" [kbspg-pg15]="$PG15_IMAGE" [kbspg-pg17]="$KINBOARD_POSTGRES_IMAGE")
  for db in kbspg-supa15 kbspg-pg15 kbspg-pg17; do start_db "$db" "${DB_IMAGE[$db]}"; done
  for db in kbspg-supa15 kbspg-pg15 kbspg-pg17; do
    if prepare_db "$db"; then
      applied="$(grep -o 'done: [0-9]* applied' "$WORK/$db.migrate.log")"
      pass "$db (${DB_IMAGE[$db]}): db-init exit 0, migrations $applied"
    else
      fail "$db: preparing failed"; tail -n 15 "$WORK/$db.db-init.log" "$WORK/$db.migrate.log" 2>/dev/null | sed 's/^/     /'
    fi
  done
  grep -q "stock PostgreSQL" "$WORK/kbspg-supa15.db-init.log" && fail "db-init took supabase/postgres for stock" \
    || pass "supabase/postgres: db-init ran no bootstrap"
  grep -q "roles created" "$WORK/kbspg-pg17.db-init.log" && pass "postgres:17: db-init ran the bootstrap" \
    || fail "postgres:17: no bootstrap in db-init's log"
fi

if want compare; then
  for db in supa15 pg15 pg17; do dump_db "kbspg-$db" >"$WORK/$db.dump"; done
  compare_pair "supabase/postgres 15 vs postgres 15 (the image)" "$WORK/supa15.dump" "$WORK/pg15.dump" expected-supabase15-vs-stock15.txt
  compare_pair "postgres 15 vs postgres 17 (the version)" "$WORK/pg15.dump" "$WORK/pg17.dump" expected-stock15-vs-stock17.txt
  for kind in policy rls relacl member role setting defacl; do
    step "$kind lines in the postgres:17 dump: $(grep -c "^$kind|" "$WORK/pg17.dump")"
  done

  say "compare, red: each protection removed must fail the comparison"
  red_dump() { dump_with kbspg-pg17 "$1" >"$WORK/red.dump"; echo "$WORK/red.dump"; }
  compare_red "authenticated with BYPASSRLS" "$(red_dump "ALTER ROLE authenticated BYPASSRLS;")" 'role\|authenticated\|.*bypassrls=true'
  compare_red "SELECT on todos revoked from authenticated" "$(red_dump "REVOKE SELECT ON public.todos FROM authenticated;")" 'relacl\|r\|public\.todos\|authenticated\|SELECT'
  compare_red "uuid-ossp moved into public" "$(red_dump 'ALTER EXTENSION "uuid-ossp" SET SCHEMA public;')" 'extension\|uuid-ossp\|public'
  compare_red "safeupdate not preloaded" "$(red_dump "ALTER ROLE authenticator RESET session_preload_libraries;")" 'setting\|authenticator\|\*\|session_preload_libraries=safeupdate'
  compare_red "one policy on todos dropped" "$(red_dump "DO \$\$ BEGIN EXECUTE (SELECT format('DROP POLICY %I ON public.todos', policyname) FROM pg_policies WHERE tablename = 'todos' LIMIT 1); END \$\$;")" 'policy\|public\.todos\|'
  dump_db kbspg-pg17 >"$WORK/pg17.after.dump"
  cmp -s "$WORK/pg17.dump" "$WORK/pg17.after.dump" && pass "every sabotage was rolled back: the dump is as before" \
    || fail "the postgres:17 dump changed during the red runs"

  say "compare, red: the original mistake, uuid-ossp created in public by the bootstrap"
  sed 's/CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;/CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;/' \
    "$IMAGE_DIR/stock-postgres-bootstrap.sql" >"$WORK/bootstrap-uuid-public.sql"
  grep -q 'WITH SCHEMA public;' "$WORK/bootstrap-uuid-public.sql" || fail "could not make the broken bootstrap"
  start_db kbspg-pg17u "$KINBOARD_POSTGRES_IMAGE"
  if prepare_db kbspg-pg17u -v "$WORK/bootstrap-uuid-public.sql:/rig/bootstrap.sql:ro" -e KINBOARD_BOOTSTRAP_SQL=/rig/bootstrap.sql; then
    fail "red: db-init accepted a bootstrap with uuid-ossp in public"
  elif grep -q "uuid-ossp is not in the extensions schema" "$WORK/kbspg-pg17u.db-init.log"; then
    pass "red: db-init refuses it: $(grep -m1 'uuid-ossp' "$WORK/kbspg-pg17u.db-init.log" | sed 's/^.*\]   - //')"
  else
    fail "red: db-init failed, but not on uuid-ossp"; tail -n 8 "$WORK/kbspg-pg17u.db-init.log" | sed 's/^/     /'
  fi
  # Past db-init's refusal by hand, to show the comparison catches it too.
  su_psql kbspg-pg17u --single-transaction -f - <"$DOCKER_DIR/init.sql" >/dev/null 2>&1 && migrate_db kbspg-pg17u \
    || fail "could not finish the broken database by hand"
  dump_db kbspg-pg17u >"$WORK/pg17u.dump"
  compare_red "uuid-ossp created in public" "$WORK/pg17u.dump" 'procacl\|public\.uuid_'
  leaked="$(grep -cE '^procacl\|public\.uuid_[a-z0-9_]+\(.*\)\|(anon|authenticated|service_role)\|' "$WORK/pg17u.dump")"
  [ "$leaked" = 30 ] && pass "red: exactly the 30 routine grants RFC-024 §4.2.1 found ($leaked)" \
    || fail "red: $leaked uuid-ossp routine grants to the API roles, RFC-024 §4.2.1 found 30"
  docker rm -f kbspg-pg17u >/dev/null 2>&1
fi

# -------------------------------------------------------------- filterless

if want filterless; then
  say "filterless: PostgREST straight, no app guard, on all three databases"
  declare -A REST_PORT_OF=()
  for db in kbspg-supa15 kbspg-pg15 kbspg-pg17; do
    docker run -d --name "$db-rest" --network "$NET" -p 127.0.0.1::3000 \
      -e PGRST_DB_URI="postgres://authenticator:$PW@$db:5432/postgres" -e PGRST_JWT_SECRET="$JWT" \
      -e PGRST_DB_SCHEMAS=public,graphql_public -e PGRST_DB_ANON_ROLE=anon "$POSTGREST_IMAGE" >/dev/null
    REST_PORT_OF[$db]="$(docker port "$db-rest" 3000/tcp | head -n1 | sed 's/.*://')"
  done
  # Three families' worth of rows: what an unfiltered statement would take.
  for db in kbspg-supa15 kbspg-pg15 kbspg-pg17; do
    su_psql "$db" -tA >/dev/null <<'SQL'
INSERT INTO families (id, name, join_code) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'filterless A', 'FLTA01'),
  ('00000000-0000-4000-8000-00000000000b', 'filterless B', 'FLTB01');
INSERT INTO todos (family_id, title)
  SELECT f, 'filterless ' || n FROM unnest(ARRAY['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b']::uuid[]) f,
       generate_series(1, 3) n;
SQL
  done
  now="$(date +%s)"
  SERVICE="$(jwt "{\"role\":\"service_role\",\"iss\":\"kinboard\",\"iat\":$now,\"exp\":$((now + 3600))}" "$JWT")"
  FAMILY="$(jwt "{\"role\":\"authenticated\",\"family_id\":\"00000000-0000-4000-8000-00000000000a\",\"iss\":\"kinboard\",\"iat\":$now,\"exp\":$((now + 3600))}" "$JWT")"
  # A restart publishes the port anew, on another number.
  restart_rest() {
    docker restart "$1-rest" >/dev/null
    REST_PORT_OF[$1]="$(docker port "$1-rest" 3000/tcp | head -n1 | sed 's/.*://')"
    wait_rest "${REST_PORT_OF[$1]}"
  }
  snapshot() { su_psql "$1" -tA -c "SELECT count(*) || ':' || string_agg(xmin::text, ',' ORDER BY id) FROM public.todos"; }
  wait_rest() {
    local i; for i in $(seq 1 30); do
      [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$1/todos?select=id&limit=1" -H "Authorization: Bearer $SERVICE")" = 200 ] && return 0; sleep 1
    done; return 1
  }
  # filterless <db> <who> <token> <method>: the HTTP status and message
  filterless() {
    local body=(); [ "$4" = PATCH ] && body=(-H 'Content-Type: application/json' -d '{"title":"emptied"}')
    curl -s -X "$4" "http://127.0.0.1:${REST_PORT_OF[$1]}/todos" -H "Authorization: Bearer $3" -H 'Prefer: return=minimal' "${body[@]}" -w ' HTTP %{http_code}'
  }
  for db in kbspg-supa15 kbspg-pg15 kbspg-pg17; do
    wait_rest "${REST_PORT_OF[$db]}" || { fail "$db: PostgREST never answered"; docker logs --tail 5 "$db-rest" | sed 's/^/     /'; continue; }
    start="$(snapshot "$db")"
    bad=()
    for who in service family; do
      tok="$SERVICE"; [ "$who" = family ] && tok="$FAMILY"
      for m in PATCH DELETE; do
        verb=UPDATE; [ "$m" = DELETE ] && verb=DELETE
        out="$(filterless "$db" "$who" "$tok" "$m")"
        jq -e --arg v "$verb requires a WHERE clause" '.message == $v' >/dev/null 2>&1 <<<"${out% HTTP *}" || bad+=("$who $m: $out")
      done
    done
    if [ ${#bad[@]} -eq 0 ] && [ "$(snapshot "$db")" = "$start" ]; then
      pass "$db (${DB_IMAGE[$db]}): 4 unfiltered writes refused by safeupdate (service role and family; UPDATE and DELETE), ${start%%:*} rows untouched"
    else
      fail "$db: ${bad[*]:-rows changed}"
    fi
  done

  say "filterless, red: the preload removed on postgres:17, the same DELETE goes through"
  su_psql kbspg-pg17 -c "ALTER ROLE authenticator RESET session_preload_libraries;"
  restart_rest kbspg-pg17
  start="$(snapshot kbspg-pg17)"
  out="$(filterless kbspg-pg17 service "$SERVICE" DELETE)"
  # todos is in the recycle bin: a DELETE marks every row deleted rather than
  # removing it, which gives each a new version (xmin), so the snapshot moves.
  live="$(su_psql kbspg-pg17 -tA -c "SELECT count(*) FROM public.todos WHERE deleted_at IS NULL")"
  if [ "$(snapshot kbspg-pg17)" != "$start" ] && [ "$live" = 0 ]; then
    pass "red: without safeupdate, an unfiltered DELETE as the service role took every family's todos (HTTP ${out##* HTTP }, ${start%%:*} rows, 0 left outside the recycle bin)"
  else
    fail "red: without the preload the DELETE still did not go through ($out, $live live rows)"
  fi
  su_psql kbspg-pg17 -c "ALTER ROLE authenticator SET session_preload_libraries = 'safeupdate';"
  restart_rest kbspg-pg17
  out="$(filterless kbspg-pg17 service "$SERVICE" DELETE)"
  jq -e '.message == "DELETE requires a WHERE clause"' >/dev/null 2>&1 <<<"${out% HTTP *}" && pass "preload restored: refused again" \
    || fail "preload restored, but: $out"
fi
if want compare || want filterless; then remove_compare; fi

# ------------------------------------------------------------------- stack

dc() { ( cd "$WORK/install" && env -i PATH="$PATH" HOME="$HOME" ${DOCKER_HOST:+DOCKER_HOST="$DOCKER_HOST"} \
  KINBOARD_IMAGE="${STACK_IMAGE%:*}" KINBOARD_TAG="${STACK_IMAGE##*:}" WEBAPP_PORT="$WEBAPP_PORT" \
  timeout --kill-after=30 "$COMPOSE_TIMEOUT" docker compose -p "$PROJECT" "$@" ); local rc=$?
  if [ "$rc" = 124 ] || [ "$rc" = 137 ]; then red "   TIMED OUT after ${COMPOSE_TIMEOUT}s: docker compose $*"; stack_diag; fi
  return "$rc"; }
secret() { docker run --rm -v kinboard-config:/c:ro alpine:3 cat "/c/secrets/$1"; }
wait_healthy() {
  local i state
  for ((i = 0; i < 300; i += 5)); do
    state="$(docker inspect -f '{{.State.Health.Status}}' kinboard-webapp 2>/dev/null || true)"
    if [ "$state" = healthy ] && curl -sf -o /dev/null --max-time 3 "$BASE_URL/api/health"; then step "$1: webapp healthy after ${i}s"; return 0; fi
    # Nothing after a failed db-init ever starts: say so now, not in 5 minutes.
    if [ "$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' kinboard-db-init 2>/dev/null | grep -cE '^exited [1-9]')" = 1 ]; then
      fail "$1: kinboard-db-init failed, so the webapp will never start"; stack_diag; return 1
    fi
    sleep 5
  done
  fail "$1: the webapp was not healthy within 300s (${state:-none})"; stack_diag
  return 1
}
# Creates a family, joins it from a second device, prints the join code.
family_and_join() {
  local created code fam joined
  created="$(curl -s -X POST "$BASE_URL/api/session/create" -H 'content-type: application/json' \
    -d "{\"familyName\":\"Stock rig $1\",\"hardwareId\":\"rig-stockpg-$1-1\",\"deviceName\":\"rig-stockpg-$1-1\"}")"
  fam="$(jq -r '.family.id // empty' <<<"$created")"; code="$(jq -r '.family.join_code // empty' <<<"$created")"
  [ -n "$fam" ] && [ -n "$code" ] || { fail "$1: could not create a family: $(head -c 200 <<<"$created")"; return 1; }
  joined="$(curl -s -X POST "$BASE_URL/api/session/join" -H 'content-type: application/json' \
    -d "{\"joinCode\":\"$code\",\"hardwareId\":\"rig-stockpg-$1-2\",\"deviceName\":\"rig-stockpg-$1-2\"}")"
  [ "$(jq -r '.family.id // empty' <<<"$joined")" = "$fam" ] || { fail "$1: join failed: $(head -c 200 <<<"$joined")"; return 1; }
  pass "$1: a family created and joined from a second device"
  echo "$code" >"$WORK/$1.code"
}
run_specs() {  # run_specs <log> <playwright args...>; exit status of playwright
  local log="$1"; shift
  local jwt_secret service anon now
  jwt_secret="$(secret jwt_secret)"; now="$(date +%s)"
  service="$(jwt "{\"role\":\"service_role\",\"iss\":\"supabase\",\"iat\":$now,\"exp\":$((now + 7200))}" "$jwt_secret")"
  anon="$(jwt "{\"role\":\"anon\",\"iss\":\"supabase\",\"iat\":$now,\"exp\":$((now + 7200))}" "$jwt_secret")"
  ( cd "$REPO_ROOT/webapp" || exit 1
    export RLS_MATRIX_BASE_URL="$BASE_URL" RLS_MATRIX_POSTGREST_URL="http://127.0.0.1:$REST_PORT" \
      RLS_MATRIX_JWT_SECRET="$jwt_secret" KINBOARD_DB_CONTAINER=kinboard-db \
      PLAYWRIGHT_BASE_URL="$BASE_URL" FAMILY_CODE="${SPEC_FAMILY_CODE:-$(cat "$WORK/stack.code" 2>/dev/null)}" \
      SUPABASE_URL="$BASE_URL" NEXT_PUBLIC_SUPABASE_URL="$BASE_URL" POSTGREST_URL="http://127.0.0.1:$REST_PORT" \
      KINBOARD_SERVICE_ROLE_KEY="$service" NEXT_PUBLIC_SUPABASE_ANON_KEY="$anon" JWT_SECRET="$jwt_secret" PGRST_JWT_SECRET="$jwt_secret" \
      PLAYWRIGHT_AUTOSTART_DEV=0
      # A heartbeat every minute, so a long run never looks like a hang.
      ( while sleep 60; do printf '   [specs] %s\n' "$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r/\n/g' "$log" | grep -oE '^\[[0-9]+/[0-9]+\]' | tail -n1)"; done ) >&2 &
      hb=$!
      deadline "$SPECS_TIMEOUT" "playwright test $*" "${SLOT[@]}" ./node_modules/.bin/playwright test "$@" --reporter=line >"$log" 2>&1
      rc=$?; kill "$hb" 2>/dev/null; exit "$rc" )
}
matrix() { SPECS_TIMEOUT=600 run_specs "$1" e2e/rls-matrix.spec.ts --project=unit --workers=1; }
# Playwright's line reporter, without its cursor movements.
plain() { sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r/\n/g' "$1"; }
summary() { plain "$1" | grep -E '^\s+[0-9]+ (passed|failed|skipped|flaky|did not run)' | sed 's/^ *//' | tr '\n' ' '; }
failed_titles() { plain "$1" | grep -E '^\s+[0-9]+\) \['; }

if want stack || want red || want specs; then
  say "stack: compose.yml with the database image swapped for $KINBOARD_POSTGRES_IMAGE"
  mkdir -p "$WORK/install"
  cp "$REPO_ROOT/compose.yml" "$WORK/install/compose.yml"
  # The one change a stock install makes, plus PostgREST on loopback for the
  # service-role checks (compose.yml publishes no port for it) and CI's
  # higher session rate limit.
  cat >"$WORK/install/compose.override.yml" <<YML
services:
  db:
    image: $KINBOARD_POSTGRES_IMAGE
  rest:
    ports:
      - "127.0.0.1:$REST_PORT:3000"
  webapp:
    environment:
      # The specs create and join many families from one address, as CI's do.
      SESSION_RATE_LIMIT_PER_MINUTE: "1000"
YML
  STACK_IMAGE="$RIG_IMAGE"
  STACK_UP=1
  up_ok=1
  dc up -d >"$WORK/up.log" 2>&1 || { up_ok=0; fail "stack: compose up failed"; tail -n 20 "$WORK/up.log" | sed 's/^/     /'; stack_diag; }
  # A failed up has said why; waiting five more minutes on it would not.
  if [ "$up_ok" = 1 ] && wait_healthy stack; then
    STACK_OK=1
    for s in kinboard-init kinboard-db-init; do
      [ "$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$s")" = "exited 0" ] && pass "stack: $s exited 0" || fail "stack: $s did not exit 0"
    done
    [ "$(docker inspect -f '{{.Config.Image}}' kinboard-db)" = "$KINBOARD_POSTGRES_IMAGE" ] && pass "stack: kinboard-db runs $KINBOARD_POSTGRES_IMAGE" || fail "stack: wrong db image"
    docker logs kinboard-db-init 2>&1 | grep -c "roles created" >/dev/null && pass "stack: db-init ran the role bootstrap" || fail "stack: no bootstrap in db-init's log"
    docker exec kinboard-db test -f /var/lib/postgresql/data/KINBOARD_POSTGRES && pass "stack: the data folder carries kinboard-postgres's marker" || fail "stack: no marker in the data folder"
    body="$(curl -s "$BASE_URL/api/health")"
    jq -e '.db == true' >/dev/null 2>&1 <<<"$body" && pass "stack: /api/health db: true" || fail "stack: /api/health: $(head -c 200 <<<"$body")"
    family_and_join stack
    if [ -s "$WORK/pg17.dump" ]; then
      dump_db kinboard-db >"$WORK/stack.dump"
      if diff <(grep -v '^migrations-recorded' "$WORK/pg17.dump") <(grep -v '^migrations-recorded' "$WORK/stack.dump") >"$WORK/stack.diff"; then
        pass "stack: security dump identical to the compare phase's postgres:17 ($(wc -l <"$WORK/stack.dump") lines)"
      else
        fail "stack: security dump differs from the compare phase's"; head -20 "$WORK/stack.diff" | sed 's/^/     /'
      fi
    fi
    # db-init runs again on every up; a second run is a no-op.
    docker start -a kinboard-db-init >"$WORK/db-init.2.log" 2>&1 && grep -q "roles checked" "$WORK/db-init.2.log" \
      && ! grep -q "roles created" "$WORK/db-init.2.log" && pass "stack: db-init's second run checks the roles and creates nothing" \
      || { fail "stack: db-init's second run"; tail -5 "$WORK/db-init.2.log" | sed 's/^/     /'; }

    if want stack; then
      say "stack: e2e/rls-matrix.spec.ts"
      if matrix "$WORK/matrix.log"; then pass "rls-matrix: $(summary "$WORK/matrix.log")"
      else fail "rls-matrix: $(summary "$WORK/matrix.log")"; plain "$WORK/matrix.log" | grep -E '[0-9]+\) \[|Error:|^\s+[-+] ' | head -30 | sed 's/^/     /'; fi
    fi
  fi
fi

# --------------------------------------------------------------------- red

# sabotage <label> <sql> <fix sql> <restart rest?> <test title that must fail> <db-init message or "">
sabotage() {
  local label="$1" break_sql="$2" fix_sql="$3" restart="$4" title="$5" refusal="$6"
  su_psql kinboard-db -c "$break_sql" >/dev/null
  [ "$restart" = 1 ] && { docker restart kinboard-rest >/dev/null; sleep 3; }
  if matrix "$WORK/red.log"; then
    fail "red: $label: the matrix spec still passed"
  elif failed_titles "$WORK/red.log" | grep -cF -- "$title" >/dev/null; then
    pass "red: $label: the matrix fails \"$title\" ($(summary "$WORK/red.log"))"
  else
    fail "red: $label: the matrix failed, but not on \"$title\""; failed_titles "$WORK/red.log" | head -5 | sed 's/^/     /'
  fi
  if [ -n "$refusal" ]; then
    if docker start -a kinboard-db-init >"$WORK/red-db-init.log" 2>&1; then fail "red: $label: db-init accepted it"
    elif grep -qF -- "$refusal" "$WORK/red-db-init.log"; then pass "red: $label: db-init refuses to start: \"$refusal\""
    else fail "red: $label: db-init failed, not with \"$refusal\""; tail -4 "$WORK/red-db-init.log" | sed 's/^/     /'; fi
  fi
  su_psql kinboard-db -c "$fix_sql" >/dev/null
  [ "$restart" = 1 ] && { docker restart kinboard-rest >/dev/null; sleep 3; }
}

if want red && [ "$STACK_OK" = 1 ]; then
  say "red: each protection removed on the live stack"
  POLICY="$(su_psql kinboard-db -tA -c "SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'todos' AND cmd = 'ALL' LIMIT 1")"
  RECREATE="$(su_psql kinboard-db -tA -c "SELECT format('CREATE POLICY %I ON public.todos AS %s FOR %s TO %s USING (%s)%s', policyname, permissive, cmd, array_to_string(roles, ', '), qual, coalesce(' WITH CHECK (' || with_check || ')', '')) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'todos' AND policyname = '$POLICY'")"
  sabotage "authenticated with BYPASSRLS" "ALTER ROLE authenticated BYPASSRLS" "ALTER ROLE authenticated NOBYPASSRLS" 0 \
    "family A reads none of family B's rows" "authenticated bypasses row-level security"
  sabotage "SELECT on todos revoked from authenticated" "REVOKE SELECT ON public.todos FROM authenticated" "GRANT SELECT ON public.todos TO authenticated" 0 \
    "family A reads none of family B's rows" ""
  sabotage "the policy $POLICY on todos dropped" "DROP POLICY \"$POLICY\" ON public.todos" "$RECREATE" 0 \
    "family A reads none of family B's rows" ""
  sabotage "safeupdate not preloaded for authenticator" "ALTER ROLE authenticator RESET session_preload_libraries" \
    "ALTER ROLE authenticator SET session_preload_libraries = 'safeupdate'" 1 \
    "an UPDATE or DELETE without a filter is refused" "authenticator does not preload safeupdate"
  # Grant and membership questions, not row questions: db-init's own check.
  # dbinit_red <label> <break sql> <fix sql> <the refusal it must give>
  dbinit_red() {
    su_psql kinboard-db -c "$2" >/dev/null
    if docker start -a kinboard-db-init >"$WORK/red-db-init.log" 2>&1; then fail "red: $1: db-init accepted it"
    elif grep -qF -- "$4" "$WORK/red-db-init.log"; then pass "red: $1: db-init refuses to start: \"$4\""
    else fail "red: $1: db-init failed differently"; tail -4 "$WORK/red-db-init.log" | sed 's/^/     /'; fi
    su_psql kinboard-db -c "$3" >/dev/null
  }
  dbinit_red "uuid-ossp in public" 'ALTER EXTENSION "uuid-ossp" SET SCHEMA public' 'ALTER EXTENSION "uuid-ossp" SET SCHEMA extensions' \
    "uuid-ossp is not in the extensions schema"
  dbinit_red "authenticator's membership in service_role made to inherit" "GRANT service_role TO authenticator WITH INHERIT TRUE" \
    "GRANT service_role TO authenticator WITH INHERIT FALSE" "authenticator holds the rights of service_role before the role switch"
  dbinit_red "authenticator a member of postgres" "GRANT postgres TO authenticator" "REVOKE postgres FROM authenticator" \
    "authenticator is a member of postgres"
  dbinit_red "postgres with ADMIN OPTION on anon" "GRANT anon TO postgres WITH ADMIN OPTION" "REVOKE ADMIN OPTION FOR anon FROM postgres" \
    "postgres holds ADMIN OPTION on anon"
  dbinit_red "safeupdate left out for the postgres database only" \
    "ALTER ROLE authenticator IN DATABASE postgres SET session_preload_libraries = ''" \
    "ALTER ROLE authenticator IN DATABASE postgres RESET session_preload_libraries" \
    "authenticator's session_preload_libraries in database postgres leaves out safeupdate"

  say "red: everything put back"
  if [ -s "$WORK/stack.dump" ]; then
    dump_db kinboard-db >"$WORK/stack.after.dump"
    diff <(grep -v '^migrations-recorded' "$WORK/stack.dump") <(grep -v '^migrations-recorded' "$WORK/stack.after.dump") >/dev/null \
      && pass "the security dump is as before the red runs" || fail "the security dump changed during the red runs"
  fi
  docker start -a kinboard-db-init >"$WORK/db-init.3.log" 2>&1 && pass "db-init accepts it again" || fail "db-init still refuses"
  if matrix "$WORK/matrix.2.log"; then pass "rls-matrix green again: $(summary "$WORK/matrix.2.log")"
  else fail "rls-matrix after the red runs: $(summary "$WORK/matrix.2.log")"; fi
fi
# --------------------------------------------------------- database specs

# The specs that use the database helper (e2e/whole-database.ts) and need no
# browser: the `unit` project of e2e/spec-projects.ts, 18 files, about 135
# tests. They check what the database does: grants, migrations, triggers,
# the SQL functions. The other 42 helper users are UI specs that only seed
# fixtures through it; they test the pages, not the database, and are left to
# e2e.yml. Run after the matrix and the red runs, because some of these run
# migrations again; on CI's demo family; and stopped early when they fail:
# three failures, a minute a test, SPECS_TIMEOUT for the lot.
db_spec_files() {
  (cd "$REPO_ROOT/webapp" && ./node_modules/.bin/playwright test $(grep -l 'whole-database' e2e/*.spec.ts) --project=unit --list 2>/dev/null \
    | grep -oE '^  \[unit\] › [a-z0-9-]+\.spec\.ts' | sed 's/.* › /e2e\//' | sort -u)
}
db_specs() {  # db_specs <log>
  docker exec -i kinboard-db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 <"$DOCKER_DIR/seed-demo.sql" >/dev/null \
    || { fail "could not seed the demo family"; return 1; }
  local files; mapfile -t files < <(db_spec_files)
  [ "${#files[@]}" -ge 15 ] || { fail "only ${#files[@]} database specs found in the unit project"; return 1; }
  SPEC_FAMILY_CODE=DEMO01 run_specs "$1" "${files[@]}" --project=unit --workers=1 --max-failures=3 --timeout=60000
}

if { want red || want specs; } && [ "$STACK_UP" = 1 ] && [ "$STACK_OK" = 0 ]; then
  red "   red and specs skipped: the stack never came up (see above)"
fi
if want specs && [ "$STACK_OK" = 1 ] && [ "$RIG_DB_SPECS" = 1 ]; then
  say "specs: the $(db_spec_files | wc -l) database specs (unit project) on stock PostgreSQL 17, KINBOARD_DB_CONTAINER=kinboard-db"
  started=$(date +%s)
  if db_specs "$WORK/db-specs.log"; then
    pass "database specs on stock 17: $(summary "$WORK/db-specs.log")in $(( $(date +%s) - started ))s"
  else
    fail "database specs on stock 17: $(summary "$WORK/db-specs.log")"
    failed_titles "$WORK/db-specs.log" | head -10 | sed 's/^/     /'
    plain "$WORK/db-specs.log" | grep -m3 -A6 'Error:' | sed 's/^/     /'
  fi
  cp "$WORK/db-specs.log" "${RIG_SPECS_LOG:-/dev/null}" 2>/dev/null || true
fi

if { want stack || want red || want specs; } && ! { [ "$KEEP_FAILED" = 1 ] && [ ${#FAILURES[@]} -gt 0 ]; }; then remove_stack; fi

# ------------------------------------------------------------------ legacy

if want legacy || want guard || want move; then
  say "legacy: compose.yml unchanged (supabase/postgres), $FROM_IMAGE then this build"
  rm -rf "$WORK/install"; mkdir -p "$WORK/install"
  cp "$REPO_ROOT/compose.yml" "$WORK/install/compose.yml"
  # PostgREST on loopback for the specs' service-role checks; the database
  # image stays compose.yml's own.
  cat >"$WORK/install/compose.override.yml" <<YML
services:
  rest:
    ports:
      - "127.0.0.1:$REST_PORT:3000"
  webapp:
    environment:
      SESSION_RATE_LIMIT_PER_MINUTE: "1000"
YML
  if ! docker image inspect "$FROM_IMAGE" >/dev/null 2>&1; then deadline 900 "docker pull $FROM_IMAGE" docker pull -q "$FROM_IMAGE" >/dev/null && PULLED+=("$FROM_IMAGE"); fi
  STACK_IMAGE="$FROM_IMAGE"; STACK_UP=1
  dc up -d >"$WORK/up.log" 2>&1 || { fail "legacy: compose up with $FROM_IMAGE failed"; tail -n 20 "$WORK/up.log" | sed 's/^/     /'; stack_diag; }
  if wait_healthy "legacy ($FROM_IMAGE)"; then
    family_and_join legacy
    dump_db kinboard-db >"$WORK/legacy.before.dump"
    STACK_IMAGE="$RIG_IMAGE"
    dc up -d >"$WORK/up.log" 2>&1 || { fail "legacy: compose up with this build failed"; tail -n 20 "$WORK/up.log" | sed 's/^/     /'; stack_diag; }
    sleep 5
    if wait_healthy "legacy (this build)"; then
      docker logs kinboard-db-init 2>&1 | grep -c "stock PostgreSQL" >/dev/null && fail "legacy: db-init took supabase/postgres for stock" \
        || pass "legacy: db-init on supabase/postgres ran no bootstrap"
      [ "$(docker inspect -f '{{.State.ExitCode}}' kinboard-db-init)" = 0 ] && pass "legacy: db-init exited 0" || fail "legacy: db-init failed"
      dump_db kinboard-db >"$WORK/legacy.after.dump"
      if diff "$WORK/legacy.before.dump" "$WORK/legacy.after.dump" >"$WORK/legacy.diff"; then
        pass "legacy: the security dump is the same before and after the update ($(wc -l <"$WORK/legacy.after.dump") lines)"
      else fail "legacy: the update changed the security dump"; head -20 "$WORK/legacy.diff" | sed 's/^/     /'; fi
      if [ -s "$WORK/supa15.dump" ]; then
        diff <(grep -v '^migrations-recorded' "$WORK/legacy.before.dump") <(grep -v '^migrations-recorded' "$WORK/supa15.dump") >"$WORK/legacy.fresh.diff" \
          && pass "legacy: a fresh supabase/postgres install by this build has the same security dump as one by $FROM_IMAGE" \
          || { fail "legacy: fresh installs by the two images differ"; head -20 "$WORK/legacy.fresh.diff" | sed 's/^/     /'; }
      fi
      [ "$(docker exec kinboard-db cat /var/lib/postgresql/data/PG_VERSION)" = 15 ] && pass "legacy: still PostgreSQL 15" || fail "legacy: PG_VERSION changed"
    fi
  fi
  dc stop >/dev/null 2>&1
fi

# ------------------------------------------------------------------- guard

datadir_fingerprint() {  # every file's path, size and mtime, and PG_VERSION's content
  docker run --rm -v "$1":/d:ro alpine:3 sh -c 'cd /d && find . -type f -exec stat -c "%n %s %Y" {} + | sort | sha256sum | cut -c1-16; cat PG_VERSION'
}
expect_refused() {  # expect_refused <label> <volume> <message>
  local before after out rc
  before="$(datadir_fingerprint "$2")"
  out="$(timeout 60 docker run --name kbspg-guard -v "$2":/var/lib/postgresql/data "$KINBOARD_POSTGRES_IMAGE" 2>&1)"; rc=$?
  docker rm -f kbspg-guard >/dev/null 2>&1
  after="$(datadir_fingerprint "$2")"
  if [ "$rc" = 0 ] || [ "$rc" = 124 ]; then fail "guard: $1: kinboard-postgres started (exit $rc)"
  elif ! grep -qF -- "$3" <<<"$out"; then fail "guard: $1: refused, but without \"$3\""; head -5 <<<"$out" | sed 's/^/     /'
  else pass "guard: $1: refused, exit $rc: $(grep -m1 REFUSED <<<"$out" | sed 's/^\[kinboard-postgres\] //' | cut -c1-120)…"; fi
  [ "$before" = "$after" ] && pass "guard: $1: the data folder is untouched" || fail "guard: $1: the data folder changed"
}

if want guard; then
  say "guard: kinboard-postgres on data folders it did not create"
  if docker volume inspect kinboard-db >/dev/null 2>&1; then
    expect_refused "the PostgreSQL 15 folder of a compose install" kinboard-db "created by PostgreSQL 15"
    # The way a household would hit it: the same compose.yml with the image changed.
    cat >"$WORK/install/compose.override.yml" <<YML
services:
  db:
    image: $KINBOARD_POSTGRES_IMAGE
YML
    STACK_IMAGE="$RIG_IMAGE"
    dc up -d db >/dev/null 2>&1
    sleep 8
    if docker logs kinboard-db 2>&1 | grep -c "REFUSED: the database folder was created by PostgreSQL 15" >/dev/null; then
      pass "guard: through compose.yml, kinboard-db refuses and says why ($(docker inspect -f '{{.State.Status}}, restarts {{.RestartCount}}' kinboard-db))"
    else fail "guard: through compose.yml, no refusal in kinboard-db's log"; docker logs --tail 5 kinboard-db 2>&1 | sed 's/^/     /'; fi
    [ "$(docker inspect -f '{{.State.Health.Status}}' kinboard-db 2>/dev/null)" != healthy ] && pass "guard: the database never reports healthy, so nothing after it starts" \
      || fail "guard: the database reported healthy"
    dc stop >/dev/null 2>&1; docker rm -f kinboard-db >/dev/null 2>&1
    [ "$(datadir_fingerprint kinboard-db | tail -n1)" = 15 ] && pass "guard: the folder is still PostgreSQL 15" || fail "guard: PG_VERSION changed"
  else
    fail "guard: no PostgreSQL 15 folder to test (run it with the legacy phase)"
  fi
  docker volume create kbspg-foreign17 >/dev/null
  docker run -d --name kbspg-foreign17 -v kbspg-foreign17:/var/lib/postgresql/data -e POSTGRES_PASSWORD="$PW" "$BASE17" >/dev/null
  for _ in $(seq 1 30); do docker exec kbspg-foreign17 pg_isready -q -h 127.0.0.1 2>/dev/null && break; sleep 1; done
  docker stop kbspg-foreign17 >/dev/null; docker rm kbspg-foreign17 >/dev/null
  expect_refused "a PostgreSQL 17 folder written by plain postgres:17" kbspg-foreign17 "not created by kinboard-postgres"
fi
# -------------------------------------------------------------------- move

# The way Self-hosting documents: dump the supabase/postgres install, start a
# new one on kinboard-postgres:17 with an empty database folder and the same
# config folder, restore. The family is back, and its join code still works.
if want move; then
  say "move: the supabase/postgres install moved to kinboard-postgres:17 by dump and restore"
  if ! docker volume inspect kinboard-db >/dev/null 2>&1 || [ ! -s "$WORK/legacy.code" ]; then
    fail "move: no legacy install to move (run it with the legacy phase)"
  else
    rm -f "$WORK/install/compose.override.yml"
    STACK_IMAGE="$RIG_IMAGE"
    dc up -d db >/dev/null 2>&1
    for _ in $(seq 1 60); do [ "$(docker inspect -f '{{.State.Health.Status}}' kinboard-db 2>/dev/null)" = healthy ] && break; sleep 2; done
    if docker exec kinboard-db pg_dump -U supabase_admin -F c postgres >"$WORK/move.pgdump" 2>"$WORK/move.err" \
       && docker exec -i kinboard-db pg_restore -l <"$WORK/move.pgdump" | grep -c 'TOC Entries' >/dev/null; then
      pass "move: a verified dump of the PostgreSQL 15 install ($(du -h "$WORK/move.pgdump" | cut -f1))"
    else
      fail "move: the dump failed: $(tail -n1 "$WORK/move.err")"
    fi
    dc down >/dev/null 2>&1
    docker volume rm kinboard-db >/dev/null
    cat >"$WORK/install/compose.override.yml" <<YML
services:
  db:
    image: $KINBOARD_POSTGRES_IMAGE
YML
    dc up -d >"$WORK/up.log" 2>&1 || { fail "move: compose up on kinboard-postgres failed"; tail -n 20 "$WORK/up.log" | sed 's/^/     /'; stack_diag; }
    if wait_healthy move; then
      su_psql kinboard-db -c "TRUNCATE public.instance_settings" >/dev/null
      if docker exec -i kinboard-db pg_restore -U supabase_admin -d postgres --data-only --disable-triggers -n public \
           <"$WORK/move.pgdump" >"$WORK/restore.log" 2>&1; then
        pass "move: the PostgreSQL 15 dump restored into PostgreSQL 17 without an error (data only, as documented)"
      else
        fail "move: pg_restore reported errors"; tail -n 5 "$WORK/restore.log" | sed 's/^/     /'
      fi
      code="$(cat "$WORK/legacy.code")"
      joined="$(curl -s -X POST "$BASE_URL/api/session/join" -H 'content-type: application/json' \
        -d "{\"joinCode\":\"$code\",\"hardwareId\":\"rig-stockpg-move\",\"deviceName\":\"rig-stockpg-move\"}")"
      [ "$(jq -r '.family.name // empty' <<<"$joined")" = "Stock rig legacy" ] \
        && pass "move: the family is back, and its old join code joins a new device" \
        || fail "move: joining the moved family failed: $(head -c 200 <<<"$joined")"
      # The nightly-backup pattern (pg_dumpall as supabase_admin) on stock.
      if docker exec kinboard-db pg_dumpall -U supabase_admin >"$WORK/dumpall.sql" 2>"$WORK/dumpall.err"; then
        tables="$(grep -cE '^CREATE TABLE' "$WORK/dumpall.sql")"
        auth="$(grep -c 'CREATE SCHEMA auth' "$WORK/dumpall.sql")"
        pass "move: pg_dumpall -U supabase_admin works on stock ($tables CREATE TABLE; CREATE SCHEMA auth: $auth)"
      else
        fail "move: pg_dumpall as supabase_admin failed: $(tail -n1 "$WORK/dumpall.err")"
      fi
      docker exec kinboard-db pg_dump -U supabase_admin -F c postgres >"$WORK/stock.pgdump" 2>/dev/null
      n="$(docker exec -i kinboard-db pg_restore -l <"$WORK/stock.pgdump" | grep -cE '^[0-9]+; [0-9]+ [0-9]+ TABLE public ')"
      [ "$n" -ge 60 ] && [ "$n" -le 70 ] && pass "move: the documented check counts $n tables in a stock dump" || fail "move: the documented check counts $n tables"
    fi
  fi
fi

if ! { [ "$KEEP_FAILED" = 1 ] && [ ${#FAILURES[@]} -gt 0 ]; }; then remove_stack; remove_compare; fi

# ----------------------------------------------------------------- summary

say "Summary"
echo "   $CHECKS checks, ${#FAILURES[@]} failed"
if [ ${#FAILURES[@]} -gt 0 ]; then
  for f in "${FAILURES[@]}"; do red "   - $f"; done
  exit 1
fi
grn "   all gates green"
