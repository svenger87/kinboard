#!/usr/bin/env bash
# test-aio-autoupdate.sh: kinboard-updater keeping the all-in-one image up to
# date (RFC-024 §4.7), on a real Docker, with a local registry standing in for
# GHCR. Every container, volume, image and folder it makes is named kbaup-*.
#
#   base      an all-in-one container on BASE_IMAGE (default: the published
#             kinboard-aio:main, which has no app.kinboard.aio label yet), with
#             a household in it: a family created and joined through the API,
#             seed-demo.sql and the move rig's fill-every-table.sql (a row in
#             every table), a file in the uploads; Unraid's labels on it, and
#             an Unraid update-status file standing in for Unraid's own
#   updater   kinboard-updater built from this checkout beside it, as the wiki's
#             `docker run` line starts it (plus --network host, only so that
#             127.0.0.1 is the stand-in registry). First tick: a baseline.
#             Second: nothing.
#   update    a newer image (this checkout's all-in-one Dockerfile, FROM the
#             same webapp image, so it carries the label): the image's own
#             verified dump as PUID:PGID, then only the all-in-one container
#             recreated, healthy, smoke-checked; its id changed and its
#             settings equal apart from the image (inspect, field by field);
#             every table and file as before; the next tick does nothing;
#             Unraid's status file holds the new digest
#   migrate   an image with one more (additive) migration: applied, healthy
#   broken    an image whose migration fails: the original container back
#             (same id), every table as before, the release held; the next
#             tick holds it again
#   newer-schema  an image whose (additive) migration applies and whose
#             server then never starts: the original goes back and runs,
#             healthy and smoke-checked, on the schema the new one left (the
#             migration recorded, its table and column there)
#   kill      the tick container killed in the middle of the swap; the
#             updater restarted: its first check puts the original back; the
#             tick after that updates
#   pg18      an image on PostgreSQL 18 (built 18 over 17, as test-aio.sh
#             does): the updater waits for the image's own upgrade, health and
#             smoke pass, /data/db is 18, /data/db.old 17, every table as before
#   compose   the wiki's Compose snippet: an update, then `docker compose up -d`
#             leaves the recreated container alone
#
# Usage:
#   KINBOARD_RIG=1 scripts/rigs/test-aio-autoupdate.sh
#   APP_IMAGE=<webapp image>    what the newer images are built FROM
#                               (default ghcr.io/svenger87/kinboard:main)
#   BASE_IMAGE=<aio image>      what the household starts on
#                               (default ghcr.io/svenger87/kinboard-aio:main)
#   RIG_PHASES="update migrate broken newer-schema kill pg18 compose"   a subset
#   KEEP_FAILED=1               leave everything up after a failure
set -uo pipefail

RIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=rig-intent.sh
. "$RIG_DIR/rig-intent.sh"
rig_require_intent "$@"; set -- "${RIG_ARGS[@]}"
REPO_ROOT="$(cd "$RIG_DIR/../.." && pwd)"
IMAGE_DIR="$REPO_ROOT/webapp/image"
APP_IMAGE="${APP_IMAGE:-ghcr.io/svenger87/kinboard:main}"
BASE_IMAGE="${BASE_IMAGE:-ghcr.io/svenger87/kinboard-aio:main}"
RIG_PHASES="${RIG_PHASES:-update migrate broken newer-schema kill pg18 compose}"
KEEP_FAILED="${KEEP_FAILED:-0}"
P_REG="${P_REG:-5761}"
P_AIO="${P_AIO:-3761}"
P_CMP="${P_CMP:-3762}"
SLOT=()
[ -x "$HOME/.local/bin/kinboard-heavy-slot" ] && SLOT=("$HOME/.local/bin/kinboard-heavy-slot")

FAILURES=()
CHECKS=0
BUILT=()
red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
step() { printf '   %s\n' "$*"; }
fail() { red "   FAIL: $*"; FAILURES+=("$*"); CHECKS=$((CHECKS + 1)); }
pass() { grn "   ok:   $*"; CHECKS=$((CHECKS + 1)); }
check() { local what="$1"; shift; if "$@"; then pass "$what"; else fail "$what"; fi; }
want() { case " $RIG_PHASES " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

REG="127.0.0.1:$P_REG"
REF="$REG/kinboard-aio:next"
AIO=kbaup-aio
UPD=kbaup-updater
UPD_IMAGE=kbaup-updater:rig
WORK=""

cleanup_all() {
  local c
  for c in $(docker ps -aq --filter name=kbaup- 2>/dev/null); do docker rm -f "$c" >/dev/null 2>&1 || true; done
  [ -z "$WORK" ] || [ ! -f "$WORK/cmp/compose.yml" ] || docker compose -p kbaup-cmp -f "$WORK/cmp/compose.yml" down -v >/dev/null 2>&1 || true
  for c in $(docker volume ls -q --filter name=kbaup- 2>/dev/null); do docker volume rm -f "$c" >/dev/null 2>&1 || true; done
  for c in $(docker network ls -q --filter name=kbaup- 2>/dev/null); do docker network rm "$c" >/dev/null 2>&1 || true; done
  for c in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^(kbaup-|$REG/)" || true); do docker image rm "$c" >/dev/null 2>&1 || true; done
}
on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if [ "$KEEP_FAILED" = 1 ] && [ ${#FAILURES[@]} -gt 0 ]; then
    red "KEEP_FAILED=1: kbaup-* left up; work folder $WORK"
    WORK=""
  else
    cleanup_all
  fi
  if [ -n "$WORK" ]; then
    docker run --rm -v "$WORK:/w" alpine:3 sh -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
  echo
  if [ ${#FAILURES[@]} -eq 0 ] && [ "$rc" = 0 ]; then grn "test-aio-autoupdate: $CHECKS checks, all passed"; else red "test-aio-autoupdate: $CHECKS checks, ${#FAILURES[@]} failed"; for f in "${FAILURES[@]}"; do red "   - $f"; done; [ "$rc" = 0 ] && rc=1; fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---------------------------------------------------------------- preflight

say "kinboard-updater and the all-in-one image (RFC-024 §4.7)"
for tool in docker curl jq; do command -v "$tool" >/dev/null || { red "needs $tool"; exit 1; }; done
if grep -qE '^kbaup-' < <(docker ps -a --format '{{.Names}}'; docker volume ls --format '{{.Name}}'); then
  red "kbaup-* containers or volumes exist: another run of this rig?"; exit 1
fi
for p in $P_REG $P_AIO $P_CMP; do
  grep -qE "[:.]${p}\$" < <(ss -lnt 2>/dev/null | awk '{print $4}') && { red "port $p is in use"; exit 1; }
done
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kbaup-rig.XXXXXX")"
rev="$(git -C "$REPO_ROOT" rev-parse --short=7 HEAD)"

# ------------------------------------------------------------------ helpers

logs() { docker logs "$1" 2>&1; }
apsql() { docker exec -i "$1" psql -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -tA; }
wait_healthy() {  # wait_healthy <name> [seconds]
  local name="$1" max="${2:-420}" i st
  for ((i = 0; i < max; i += 3)); do
    st="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name" 2>/dev/null)"
    [ "$st" = "running healthy" ] && return 0
    sleep 3
  done
  step "$name not healthy within ${max}s ($st)"; return 1
}
cid() { docker inspect -f '{{.Id}}' "$1" 2>/dev/null; }
img() { docker inspect -f '{{.Image}}' "$1" 2>/dev/null; }
# Every table of public and kinboard as "<table> <rows> <md5>", schema_migrations
# left out (a migration adds a row): the move rig's own query (#583).
checksums() { apsql "$1" <"$RIG_DIR/migration-aio/table-checksums.sql"; }
# The tables a migration of this rig touches are compared by row count only.
checksums_but() { checksums "$1" | awk -v t="$2" '$1 == t { print $1, $2; next } { print }'; }
# same_tables <label> <before> <after>: every table equal, but for
# public.instance_settings, where the updater writes its status record for
# Settings (that is the point of it). Prints the tables that differ.
same_tables() {
  local d
  d="$(diff <(grep -v '^public\.instance_settings ' <<<"$2") <(grep -v '^public\.instance_settings ' <<<"$3") | grep '^[<>]' || true)"
  if [ -z "$d" ]; then pass "$1"; else fail "$1"; sed 's/^/     /' <<<"$d" | head -20; fi
}
files_sum() { (cd "$WORK/data/storage/files" && find . -type f -print0 | sort -z | xargs -0 sha256sum) 2>/dev/null; }
# A container's own settings: what docker inspect says, minus what Docker
# derives (ids, state, times, addresses) and what the image supplies (its ENV
# lines and labels, whatever its own value is).
settings() {  # settings <container>
  docker inspect "$1" | jq -S --argjson img "$(docker image inspect "$(img "$1")")" '
    .[0] as $c | ($img[0].Config) as $i |
    $c | del(.Id, .Created, .State, .Path, .Args, .ResolvConfPath, .HostnamePath, .HostsPath, .LogPath, .RestartCount, .Image,
             .NetworkSettings, .Mounts, .GraphDriver, .Driver, .MountLabel, .ProcessLabel, .AppArmorProfile, .ExecIDs, .SizeRw, .SizeRootFs,
             .ImageManifestDescriptor)
    | .Config.Env |= map(select(. as $e | ($i.Env // []) | index([$e]) | not))
    | .Config.Labels |= with_entries(select(.value != (($i.Labels // {})[.key])))
    | if .Config.Hostname == ($c.Id[0:12]) then del(.Config.Hostname) else . end
    | del(.Config.Image)'
}
mounts() { docker inspect -f '{{range .Mounts}}{{.Type}} {{.Source}} {{.Destination}} {{.RW}}{{println}}{{end}}' "$1" | sort; }
tick() { docker exec "$UPD" kinboard-self-update.sh >"$WORK/tick.out" 2>&1; }
ulog() { cat "$WORK/tick.out"; }
# push <local image> [container]: the registry's `next` now serves it; prints
# its digest. The local tag goes back to what the container runs, as on a
# household's machine, where only a pull moves it.
push() {
  docker tag "$1" "$REF" && docker push -q "$REF" >/dev/null || return 1
  if docker inspect "${2:-$AIO}" >/dev/null 2>&1; then docker tag "$(img "${2:-$AIO}")" "$REF"; fi
  curl -sfI \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json' \
    "http://$REG/v2/kinboard-aio/manifests/next" | tr -d '\r' | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: //p'
}
running_digest() { docker image inspect -f '{{join .RepoDigests " "}}' "$(img "$1")"; }
journal() { docker run --rm -v kbaup-updater-state:/k alpine:3 cat /k/updater/swap 2>/dev/null; }

# -------------------------------------------------------------------- images

say "Images"
docker pull -q "$APP_IMAGE" >/dev/null && docker pull -q "$BASE_IMAGE" >/dev/null || { red "cannot pull $APP_IMAGE / $BASE_IMAGE"; exit 1; }
step "webapp $APP_IMAGE ($(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$APP_IMAGE" | cut -c1-7)), household on $BASE_IMAGE"
"${SLOT[@]}" docker build -q -f "$REPO_ROOT/webapp/docker/Dockerfile.webhook" -t "$UPD_IMAGE" "$REPO_ROOT/webapp/docker" >/dev/null || { red "updater build failed"; exit 1; }
aio_build() {  # aio_build <tag> [build args...]
  local tag="$1"; shift
  "${SLOT[@]}" docker build -q --build-arg APP_IMAGE="$APP_IMAGE" --build-arg BUILD_REVISION="$rev" "$@" \
    -f "$IMAGE_DIR/aio/Dockerfile" -t "$tag" "$IMAGE_DIR/aio" >/dev/null
}
derive() {  # derive <tag> <from> <RUN line>
  printf 'FROM %s\nRUN %s\n' "$2" "$3" | docker build -q -t "$1" - >/dev/null
}
MIG='ALTER TABLE public.families ADD COLUMN IF NOT EXISTS kbaup_note text; UPDATE public.families SET kbaup_note = $$migrated$$ WHERE kbaup_note IS NULL;'
# The household's image, built here FROM the published one so that all of it
# is on this machine and can be pushed (a pulled multi-platform image has only
# this platform's layers).
derive kbaup-aio:v0 "$BASE_IMAGE" "true" || { red "v0 build failed"; exit 1; }
aio_build kbaup-aio:v1 || { red "all-in-one build failed"; exit 1; }
derive kbaup-aio:v2 kbaup-aio:v1 "printf '%s\n' '$MIG' > /app/migrations/990_kbaup_note.sql" || { red "v2 build failed"; exit 1; }
derive kbaup-aio:v3 kbaup-aio:v2 "echo 'SELECT 1/0;' > /app/migrations/991_kbaup_fails.sql" || { red "v3 build failed"; exit 1; }
MIG2='CREATE TABLE IF NOT EXISTS public.kbaup_extra (id integer PRIMARY KEY); ALTER TABLE public.families ADD COLUMN IF NOT EXISTS kbaup_more text;'
derive kbaup-aio:v5 kbaup-aio:v2 "printf '%s\n' '$MIG2' > /app/migrations/992_kbaup_extra.sql && rm /app/server.js" || { red "v5 build failed"; exit 1; }
derive kbaup-aio:v4 kbaup-aio:v2 "echo v4 > /etc/kbaup-v4" || { red "v4 build failed"; exit 1; }
if want pg18; then
  aio_build kbaup-aio:pg18base --build-arg PG_MAJOR=18 --build-arg PG_PREVIOUS_MAJORS=17 || { red "the 18-over-17 build failed"; exit 1; }
  derive kbaup-aio:pg18 kbaup-aio:pg18base "printf '%s\n' '$MIG' > /app/migrations/990_kbaup_note.sql" || { red "pg18 build failed"; exit 1; }
fi
check "the newer image carries app.kinboard.aio=1; the published base does not" \
  bash -c "[ \"\$(docker image inspect -f '{{index .Config.Labels \"app.kinboard.aio\"}}' kbaup-aio:v1)\" = 1 ] && [ \"\$(docker image inspect -f '{{index .Config.Labels \"app.kinboard.aio\"}}' '$BASE_IMAGE')\" != 1 ]"

docker run -d --name kbaup-registry -p "127.0.0.1:$P_REG:5000" registry:2 >/dev/null || { red "registry did not start"; exit 1; }
for i in $(seq 1 20); do curl -sf "http://$REG/v2/" >/dev/null && break; sleep 1; done
D0="$(push kbaup-aio:v0)"
step "the registry's next: the base image ($D0)"

# --------------------------------------------------------------------- base

say "base: a household on the all-in-one image"
mkdir -p "$WORK/data"
# Unraid's own record, as its Docker page leaves it after it pulled the base.
printf '{\n    "%s": {"local": "%s", "remote": "%s", "status": "true"},\n    "lscr.io/linuxserver/plex:latest": {"local": "sha256:%s", "remote": "sha256:%s", "status": "true"}\n}\n' \
  "$REF" "$D0" "$D0" "$(printf 1%.0s $(seq 64))" "$(printf 1%.0s $(seq 64))" >"$WORK/unraid-update-status.json"
docker run -d --name "$AIO" --restart unless-stopped --stop-timeout 60 -p "127.0.0.1:$P_AIO:3000" -v "$WORK/data:/data" \
  -e PUID="$(id -u)" -e PGID="$(id -g)" -e TZ=Europe/Berlin -e SESSION_RATE_LIMIT_PER_MINUTE=1000 \
  -l net.unraid.docker.managed=dockerman -l "net.unraid.docker.webui=http://[IP]:[PORT:3000]/" -l kbaup.household=1 \
  "$REF" >/dev/null
wait_healthy "$AIO" || { logs "$AIO" | tail -30; exit 1; }
URL="http://127.0.0.1:$P_AIO"
created="$(curl -s -X POST "$URL/api/session/create" -H 'content-type: application/json' -d '{"familyName":"kbaup family","hardwareId":"claude-kbaup-1","deviceName":"claude-kbaup-1"}')"
CODE="$(jq -r '.family.join_code // empty' <<<"$created")"
[ -n "$CODE" ] || { red "family create failed: $(head -c 200 <<<"$created")"; exit 1; }
curl -s -X POST "$URL/api/session/join" -H 'content-type: application/json' -d "{\"joinCode\":\"$CODE\",\"hardwareId\":\"claude-kbaup-2\",\"deviceName\":\"claude-kbaup-2\"}" | jq -e '.family.id' >/dev/null \
  && pass "base: a family created and a second device joined" || fail "base: join"
# The move rig's household (#583): the demo family, then a row in every table
# it leaves empty, with what COPY must escape.
{ apsql "$AIO" <"$REPO_ROOT/webapp/docker/seed-demo.sql" >/dev/null && apsql "$AIO" <"$RIG_DIR/migration-aio/fill-every-table.sql" >/dev/null; } \
  && pass "base: seed-demo.sql and fill-every-table.sql (a row in every table)" || fail "base: seeding"
mkdir -p "$WORK/data/storage/files/kbaup" && head -c 300000 /dev/urandom >"$WORK/data/storage/files/kbaup/photo.jpg"
SUM0="$(checksums "$AIO")"; FILES0="$(files_sum)"
step "$(wc -l <<<"$SUM0") tables, $(awk '{ n += $2 } END { print n }' <<<"$SUM0") rows; $(wc -l <<<"$FILES0") file(s)"

# ------------------------------------------------------------------ updater

say "updater: started as the wiki says"
docker volume create kbaup-updater-state >/dev/null
start_updater() {
  docker run -d --name "$UPD" --restart unless-stopped --network host \
    -v /var/run/docker.sock:/var/run/docker.sock -v kbaup-updater-state:/kinboard \
    -e KINBOARD_UPDATER=1 -e KINBOARD_AIO_CONTAINER="$AIO" \
    -e KINBOARD_TICK_FIRST=86400 -e KINBOARD_TICK_INTERVAL=86400 -e KINBOARD_HEALTH_POLL=3 \
    -e KINBOARD_UNRAID_STATUS_FILE="$WORK/unraid-update-status.json" \
    --entrypoint kinboard-updater "$UPD_IMAGE" >/dev/null
}
start_updater
tick; check "tick 1: a baseline, nothing pulled or recreated" grep -q "baseline recorded" "$WORK/tick.out"
check "tick 1: the container found by name, without the label (an image published before it)" grep -q "all-in-one: $AIO runs the all-in-one image" "$WORK/tick.out"
tick; check "tick 2: nothing to do" grep -q "=== tick: nothing to do ===" "$WORK/tick.out"
check "the socket is on the updater only" bash -c "! docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' $AIO | grep -q docker.sock && docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' $UPD | grep -q docker.sock"

# ------------------------------------------------------------------- update

if want update; then
  say "update: a newer image under next"
  ID0="$(cid "$AIO")"; settings "$AIO" >"$WORK/settings.0"; mounts "$AIO" >"$WORK/mounts.0"
  D1="$(push kbaup-aio:v1)"
  t0=$(date +%s); tick; rc=$?
  step "tick took $(( $(date +%s) - t0 ))s (exit $rc)"
  check "update: the tick succeeded" [ "$rc" = 0 ]
  check "update: the image's own verified dump first, as PUID:PGID, in /data/backups" \
    bash -c "grep -q 'backup: pre-update-.*\.sql\.gz in $WORK/data/backups' '$WORK/tick.out' && ls '$WORK/data/backups'/pre-update-*.sql.gz >/dev/null && [ \"\$(stat -c %u:%g '$WORK/data/backups'/pre-update-*.sql.gz | sort -u)\" = '$(id -u):$(id -g)' ] && gzip -t '$WORK/data/backups'/pre-update-*.sql.gz"
  check "update: the backup came before the swap" bash -c "awk '/backup: pre-update/ { b = NR } /set aside as/ { s = NR } END { exit !(b && s && b < s) }' '$WORK/tick.out'"
  check "update: healthy and smoke-checked" bash -c "grep -q 'healthy: aio' '$WORK/tick.out' && grep -q 'smoke check passed' '$WORK/tick.out'"
  ID1="$(cid "$AIO")"
  check "update: a new container (id changed), on the new image" bash -c "[ '$ID1' != '$ID0' ] && docker image inspect -f '{{join .RepoDigests \" \"}}' \"\$(docker inspect -f '{{.Image}}' $AIO)\" | grep -q '@$D1'"
  settings "$AIO" >"$WORK/settings.1"; mounts "$AIO" >"$WORK/mounts.1"
  if diff -u "$WORK/settings.0" "$WORK/settings.1" >"$WORK/settings.diff"; then pass "update: every setting as before, apart from the image (inspect, field by field)"; else fail "update: settings differ"; sed 's/^/     /' "$WORK/settings.diff" | head -30; fi
  check "update: the same mounts" diff -q "$WORK/mounts.0" "$WORK/mounts.1"
  check "update: only the all-in-one container was touched" bash -c "[ \"\$(docker ps -a --filter name=kbaup- --format '{{.Names}}' | sort | tr '\n' ' ')\" = 'kbaup-aio kbaup-registry kbaup-updater ' ]"
  wait_healthy "$AIO" 120 >/dev/null
  same_tables "update: every table as before (rows and checksums; the status record aside)" "$SUM0" "$(checksums "$AIO")"
  [ "$(files_sum)" = "$FILES0" ] && pass "update: every uploaded file as before" || fail "update: the files changed"
  check "update: the household's code still joins" bash -c "curl -s -X POST '$URL/api/session/join' -H 'content-type: application/json' -d '{\"joinCode\":\"$CODE\",\"hardwareId\":\"claude-kbaup-3\",\"deviceName\":\"claude-kbaup-3\"}' | jq -e .family.id >/dev/null"
  check "update: Settings' record says updated" bash -c "echo \"SELECT value::jsonb->>'status' FROM public.instance_settings WHERE key = 'update_status'\" | docker exec -i $AIO psql -X -q -U supabase_admin -d postgres -tA | grep -qx updated"
  check "update: Unraid's status file holds the new digest, the other entry untouched" \
    bash -c "jq -e --arg k '$REF' --arg d '$D1' '.[\$k] == {local: \$d, remote: \$d, status: \"true\"} and (.[\"lscr.io/linuxserver/plex:latest\"].status == \"true\")' '$WORK/unraid-update-status.json' >/dev/null"
  check "update: the label is there now, and the next tick finds the container by it" bash -c "[ \"\$(docker inspect -f '{{index .Config.Labels \"app.kinboard.aio\"}}' $AIO)\" = 1 ]"
  tick; check "update: the next tick does nothing" grep -q "=== tick: nothing to do ===" "$WORK/tick.out"
  check "update: the original is gone, its data folder is not" bash -c "! docker inspect $ID0 >/dev/null 2>&1 && [ -s '$WORK/data/db/PG_VERSION' ]"
fi

# ------------------------------------------------------------------ migrate

if want migrate; then
  say "migrate: an image with one more migration"
  SUMM="$(checksums "$AIO")"
  D2="$(push kbaup-aio:v2)"
  tick; rc=$?
  check "migrate: the tick succeeded" [ "$rc" = 0 ]
  [ "$(echo "SELECT count(*) FROM kinboard.schema_migrations WHERE name = '990_kbaup_note.sql'" | apsql "$AIO")" = 1 ] \
    && [ "$(echo "SELECT count(*) FROM public.families WHERE kbaup_note = 'migrated'" | apsql "$AIO")" -ge 1 ] \
    && pass "migrate: applied once and recorded; the new column holds what it wrote" || fail "migrate: not applied"
  check "migrate: the image took its own pre-migrate dump too" bash -c "ls '$WORK/data/backups'/pre-migrate-*.sql.gz >/dev/null 2>&1"
  check "migrate: healthy, smoke-checked" bash -c "grep -q 'healthy: aio' '$WORK/tick.out' && grep -q 'smoke check passed' '$WORK/tick.out'"
  wait_healthy "$AIO" 120 >/dev/null
  same_tables "migrate: every other table as before, families by row count (it has the new column)" \
    "$(awk '$1 == "public.families" { print $1, $2; next } { print }' <<<"$SUMM")" "$(checksums_but "$AIO" public.families)"
fi

# ------------------------------------------------------------------- broken

if want broken; then
  say "broken: an image whose migration fails"
  ID2="$(cid "$AIO")"; IMG2="$(img "$AIO")"; SUMB="$(checksums "$AIO")"
  D3="$(push kbaup-aio:v3)"
  tick; rc=$?
  check "broken: the tick reports the rollback" bash -c "[ $rc != 0 ] && grep -q 'ROLLED BACK' '$WORK/tick.out'"
  check "broken: the original container back (same id, same image), running" bash -c "[ \"\$(docker inspect -f '{{.Id}} {{.Image}} {{.State.Running}}' $AIO)\" = '$ID2 $IMG2 true' ]"
  wait_healthy "$AIO" 300 >/dev/null
  same_tables "broken: every table as before the update" "$SUMB" "$(checksums "$AIO")"
  check "broken: the failed migration named" grep -q "991_kbaup_fails" "$WORK/tick.out"
  check "broken: the release held" bash -c "docker run --rm -v kbaup-updater-state:/k alpine:3 cat /k/updater/state | grep -q '^held .* $D3\$'"
  check "broken: the tag points at the running image again" bash -c "[ \"\$(docker image inspect -f '{{.Id}}' '$REF')\" = '$IMG2' ]"
  check "broken: Settings' record says rolled back" bash -c "echo \"SELECT value::jsonb->>'status' FROM public.instance_settings WHERE key = 'update_status'\" | docker exec -i $AIO psql -X -q -U supabase_admin -d postgres -tA | grep -qx rolled_back"
  tick; check "broken: the next tick holds it and changes nothing" bash -c "grep -q 'was rolled back before; waiting for a newer one' '$WORK/tick.out' && [ \"\$(docker inspect -f '{{.Id}}' $AIO)\" = '$ID2' ]"
fi

# ------------------------------------------------------------- newer-schema

if want newer-schema; then
  say "newer-schema: the new image migrates, then never starts"
  IDN="$(cid "$AIO")"; IMGN="$(img "$AIO")"
  push kbaup-aio:v5 >/dev/null
  t0=$(date +%s)
  docker exec -e KINBOARD_HEALTH_TIMEOUT=240 "$UPD" kinboard-self-update.sh >"$WORK/tick.out" 2>&1; rc=$?
  step "tick took $(( $(date +%s) - t0 ))s (exit $rc)"
  check "newer-schema: rolled back to the original (same id, same image), running" \
    bash -c "[ $rc != 0 ] && grep -q 'ROLLED BACK' '$WORK/tick.out' && [ \"\$(docker inspect -f '{{.Id}} {{.Image}} {{.State.Running}}' $AIO)\" = '$IDN $IMGN true' ]"
  check "newer-schema: the original passed its health and smoke check on it" bash -c "awk '/rolling back/ { r = 1 } r && /smoke check passed/ { ok = 1 } END { exit !ok }' '$WORK/tick.out'"
  [ "$(echo "SELECT count(*) FROM kinboard.schema_migrations WHERE name = '992_kbaup_extra.sql'" | apsql "$AIO")" = 1 ] \
    && [ "$(echo "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'families' AND column_name = 'kbaup_more'" | apsql "$AIO")" = 1 ] \
    && [ "$(echo "SELECT to_regclass('public.kbaup_extra') IS NOT NULL" | apsql "$AIO")" = t ] \
    && pass "newer-schema: the schema is the new one's (992 recorded, its table and column there)" || fail "newer-schema: the new schema is not there"
  wait_healthy "$AIO" 300 >/dev/null
  check "newer-schema: the older image applied nothing and refused nothing on it" bash -c "docker logs --since 5m $AIO 2>&1 | grep -q '\[migrate\] done: 0 applied' && ! docker logs --since 5m $AIO 2>&1 | grep -q 'FAILED'"
  check "newer-schema: the household's code still joins" bash -c "curl -s -X POST '$URL/api/session/join' -H 'content-type: application/json' -d '{\"joinCode\":\"$CODE\",\"hardwareId\":\"claude-kbaup-4\",\"deviceName\":\"claude-kbaup-4\"}' | jq -e .family.id >/dev/null"
fi

# --------------------------------------------------------------------- kill

if want kill; then
  say "kill: the tick killed in the middle of the swap"
  IDK="$(cid "$AIO")"; IMGK="$(img "$AIO")"
  D4="$(push kbaup-aio:v4)"
  docker exec "$UPD" kinboard-self-update.sh >"$WORK/kill.out" 2>&1 &
  bg=$!
  killed=""
  for i in $(seq 1 600); do
    if grep -q "set aside as $AIO-before-update" "$WORK/kill.out" 2>/dev/null; then
      docker kill "$AIO-updater-tick" >/dev/null 2>&1 && killed=1
      break
    fi
    sleep 0.2
  done
  wait "$bg" 2>/dev/null || true
  check "kill: killed after the swap began (the original set aside)" bash -c "[ -n '$killed' ] && docker inspect $AIO-before-update >/dev/null 2>&1"
  check "kill: the journal records it" bash -c "docker run --rm -v kbaup-updater-state:/k alpine:3 cat /k/updater/swap | grep -q '^aio $IDK '"
  docker restart "$UPD" >/dev/null
  for i in $(seq 1 120); do docker logs "$UPD" 2>&1 | grep -q "the containers from before the interrupted update run again" && break; sleep 2; done
  check "kill: the updater's start put the original back at once" bash -c "docker logs $UPD 2>&1 | grep -q 'an update was cut short' && [ \"\$(docker inspect -f '{{.Id}} {{.Image}} {{.State.Running}}' $AIO)\" = '$IDK $IMGK true' ] && ! docker inspect $AIO-before-update >/dev/null 2>&1"
  check "kill: no journal left" bash -c "! docker run --rm -v kbaup-updater-state:/k alpine:3 test -e /k/updater/swap"
  wait_healthy "$AIO" 300 >/dev/null
  tick; rc=$?
  check "kill: the next tick updates (cut short is not held)" bash -c "[ $rc = 0 ] && docker image inspect -f '{{join .RepoDigests \" \"}}' \"\$(docker inspect -f '{{.Image}}' $AIO)\" | grep -q '@$D4'"
fi

# --------------------------------------------------------------------- pg18

if want pg18; then
  say "pg18: an image on PostgreSQL 18"
  SUMP="$(checksums "$AIO")"
  D5="$(push kbaup-aio:pg18)"
  t0=$(date +%s); tick; rc=$?
  step "tick took $(( $(date +%s) - t0 ))s (exit $rc)"
  check "pg18: the updater saw the major and waited the upgrade's limit" grep -q "the new image runs PostgreSQL 18, $AIO runs 17" "$WORK/tick.out"
  check "pg18: healthy, smoke-checked" bash -c "[ $rc = 0 ] && grep -q 'healthy: aio' '$WORK/tick.out' && grep -q 'smoke check passed' '$WORK/tick.out'"
  check "pg18: /data/db is 18, /data/db.old 17 (kept)" bash -c "[ \"\$(cat '$WORK/data/db/PG_VERSION')\" = 18 ] && [ \"\$(cat '$WORK/data/db.old/PG_VERSION')\" = 17 ]"
  check "pg18: the image's own pre-upgrade dump" bash -c "ls '$WORK/data/backups'/pre-pg18-upgrade-*.sql.gz >/dev/null 2>&1"
  wait_healthy "$AIO" 300 >/dev/null
  same_tables "pg18: every table as before" "$SUMP" "$(checksums "$AIO")"
  tick; check "pg18: the next tick does nothing" grep -q "=== tick: nothing to do ===" "$WORK/tick.out"
fi

# ------------------------------------------------------------------ compose

if want compose; then
  say "compose: the wiki's snippet"
  docker rm -f "$UPD" "$AIO" >/dev/null
  mkdir -p "$WORK/cmp/data"
  push kbaup-aio:v1 kbaup-cmp-aio >/dev/null
  cat >"$WORK/cmp/compose.yml" <<YAML
services:
  kinboard:
    image: $REF
    container_name: kbaup-cmp-aio
    restart: unless-stopped
    stop_grace_period: 60s
    ports: ["127.0.0.1:$P_CMP:3000"]
    environment:
      PUID: "$(id -u)"
      PGID: "$(id -g)"
    volumes: ["$WORK/cmp/data:/data"]
  kinboard-updater:
    image: $UPD_IMAGE
    container_name: kbaup-cmp-updater
    restart: unless-stopped
    network_mode: host
    entrypoint: ["kinboard-updater"]
    environment:
      KINBOARD_UPDATER: "1"
      KINBOARD_AIO_CONTAINER: kbaup-cmp-aio
      KINBOARD_TICK_FIRST: "86400"
      KINBOARD_HEALTH_POLL: "3"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - kbaup-cmp-updater:/kinboard
volumes:
  kbaup-cmp-updater:
    name: kbaup-cmp-updater
YAML
  docker compose -p kbaup-cmp -f "$WORK/cmp/compose.yml" up -d >/dev/null 2>&1 || fail "compose: up"
  wait_healthy kbaup-cmp-aio || logs kbaup-cmp-aio | tail -20
  docker exec kbaup-cmp-updater kinboard-self-update.sh >"$WORK/tick.out" 2>&1
  push kbaup-aio:v2 kbaup-cmp-aio >/dev/null
  IDC="$(cid kbaup-cmp-aio)"
  docker exec kbaup-cmp-updater kinboard-self-update.sh >"$WORK/tick.out" 2>&1; rc=$?
  check "compose: the updater in the same project updates the all-in-one service" bash -c "[ $rc = 0 ] && [ \"\$(docker inspect -f '{{.Id}}' kbaup-cmp-aio)\" != '$IDC' ] && grep -q 'healthy: aio' '$WORK/tick.out'"
  IDC2="$(cid kbaup-cmp-aio)"
  docker compose -p kbaup-cmp -f "$WORK/cmp/compose.yml" up -d >"$WORK/cmp-up.out" 2>&1
  check "compose: a later Up leaves the recreated container alone" bash -c "[ \"\$(docker inspect -f '{{.Id}}' kbaup-cmp-aio)\" = '$IDC2' ]"
  check "compose: it is still in the project" bash -c "docker compose -p kbaup-cmp -f '$WORK/cmp/compose.yml' ps -q kinboard | grep -q ."
fi

# ------------------------------------------------------------------- leftovers

