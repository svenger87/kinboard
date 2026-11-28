#!/usr/bin/env bash
# test-aio-backups.sh: the all-in-one image's scheduled backups on real
# containers, and a restore of one into a fresh install, the way the wiki's
# All-in-one page ("Backups") says.
#
#   unraid    (A) an all-in-one container set up as Unraid's template does
#             it: PUID 99, PGID 100, a /backups folder owned 99:100 (a new
#             Unraid share), and the schedule set by the server
#             (KINBOARD_BACKUP_SCHEDULE=daily, KINBOARD_BACKUP_KEEP=2, the
#             time a few minutes after the start). A household seeded into
#             every table, photos in the files folder. Then: the scheduled
#             backup runs at its time, into /backups, 0600 and owned 99:100;
#             Settings' route shows it, says the server sets the schedule and
#             refuses to change it (409); "Back up now" three times keeps
#             two; the download hands out the newest byte for byte, once; a
#             wrong PIN and another family are refused; the update's dump
#             (kinboard-updater's own command) waits for a running backup
#   restore   (B) the newest backup, restored per the wiki into a fresh
#             all-in-one container on an empty folder: every table by row
#             count and checksum (computed on both databases, not taken from
#             the archive), every uploaded file by SHA-256, the keys; then a
#             backup on the restored install, into the default
#             /data/backups/scheduled (0700, files 0600)
#   diskfull  (C) /backups a 40 MB tmpfs that Docker mounts as root, empty:
#             handed to PUID at the start; one backup; then more photos than
#             the room left: the backup fails with the disk full, the last
#             good one stays, nothing half-written is left, Settings says it
#             failed; room again, and the next one is good
#
# Usage:
#   KINBOARD_RIG=1 scripts/rigs/test-aio-backups.sh
#   RIG_IMAGE=<image:tag>   the webapp image (default: built from this checkout)
#   AIO_IMAGE=<image:tag>   the all-in-one image (default: built FROM RIG_IMAGE)
#   RIG_PHASES="unraid restore diskfull"   a subset (restore needs unraid)
#   KEEP_FAILED=1                           leave everything after a failure
#
# Isolation: containers kbsb-*, ports 3191-3193 on 127.0.0.1, bind folders in
# a temporary folder. It refuses to start while anything named kbsb-* exists
# or a port is taken, and removes only what it made.

set -uo pipefail

RIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=rig-intent.sh
. "$RIG_DIR/rig-intent.sh"
rig_require_intent "$@"; set -- "${RIG_ARGS[@]}"
REPO_ROOT="$(cd "$RIG_DIR/../.." && pwd)"
SEED_SQL="$REPO_ROOT/webapp/docker/seed-demo.sql"
HERE="$RIG_DIR/migration-aio"

AIO_IMAGE="${AIO_IMAGE:-}"
RIG_PHASES="${RIG_PHASES:-unraid restore diskfull}"
KEEP_FAILED="${KEEP_FAILED:-0}"
P_A=3191 P_R=3192 P_F=3193
PIN=2468
TZ_HOUSE=Europe/Berlin

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
step() { printf '   %s\n' "$*"; }
FAILURES=()
CHECKS=0
METRICS=()
fail() { red "   FAIL: $*"; FAILURES+=("$*"); CHECKS=$((CHECKS + 1)); }
pass() { grn "   ok:   $*"; CHECKS=$((CHECKS + 1)); }
check() { local what="$1"; shift; if "$@"; then pass "$what"; else fail "$what"; fi; }
metric() { METRICS+=("$1=$2"); step "metric $1=$2"; }
want() { case " $RIG_PHASES " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

WORK=""
BUILT=()
SLOT=(); command -v kinboard-heavy-slot >/dev/null && SLOT=(kinboard-heavy-slot)
containers() { docker ps -a --format '{{.Names}}' | grep -E '^kbsb-' || true; }
on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if [ "$KEEP_FAILED" = 1 ] && [ ${#FAILURES[@]} -gt 0 ]; then
    red "KEEP_FAILED=1: kbsb-* left up; work folder $WORK"
  else
    containers | xargs -r docker rm -f >/dev/null 2>&1 || true
    if [ -n "$WORK" ]; then
      docker run --rm -v "$WORK:/w" alpine:3 sh -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1 || true
      rm -rf "$WORK"
    fi
    local i; for i in "${BUILT[@]}"; do docker image rm "$i" >/dev/null 2>&1 || true; done
  fi
  echo
  if [ ${#METRICS[@]} -gt 0 ]; then say "numbers"; printf '   %s\n' "${METRICS[@]}"; fi
  if [ ${#FAILURES[@]} -gt 0 ]; then say "failed"; printf '   - %s\n' "${FAILURES[@]}"; fi
  if [ ${#FAILURES[@]} -eq 0 ] && [ "$rc" = 0 ]; then grn "test-aio-backups: $CHECKS checks, all passed"; else red "test-aio-backups: $CHECKS checks, ${#FAILURES[@]} failed"; [ "$rc" = 0 ] && rc=1; fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

say "Scheduled backups of the all-in-one image, and a restore"
for tool in docker curl jq sha256sum ss; do command -v "$tool" >/dev/null || { red "needs $tool"; exit 1; }; done
[ -z "$(containers)" ] || { red "kbsb-* containers exist: another run? Remove them by name first."; exit 1; }
for p in $P_A $P_R $P_F; do
  grep -qE "[:.]${p}\$" < <(ss -lnt 2>/dev/null | awk '{print $4}') && { red "port $p is in use"; exit 1; }
done
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kbsb.XXXXXX")"
chmod 0755 "$WORK"
rev="$(git -C "$REPO_ROOT" rev-parse --short=7 HEAD 2>/dev/null || echo dev)"
if [ -z "$AIO_IMAGE" ]; then
  if [ -z "${RIG_IMAGE:-}" ]; then
    RIG_IMAGE="kbsb-rig-webapp:$rev"
    say "Building the webapp image ($RIG_IMAGE)"
    "${SLOT[@]}" docker build -q --label kb.agent=kbsb-rig --build-arg BUILD_REVISION="$rev" -f "$REPO_ROOT/webapp/image/Dockerfile" -t "$RIG_IMAGE" "$REPO_ROOT/webapp" >/dev/null \
      || { red "webapp build failed"; exit 1; }
    BUILT+=("$RIG_IMAGE")
  fi
  AIO_IMAGE="kbsb-rig-aio:$rev"
  say "Building the all-in-one image ($AIO_IMAGE, FROM $RIG_IMAGE)"
  "${SLOT[@]}" docker build -q --label kb.agent=kbsb-rig --build-arg APP_IMAGE="$RIG_IMAGE" --build-arg BUILD_REVISION="$rev" \
    -f "$REPO_ROOT/webapp/image/aio/Dockerfile" -t "$AIO_IMAGE" "$REPO_ROOT/webapp/image/aio" >/dev/null || { red "all-in-one build failed"; exit 1; }
  BUILT+=("$AIO_IMAGE")
fi
docker image inspect "$AIO_IMAGE" >/dev/null 2>&1 || { red "no image $AIO_IMAGE"; exit 1; }
step "image $AIO_IMAGE; work folder $WORK"

# ------------------------------------------------------------------ helpers

wait_healthy() {
  local name="$1" max="${2:-420}" i st
  for ((i = 0; i < max; i += 2)); do
    st="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name" 2>/dev/null)"
    case "$st" in
      "running healthy") return 0 ;;
      exited*) step "$name exited ($(docker inspect -f '{{.State.ExitCode}}' "$name"))"; docker logs --tail 30 "$name" 2>&1 | sed 's/^/     /'; return 1 ;;
    esac
    sleep 2
  done
  step "$name not healthy within ${max}s ($st)"; return 1
}
# wait_http <base>: /api/health answers with the database up (after an import
# restarts the webapp, Docker's health status still says healthy for a while).
wait_http() { local i; for i in $(seq 1 90); do curl -sf --max-time 3 "$1/api/health" | jq -e '.db == true' >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }
sql() { local c="$1"; shift; docker exec -i "$c" psql -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -tA "$@"; }
checksums() { sql "$1" <"$HERE/table-checksums.sql"; }
# Written by the running app on its own (heartbeats, notification runs, the
# attention engine, instance settings with the import's nonce): compared by
# key in the migration rig; here left out of the strict comparison.
VOLATILE='^public\.(system_heartbeats|instance_settings|scheduled_notifications|notification_logs|attention_items|domain_events) '
files_of() { docker exec "$1" sh -c "cd '$2' && find . -type f ! -path './.kinboard-*' -exec sha256sum {} +" | sort -k2; }
secrets_of() { docker exec "$1" sh -c 'cd /data/config/secrets && for f in jwt_secret vapid_public_key vapid_private_key cron_secret presence_sensor_token; do printf "%s=" "$f"; cat "$f"; echo; done'; }
host_ls() { docker run --rm -v "$1:/b:ro" alpine:3 sh -c 'cd /b && for f in $(ls -A); do stat -c "%a %u:%g %s %n" "$f"; done'; }

# seed <container> <files owner>: the demo family, then a row in every table, then photos.
seed() {
  docker exec -i "$1" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 <"$SEED_SQL" >/dev/null \
    && sql "$1" <"$HERE/fill-every-table.sql" >/dev/null || return 1
  docker exec -u "$2" "$1" sh -c 'd=/data/storage/files/recipe-images/00000000-0000-0000-0000-000000000001; mkdir -p "$d/odd" \
    && head -c 3145728 /dev/urandom >"$d/big.jpg" && printf x >"$d/odd/Grüße mit Leerzeichen.jpg" && : >"$d/odd/empty.jpg" \
    && head -c 20000 /dev/urandom >/data/storage/files/family-photos.jpg'
}
# login <base> <jar> <family code> <device>: a session cookie in the jar.
login() {
  curl -s -c "$2" -X POST "$1/api/session/join" -H 'content-type: application/json' \
    -d "{\"joinCode\":\"$3\",\"hardwareId\":\"claude-sb-$4\",\"deviceName\":\"claude-sb-$4\"}" | jq -r '.family.id // empty'
}
set_pin() { curl -s -b "$2" -X POST "$1/api/pin" -H 'content-type: application/json' -d "{\"family_id\":\"$3\",\"action\":\"set\",\"pin\":\"$PIN\"}" | jq -r '.success // .error'; }
status_of() { curl -s -b "$2" "$1/api/scheduled-backup"; }
post() { curl -s -o "$WORK/post.json" -w '%{http_code}' -b "$2" -X POST "$1/api/scheduled-backup" -H 'content-type: application/json' -d "$3"; }
# backup_now <base> <jar>: starts one and waits for its end; prints ok/failed.
backup_now() {
  local code i st
  code="$(post "$1" "$2" "{\"action\":\"run\",\"pin\":\"$PIN\"}")"
  [ "$code" = 202 ] || { echo "start:$code:$(cat "$WORK/post.json")"; return 1; }
  for i in $(seq 1 120); do
    st="$(status_of "$1" "$2")"
    if [ "$(jq -r '.scheduledBackup.running' <<<"$st")" = false ]; then
      jq -r 'if .scheduledBackup.lastAttempt.ok then "ok" else "failed: " + (.scheduledBackup.lastAttempt.error // "?") end' <<<"$st"
      return 0
    fi
    sleep 1
  done
  echo "timeout"
}

A=kbsb-a; R=kbsb-r; F=kbsb-f
BASE_A="http://127.0.0.1:$P_A"; BASE_R="http://127.0.0.1:$P_R"; BASE_F="http://127.0.0.1:$P_F"
JAR_A="$WORK/a.jar"; JAR_R="$WORK/r.jar"; JAR_F="$WORK/f.jar"
COMMON=(--stop-timeout 60 -e "TZ=$TZ_HOUSE" -e SESSION_RATE_LIMIT_PER_MINUTE=1000 -e KINBOARD_BACKUP_FIRST_CHECK_SECONDS=15 -e KINBOARD_BACKUP_CHECK_SECONDS=10)

# ================================================================= A: unraid
if want unraid; then
  say "A: Unraid's shape: PUID 99:100, a /backups share, the schedule from the server"
  mkdir -p "$WORK/a-data" "$WORK/a-backups"
  docker run --rm -v "$WORK/a-backups:/b" alpine:3 sh -c 'chown 99:100 /b && chmod 0777 /b' >/dev/null
  # The slot: four minutes from now on the household's clock (the first look arms it first).
  SLOT_HM="$(TZ=$TZ_HOUSE date -d '+4 min' +%H:%M)"
  docker run -d --name $A -p "127.0.0.1:$P_A:3000" -v "$WORK/a-data:/data" -v "$WORK/a-backups:/backups" \
    -e PUID=99 -e PGID=100 -e KINBOARD_BACKUP_SCHEDULE=daily -e "KINBOARD_BACKUP_TIME=$SLOT_HM" -e KINBOARD_BACKUP_KEEP=2 \
    "${COMMON[@]}" "$AIO_IMAGE" >/dev/null
  check "A starts healthy" wait_healthy $A
  check "A: the household seeded (every table, photos)" seed $A 99:100
  FAM_A="$(login "$BASE_A" "$JAR_A" DEMO01 a)"
  check "A: a device joins the family" test -n "$FAM_A"
  check "A: the settings PIN is set" test "$(set_pin "$BASE_A" "$JAR_A" "$FAM_A")" = true
  ST="$(status_of "$BASE_A" "$JAR_A")"
  check "A: Settings shows the server's schedule (daily at $SLOT_HM, keep 2, set by the server)" \
    test "$(jq -r '.scheduledBackup.config | "\(.frequency) \(.time) \(.keep) \(.source)"' <<<"$ST")" = "daily $SLOT_HM 2 server"
  check "A: the backups go into the mapped /backups" test "$(jq -r '.scheduledBackup.location | "\(.dir) \(.source)"' <<<"$ST")" = "/backups mount"
  step "next run: $(jq -r '.scheduledBackup.nextRunAt' <<<"$ST")"
  check "A: Settings can't change a schedule the server sets (409)" \
    test "$(post "$BASE_A" "$JAR_A" "{\"action\":\"save\",\"pin\":\"$PIN\",\"config\":{\"frequency\":\"off\",\"time\":\"03:00\",\"day\":0,\"keep\":7}}")" = 409

  say "A: the scheduled backup at $SLOT_HM ($TZ_HOUSE)"
  slot_epoch="$(TZ=$TZ_HOUSE date -d "$SLOT_HM" +%s)"
  ran=""
  for i in $(seq 1 60); do
    ST="$(status_of "$BASE_A" "$JAR_A")"
    if [ "$(jq -r '.scheduledBackup.lastSuccess.trigger // empty' <<<"$ST")" = schedule ]; then ran=1; break; fi
    sleep 10
  done
  check "A: the scheduled backup ran by itself, at its time" test -n "$ran"
  started="$(jq -r '.scheduledBackup.lastSuccess.startedAt' <<<"$ST")"
  started_epoch="$(date -d "$started" +%s 2>/dev/null || echo 0)"
  check "A: ...not before $SLOT_HM, and within a look of it (started $started)" test "$started_epoch" -ge "$slot_epoch" -a "$started_epoch" -le "$((slot_epoch + 60))"
  metric "scheduled.delay_s" "$((started_epoch - slot_epoch))"
  docker logs $A 2>&1 | grep -E '\[(scheduled-)?backup\]' | tail -4 | sed 's/^/     /'
  LS="$(host_ls "$WORK/a-backups")"
  echo "$LS" | sed 's/^/     /'
  check "A: one backup in /backups, 0600, owned 99:100, nothing half-written" \
    test "$(echo "$LS" | awk '$1 == "600" && $2 == "99:100" && $4 ~ /^kinboard-backup-[0-9]{8}T[0-9]{6}Z-.*\.tar\.gz$/' | wc -l) $(echo "$LS" | grep -c ' \.')" = "1 0"
  build_rev="$(docker exec $A sed -n 's/^revision=//p' /etc/kinboard-aio/build | cut -c1-7)"
  [ -z "$build_rev" ] || check "A: the name says the image a restore starts (sha-$build_rev)" grep -q -- "-sha-$build_rev\.tar\.gz" <<<"$LS"
  check "A: the household's /backups folder kept its own mode (0777) and owner" test "$(docker run --rm -v "$WORK/a-backups:/b:ro" alpine:3 stat -c '%a %u:%g' /b)" = "777 99:100"
  check "A: the next run is tomorrow at $SLOT_HM" test "$(TZ=$TZ_HOUSE date -d "$(jq -r '.scheduledBackup.nextRunAt' <<<"$(status_of "$BASE_A" "$JAR_A")")" +%H:%M)" = "$SLOT_HM"

  say "A: Back up now, three times: two kept"
  for n in 1 2 3; do
    r="$(backup_now "$BASE_A" "$JAR_A")"
    check "A: Back up now #$n: $r" test "$r" = ok
    sleep 1
  done
  LS="$(host_ls "$WORK/a-backups")"
  check "A: retention trims to KINBOARD_BACKUP_KEEP=2, all 0600 99:100" \
    test "$(echo "$LS" | awk '$1 == "600" && $2 == "99:100"' | wc -l) $(echo "$LS" | wc -l)" = "2 2"
  metric "backup.bytes" "$(echo "$LS" | awk '{print $3}' | tail -1)"

  say "A: the gates"
  check "A: a wrong PIN is refused (403)" test "$(post "$BASE_A" "$JAR_A" '{"action":"run","pin":"0000"}')" = 403
  sql $A -c "INSERT INTO public.families (id, name, join_code, setup_completed) VALUES ('00000000-0000-0000-0000-0000000000b2', 'Other', 'OTHER2', true)" >/dev/null
  FAM_O="$(login "$BASE_A" "$WORK/o.jar" OTHER2 o)"
  check "A: another family sees nothing (null)" test "$(status_of "$BASE_A" "$WORK/o.jar" | jq -c .scheduledBackup)" = null
  check "A: another family can't start one (403)" test "$(post "$BASE_A" "$WORK/o.jar" "{\"action\":\"run\",\"pin\":\"$PIN\"}")" = 403
  check "A: without a session, 401" test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_A/api/scheduled-backup")" = 401

  say "A: Download"
  code="$(post "$BASE_A" "$JAR_A" "{\"action\":\"download\",\"pin\":\"$PIN\"}")"
  url="$(jq -r '.url // empty' "$WORK/post.json")"
  check "A: a download link for the operator with the PIN ($code)" test "$code" = 200 -a -n "$url"
  check "A: another family's session can't use it (404)" test "$(curl -s -o /dev/null -w '%{http_code}' -b "$WORK/o.jar" "$BASE_A$url")" = 404
  curl -s -b "$JAR_A" -D "$WORK/dl.h" -o "$WORK/dl.tar.gz" "$BASE_A$url"
  newest="$(echo "$LS" | awk '{print $4}' | sort | tail -1)"
  check "A: the newest backup, byte for byte" test "$(sha256sum <"$WORK/dl.tar.gz" | cut -c1-64)" = "$(docker exec $A sha256sum "/backups/$newest" | cut -c1-64)"
  check "A: ...as an attachment named after it" grep -qi "content-disposition: attachment; filename=\"$newest\"" "$WORK/dl.h"
  check "A: the link works once" test "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_A" "$BASE_A$url")" = 404

  say "A: an update's dump waits for a running backup"
  docker exec -u 99:100 $A sh -c 'head -c 62914560 /dev/urandom >/data/storage/files/large-video.bin'
  post "$BASE_A" "$JAR_A" "{\"action\":\"run\",\"pin\":\"$PIN\"}" >/dev/null
  sleep 1
  # kinboard-updater's own command (kinboard-self-update.sh, aio_backup).
  t0=$(date +%s)
  upd="$(docker exec -u 99:100 -e PGHOST=/run/postgresql -e PGUSER=supabase_admin -e PGDATABASE=postgres -e BACKUP_KEEP=5 $A \
        sh -c 'exec sh /app/kinboard-backup.sh "${KINBOARD_MIGRATE_BACKUP_DIR:-/data/backups}" pre-update' 2>&1)"
  rc=$?
  echo "$upd" | sed 's/^/     /'
  check "A: the update's dump said it waited for the scheduled backup, and then succeeded" test "$rc" = 0 -a -n "$(grep 'waiting for it to finish' <<<"$upd")"
  ST="$(status_of "$BASE_A" "$JAR_A")"
  check "A: the backup it waited for finished first, verified" test "$(jq -r '.scheduledBackup.running, .scheduledBackup.lastAttempt.ok' <<<"$ST" | tr '\n' ' ')" = "false true "
  fin="$(date -d "$(jq -r '.scheduledBackup.lastAttempt.finishedAt' <<<"$ST")" +%s)"
  check "A: ...before the update's dump began (it finished at $fin, the dump returned at $(date +%s))" test "$fin" -le "$(date +%s)"
  metric "lock.wait_s" "$(( $(date +%s) - t0 ))"
  docker exec -u 99:100 $A rm -f /data/storage/files/large-video.bin
fi

# =============================================================== B: restore
if want restore && want unraid; then
  say "B: a restore per the wiki, into a fresh all-in-one container"
  # The household as it is when its backup is taken.
  checksums $A | grep -vE "$VOLATILE" >"$WORK/a.sums"
  files_of $A /data/storage/files >"$WORK/a.files"
  secrets_of $A >"$WORK/a.secrets"
  r="$(backup_now "$BASE_A" "$JAR_A")"
  check "B: the backup to restore: $r" test "$r" = ok
  newest="$(host_ls "$WORK/a-backups" | awk '{print $4}' | sort | tail -1)"
  step "restoring $newest"
  mkdir -p "$WORK/r-data"
  docker run -d --name $R -p "127.0.0.1:$P_R:3000" -v "$WORK/r-data:/data" "${COMMON[@]}" "$AIO_IMAGE" >/dev/null
  check "B: the fresh install starts healthy" wait_healthy $R
  # The wiki's command, with this rig's container name and the backup's path.
  docker run --rm -v "$WORK/a-backups:/b:ro" alpine:3 cat "/b/$newest" >"$WORK/restore.tar.gz"
  t0=$(date +%s)
  docker exec -i $R kinboard import - <"$WORK/restore.tar.gz" >"$WORK/import.log" 2>&1
  rc=$?
  tail -3 "$WORK/import.log" | sed 's/^/     /'
  check "B: kinboard import accepted the scheduled backup" test "$rc" = 0
  metric "restore.import_s" "$(( $(date +%s) - t0 ))"
  sleep 5
  check "B: the app answers again after the import, with its database" wait_http "$BASE_R"
  check "B: healthy after the import" wait_healthy $R 120
  checksums $R | grep -vE "$VOLATILE" >"$WORK/r.sums"
  n="$(wc -l <"$WORK/a.sums")"; rows="$(awk '{s += $2} END {print s}' "$WORK/a.sums")"
  if [ "$n" -gt 50 ] && diff "$WORK/a.sums" "$WORK/r.sums" >"$WORK/sums.diff"; then pass "B: every table the same, rows and checksums ($n tables, $rows rows)"; else fail "B: tables differ"; head "$WORK/sums.diff" | sed 's/^/     /'; fi
  metric "restore.tables" "$n"; metric "restore.rows" "$rows"
  files_of $R /data/storage/files >"$WORK/r.files"
  check "B: every uploaded file byte for byte ($(wc -l <"$WORK/a.files") files, SHA-256)" diff "$WORK/a.files" "$WORK/r.files"
  check "B: the keys that travel arrived (login key, push pair, cron, presence)" diff "$WORK/a.secrets" <(secrets_of $R)
  check "B: the database password is the fresh install's own" test "$(docker exec $R cat /data/config/secrets/postgres_password)" != "$(docker exec $A cat /data/config/secrets/postgres_password)"
  check "B: the A device's session cookie is still signed in on the restored install" test "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_A" "$BASE_R/api/scheduled-backup")" = 200
  FAM_R="$(login "$BASE_R" "$JAR_R" DEMO01 r)"
  check "B: the family's code lets a new device in" test "$FAM_R" = "$FAM_A"
  ST="$(status_of "$BASE_R" "$JAR_R")"
  check "B: the restored install's backups default to /data/backups/scheduled, off" test "$(jq -r '.scheduledBackup | "\(.location.dir) \(.location.source) \(.config.frequency)"' <<<"$ST")" = "/data/backups/scheduled data off"
  r="$(backup_now "$BASE_R" "$JAR_R")"
  check "B: a backup of the restored install, with the restored PIN: $r" test "$r" = ok
  check "B: ...in a 0700 folder, the file 0600 and the server's own (1000)" \
    test "$(docker exec $R sh -c 'stat -c "%a %u" /data/backups/scheduled; stat -c "%a %u" /data/backups/scheduled/kinboard-backup-*' | tr '\n' ' ')" = "700 1000 600 1000 "
fi

# ============================================================== C: diskfull
if want diskfull; then
  say "C: a full disk on the backup folder"
  mkdir -p "$WORK/f-data"
  docker run -d --name $F -p "127.0.0.1:$P_F:3000" -v "$WORK/f-data:/data" --tmpfs /backups:size=40m,mode=0755 \
    -e KINBOARD_BACKUP_SCHEDULE=weekly -e KINBOARD_BACKUP_KEEP=3 "${COMMON[@]}" "$AIO_IMAGE" >/dev/null
  check "C starts healthy" wait_healthy $F
  check "C: the empty, root-owned /backups mount was handed to PUID, 0700" test "$(docker exec $F stat -c '%a %u:%g' /backups)" = "700 1000:1000"
  docker logs $F 2>&1 | grep -F 'handing the empty backup folder' | sed 's/^/     /'
  check "C: the household seeded" seed $F 1000:1000
  FAM_F="$(login "$BASE_F" "$JAR_F" DEMO01 f)"
  set_pin "$BASE_F" "$JAR_F" "$FAM_F" >/dev/null
  r="$(backup_now "$BASE_F" "$JAR_F")"
  check "C: the first backup: $r" test "$r" = ok
  first="$(docker exec $F sh -c 'ls /backups')"
  # More photos than the room left: the check before the run passes (it goes by the last backup's size), the write runs out.
  docker exec -u 1000:1000 $F sh -c 'head -c 31457280 /dev/urandom >/data/storage/files/holiday.mov'
  free_kb="$(docker exec $F df -k /backups | awk 'NR==2 {print $4}')"
  last_kb="$(docker exec $F du -k "/backups/$first" | cut -f1)"
  keep_kb=$(( (last_kb * 11 / 10) + 16384 + 4096 ))
  docker exec -u 1000:1000 $F sh -c "head -c $(( (free_kb - keep_kb) * 1024 )) /dev/zero >/backups/filler"
  step "free on /backups: $(docker exec $F df -k /backups | awk 'NR==2 {print $4}') KB; the new backup needs about 31 MB"
  r="$(backup_now "$BASE_F" "$JAR_F")"
  check "C: the backup fails, saying the disk is full: $r" grep -qi "full" <<<"$r"
  check "C: the last good backup is still there, alone (no half-written file)" test "$(docker exec $F sh -c 'ls -A /backups | grep -v ^filler$')" = "$first"
  ST="$(status_of "$BASE_F" "$JAR_F")"
  check "C: Settings shows the failure (failing, the reason, the last good one)" \
    test "$(jq -r '.scheduledBackup | "\(.failing) \(.lastSuccess.file)"' <<<"$ST")" = "true $first"
  docker exec $F rm -f /backups/filler
  r="$(backup_now "$BASE_F" "$JAR_F")"
  check "C: with room again, the next one is good: $r" test "$r" = ok
  check "C: ...and the failure is cleared" test "$(status_of "$BASE_F" "$JAR_F" | jq -r .scheduledBackup.failing)" = false
  check "C: two backups now, both 0600" test "$(docker exec $F sh -c 'stat -c %a /backups/kinboard-backup-*' | sort -u | tr '\n' ' ')$(docker exec $F sh -c 'ls /backups | wc -l')" = "600 2"
fi
