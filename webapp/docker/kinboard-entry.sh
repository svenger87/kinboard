#!/bin/sh
# kinboard-entry.sh — Kong as the front door (RFC-018).
#
# The browser talks to the API at the address it opened Kinboard from. For
# that, Kong has to serve the app as well as the API: a catch-all route sends
# everything that is not /rest, /auth, /storage or /realtime to the webapp.
# Which container publishes WEBAPP_PORT (3001) is one setting in .env:
#
#   KINBOARD_ENTRY=kong     Kong publishes 3001 (and 8100, as before)
#   KINBOARD_ENTRY=webapp   the webapp publishes 3001, as it always did
#   (absent)                the same as webapp: an install that has not been
#                           moved yet
#
# Moving an install whose Kong cannot serve the app would turn every bookmark
# into a Kong 404, so nothing here moves an install on faith:
#
#   merge <kong.yml>   adds the catch-all route to an existing kong.yml, as
#                      whole new lines at the indent the file already uses,
#                      checks the result (`kong config parse` when the Kong
#                      image is on the machine, a strict YAML parse or a
#                      structural check otherwise) and only then replaces the
#                      file. Idempotent; on any doubt the file is left alone.
#   normalise          KINBOARD_ENTRY is lower-cased; anything other than
#                      kong/webapp becomes webapp, with a warning. A typo
#                      would otherwise make every compose command fail.
#   recover            puts KINBOARD_ENTRY back after a move that was never
#                      confirmed (a leftover .env.pre-entry); the rest of .env
#                      is kept as it is. --restart also puts the containers
#                      back, --mark starts the back-off.
#   prepare            for an install with no KINBOARD_ENTRY yet, before
#                      `compose up`: ask Kong for / and, only if the webapp
#                      answers, write KINBOARD_ENTRY=kong (keeping the old .env
#                      as .env.pre-entry), so the up that installs a new image
#                      also moves the port — one webapp restart, not two.
#   confirm            after that up: Kong must publish the port and the app
#                      must answer through it; otherwise .env and the old
#                      layout are put back.
#   switch             prepare + move the port now + confirm, for when no
#                      `up` is coming (or prepare could not run before it).
#
# Never moved automatically: an install behind Traefik, or one whose
# API_EXTERNAL_URL names a different host than SITE_URL (a separate API host,
# which a proxy in front of webapp:3000 may depend on). Both opt in by writing
# KINBOARD_ENTRY=kong themselves.
#
# Called by setup.sh (merge, normalise), start.sh up and the self-update.
# POSIX sh: the self-update runs inside an Alpine container.
#
# Environment (all optional):
#   ENV_FILE        default ./.env
#   KONG_YML        default ./kong.yml
#   COMPOSE         default "docker compose"
#   COMPOSE_FILES   default "-f docker-compose.yml"
#   ENTRY_KONG_IMAGE  Kong image for `kong config parse`; default: the tag in
#                   the docker-compose.yml next to kong.yml. `none` skips it.
#                   Never pulled: used only when already on the machine.
#   ENTRY_PROBE_ATTEMPTS / ENTRY_PROBE_INTERVAL   default 36 / 5 (three minutes)
#   ENTRY_CONFIRM_ATTEMPTS  default 72 (six minutes, as long as start.sh waits
#                   for a recreated webapp's migrations)
#   ENTRY_PREPARE_ATTEMPTS  default 6 (half a minute: before the up, the old
#                   webapp is already running, or prepare does not probe)
#   ENTRY_RETRY_AFTER  default 86400: after a move was undone, no new attempt
#                   for this many seconds (.env.entry-state)

set -eu

MARKER="# kinboard_entry"
TMP_FILES=""

cleanup_tmp() {
  for f in $TMP_FILES; do rm -f "$f"; done
  TMP_FILES=""
}

# A temporary copy of $1 in $TMP_PATH, same mode (and owner when we may), for
# an atomic replace with mv. Registered for removal on exit or interrupt: a
# kong.yml or .env copy holds keys. (Not a $(...) function: a subshell could
# not register it.)
tmp_copy_of() {
  TMP_PATH="$1.entry-tmp.$$"
  TMP_FILES="$TMP_FILES $TMP_PATH"
  cp -p "$1" "$TMP_PATH" 2>/dev/null || cp "$1" "$TMP_PATH"
  chown --reference="$1" "$TMP_PATH" 2>/dev/null || true
  chmod --reference="$1" "$TMP_PATH" 2>/dev/null || true
}

say() { printf 'entry: %s\n' "$*"; }

# The route, one marker on every line so a later release can find and
# replace the whole block. $1 is the indent of the items under `services:`
# in this file; everything inside the item is relative to it, so the block
# is consistent with whatever style the file uses.
#
# preserve_host: the webapp sees the address the browser used.
# response_buffering off: Next streams pages.
# read/write timeouts 10 minutes: Kong's default 60s would now apply to app
#   requests, and restoring a backup (/api/import) can take longer.
# No key-auth and no CORS: these are the app's own pages, same origin.
entry_route_block() {
  i="$1"
  cat <<EOF
$i## Front door (RFC-018): everything that is not /rest, /auth, /storage or  $MARKER
$i## /realtime goes to the webapp. Added by setup.sh (kinboard-entry.sh).  $MARKER
$i- name: webapp-entry  $MARKER
$i  _comment: "Front door: /* -> webapp:3000/*, lowest priority (the API routes are longer prefixes)"  $MARKER
$i  url: http://webapp:3000  $MARKER
$i  read_timeout: 600000  $MARKER
$i  write_timeout: 600000  $MARKER
$i  routes:  $MARKER
$i    - name: webapp-entry-route  $MARKER
$i      strip_path: false  $MARKER
$i      preserve_host: true  $MARKER
$i      response_buffering: false  $MARKER
$i      paths:  $MARKER
$i        - /  $MARKER
EOF
}

has_route() {
  [ -f "$1" ] && grep -F -- "$MARKER" "$1" >/dev/null 2>&1
}

# The indent of the first list item under the top-level `services:` key, or
# "2" when the list is empty. Prints "TAB" when a tab is involved.
services_indent() {
  awk -v start="$2" '
    NR <= start { next }
    /^[[:space:]]*$/ || /^[[:space:]]*#/ { next }
    {
      line = $0; sub(/\r$/, "", line)
      if (line ~ /^\t/ || line ~ /^ *\t/) { print "TAB"; exit }
      if (line ~ /^[^ ]/ && line !~ /^-/) { print 2; exit }   # next top-level key: empty list
      match(line, /^ */); n = RLENGTH
      rest = substr(line, n + 1)
      if (rest ~ /^- / || rest == "-") { print n; exit }
      print "BAD"; exit
    }
    END { if (NR <= start) print 2 }
  ' "$1"
}

image_from_compose() {
  compose_file="$(dirname "$1")/docker-compose.yml"
  [ -f "$compose_file" ] || return 0
  grep -E '^[[:space:]]*image:[[:space:]]*kong:' "$compose_file" | head -n1 | sed -E 's/^[[:space:]]*image:[[:space:]]*//; s/[[:space:]]*$//'
}

# Is $2 (the merged file) a kong.yml that Kong itself accepts, with exactly
# one more service than $1 and that service ours? Prints the validator used.
validate_merge() {
  orig="$1"; merged="$2"; image="$3"
  if [ "$image" != "none" ] && [ -n "$image" ] && command -v docker >/dev/null 2>&1 \
     && docker image inspect "$image" >/dev/null 2>&1; then
    # Through stdin: the file path may not exist for the Docker daemon (the
    # self-update runs in a container).
    if docker run --rm -i --entrypoint sh -e KONG_DATABASE=off "$image" \
         -c 'cat > /tmp/kong.yml && kong config parse /tmp/kong.yml' < "$merged" >/dev/null 2>&1; then
      structural_ok "$orig" "$merged" || return 1
      echo "kong config parse ($image)"
      return 0
    fi
    return 1
  fi
  if command -v python3 >/dev/null 2>&1 && python3 -c 'import yaml' >/dev/null 2>&1; then
    if python3 - "$orig" "$merged" <<'PY' >/dev/null 2>&1
import sys, yaml
a = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
b = yaml.safe_load(open(sys.argv[2], encoding="utf-8"))
sa = a.get("services") or []
sb = b.get("services") or []
assert isinstance(sb, list)
names = [s.get("name") for s in sb if isinstance(s, dict)]
assert names.count("webapp-entry") == 1
assert len(sb) == len(sa) + 1
entry = [s for s in sb if s.get("name") == "webapp-entry"][0]
assert entry["routes"][0]["paths"] == ["/"]
for k in a:
    if k != "services":
        assert a[k] == b[k], k
PY
    then
      structural_ok "$orig" "$merged" || return 1
      echo "YAML parse"
      return 0
    fi
    return 1
  fi
  structural_ok "$orig" "$merged" || return 1
  echo "structural check"
  return 0
}

# The merged file is the original with the block inserted whole, the block's
# items at the same indent as their siblings, and nothing else changed.
structural_ok() {
  orig="$1"; merged="$2"
  # (grep -v on both sides, so a missing final newline counts the same.)
  [ "$(grep -v -F -- "$MARKER" "$merged" | cksum)" = "$(grep -v -F -- "$MARKER" "$orig" | cksum)" ] || return 1
  # The first marked item line has the indent of the first item of the list.
  awk -v m="$MARKER" '
    /^services:[[:space:]]*\r?$/ { inside = 1; next }
    inside && index($0, m) && $0 ~ /^ *- name: webapp-entry / {
      match($0, /^ */); mine = RLENGTH; found = 1
    }
    inside && !index($0, m) && $0 ~ /^ *- / && sib == "" { match($0, /^ */); sib = RLENGTH }
    inside && $0 ~ /^[^ #\r-]/ { inside = 0 }
    END { if (!found) exit 1; if (sib != "" && sib != mine) exit 1 }
  ' "$merged"
}

# merge <kong.yml> — prints what it did; non-zero when it could not.
entry_merge() {
  file="$1"
  if [ ! -f "$file" ]; then
    say "no $file; nothing to merge" >&2
    return 1
  fi
  if has_route "$file"; then
    say "kong.yml already has the front-door route"
    return 0
  fi
  if grep -E '^[[:space:]]*-?[[:space:]]*name:[[:space:]]+webapp-entry(-route)?[[:space:]]*$' "$file" >/dev/null 2>&1; then
    say "kong.yml already has a service named webapp-entry without the marker; leaving it alone" >&2
    return 1
  fi
  line="$(grep -n -E '^services:[[:space:]]*$' "$file" | head -n1 | cut -d: -f1)"
  if [ -z "$line" ]; then
    say "kong.yml has no top-level 'services:' line; cannot add the route" >&2
    return 1
  fi
  indent="$(services_indent "$file" "$line")"
  case "$indent" in
    TAB) say "kong.yml indents its services with tabs; cannot add the route safely" >&2; return 1 ;;
    BAD|'') say "kong.yml's services are not a block list; cannot add the route safely" >&2; return 1 ;;
  esac
  pad="$(printf '%*s' "$indent" '')"

  tmp_copy_of "$file"
  tmp="$TMP_PATH"
  # head/tail copy bytes exactly, including CRLF line ends and a missing
  # final newline; only whole new lines are added after `services:`.
  {
    head -n "$line" "$file"
    entry_route_block "$pad"
    tail -n +"$((line + 1))" "$file"
  } > "$tmp"

  image="${ENTRY_KONG_IMAGE-}"
  [ -n "$image" ] || image="$(image_from_compose "$file")"
  if ! how="$(validate_merge "$file" "$tmp" "${image:-none}")"; then
    cleanup_tmp
    say "the merged kong.yml did not validate; kong.yml left as it was" >&2
    return 1
  fi
  mv -f "$tmp" "$file"
  TMP_FILES=""
  say "added the front-door route to kong.yml (checked by $how)"
  return 0
}

# ---------------------------------------------------------------- .env

# Lines that assign KEY, in every form a shell or compose accepts:
# leading whitespace, `export `, quotes.
key_re() { printf '^[[:space:]]*(export[[:space:]]+)?%s=' "$1"; }

env_value() {
  grep -E "$(key_re "$1")" "$ENV_FILE" 2>/dev/null | tail -n1 \
    | sed -E "s/$(key_re "$1")//; s/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//" \
    | tr -d '"\r'"'" || true
}

# set_env KEY VALUE — every assignment of KEY becomes KEY=VALUE (the first
# one kept in place, any others dropped); appended only when there is none.
set_env() {
  key="$1"; value="$2"
  tmp_copy_of "$ENV_FILE"
  t="$TMP_PATH"
  if grep -E "$(key_re "$key")" "$ENV_FILE" >/dev/null 2>&1; then
    awk -v k="$key" -v v="$value" -v re="$(key_re "$key")" '
      $0 ~ re { if (!done) { print k "=" v; done = 1 } ; next }
      { print }
    ' "$ENV_FILE" > "$t"
  else
    cat "$ENV_FILE" > "$t"
    # A file without a final newline would glue the new line onto the last one.
    if [ -s "$ENV_FILE" ] && [ -n "$(tail -c1 "$ENV_FILE")" ]; then
      printf '\n' >> "$t"
    fi
    printf '%s=%s\n' "$key" "$value" >> "$t"
  fi
  mv -f "$t" "$ENV_FILE"
  TMP_FILES=""
}

# host part of a URL, lower-case, without port or brackets.
url_host() {
  printf '%s' "$1" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##; s#[/?#].*$##; s#^[^@]*@##; s#^\[([^]]*)\].*$#\1#; s#:[0-9]*$##' \
    | tr '[:upper:]' '[:lower:]'
}

# Does .env describe a separate API host? API_EXTERNAL_URL set, not
# `same-origin`, and naming a different host than SITE_URL.
separate_api_host() {
  api="$(env_value API_EXTERNAL_URL)"
  case "$(printf '%s' "$api" | tr '[:upper:]' '[:lower:]')" in ''|same-origin) return 1 ;; esac
  site="$(env_value SITE_URL)"
  [ -n "$site" ] || return 0
  [ "$(url_host "$api")" != "$(url_host "$site")" ]
}

entry_normalise() {
  raw="$(env_value KINBOARD_ENTRY)"
  [ -n "$raw" ] || return 0
  value="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    kong|webapp) ;;
    *)
      say "KINBOARD_ENTRY='$raw' is neither kong nor webapp; using webapp" >&2
      value=webapp
      ;;
  esac
  count="$(grep -c -E "$(key_re KINBOARD_ENTRY)" "$ENV_FILE" || true)"
  if [ "$raw" != "$value" ] || [ "$count" != 1 ] \
     || ! grep -E "^KINBOARD_ENTRY=$value\$" "$ENV_FILE" >/dev/null 2>&1; then
    set_env KINBOARD_ENTRY "$value"
    say "KINBOARD_ENTRY written as KINBOARD_ENTRY=$value"
  fi
}

compose() {
  # shellcheck disable=SC2086
  $COMPOSE $COMPOSE_FILES "$@"
}

# ---------------------------------------------------------------- the stack

# Ask Kong for / from inside the stack and check that the webapp answered.
# Every response the app sends carries x-correlation-id (src/proxy.ts, since
# 1.10); Kong's own "no Route matched" 404 and its 502 while the webapp starts
# do not.
probe_once() {
  headers="$(compose exec -T webapp curl -s -o /dev/null -D - --max-time 10 http://kong:8000/ 2>/dev/null)" || return 1
  status="$(printf '%s\n' "$headers" | head -n1 | awk '{print $2}')"
  case "$status" in
    2??|3??) ;;
    *) return 1 ;;
  esac
  printf '%s\n' "$headers" | grep -i '^x-correlation-id:' >/dev/null 2>&1
}

probe() { probe_with "$ENTRY_PROBE_ATTEMPTS"; }

probe_with() {
  n=0
  while [ "$n" -lt "$1" ]; do
    if probe_once; then
      return 0
    fi
    n=$((n + 1))
    [ "$n" -lt "$1" ] && sleep "$ENTRY_PROBE_INTERVAL"
  done
  return 1
}

# Kong reads kong.yml only when it starts. A route merged since then is not
# being served yet.
kong_older_than_config() {
  cid="$(compose ps -q kong 2>/dev/null | head -n1)"
  [ -n "$cid" ] || return 1
  started="$(docker inspect -f '{{.State.StartedAt}}' "$cid" 2>/dev/null | cut -c1-19 | tr T ' ')"
  [ -n "$started" ] || return 1
  started_s="$(date -u -d "$started" +%s 2>/dev/null)" || return 1
  config_s="$(stat -c %Y "$KONG_YML" 2>/dev/null)" || return 1
  [ "$config_s" -gt "$started_s" ]
}

# The host ports Kong's 8000 is published on, space-separated.
kong_host_ports() {
  cid="$(compose ps -q kong 2>/dev/null | head -n1)"
  [ -n "$cid" ] || return 0
  docker inspect -f '{{range $p, $b := .NetworkSettings.Ports}}{{if eq $p "8000/tcp"}}{{range $b}}{{.HostPort}} {{end}}{{end}}{{end}}' "$cid" 2>/dev/null || true
}

behind_traefik() {
  compose config 2>/dev/null | grep -E 'traefik\.enable' >/dev/null 2>&1
}

# Kept while a move is in progress: the KINBOARD_ENTRY line(s) .env had
# before it (none, in practice). Its presence means "not confirmed yet".
backup_file() { printf '%s.pre-entry' "$ENV_FILE"; }
# When a move was last undone (a failed check after the move, an interrupted
# one, a failed `up`). Within ENTRY_RETRY_AFTER seconds of it nothing tries
# again: every attempt restarts the webapp, and a failure that repeats would
# otherwise cost one restart per run.
state_file() { printf '%s.entry-state' "$ENV_FILE"; }

now() { date +%s; }

# Seconds left before the next attempt; 0 when there is no recent undo.
backoff_left() {
  [ -f "$(state_file)" ] || { echo 0; return 0; }
  at="$(sed -n 's/^undone_at=\([0-9][0-9]*\)$/\1/p' "$(state_file)" | head -n1)"
  [ -n "$at" ] || { echo 0; return 0; }
  left=$((at + ENTRY_RETRY_AFTER - $(now)))
  [ "$left" -gt 0 ] || left=0
  echo "$left"
}

mark_undone() {
  printf 'undone_at=%s\n' "$(now)" > "$(state_file)"
}

# Put the containers in the layout .env now describes: the one that holds
# 3001 at the moment lets go first. $1: the service that must stop
# publishing first.
relayout() {
  first="$1"; second="$2"
  compose up -d --no-deps --no-build "$first" >/dev/null 2>&1 \
    && compose up -d --no-deps --no-build "$second" >/dev/null 2>&1
}

# Start a move: remember the KINBOARD_ENTRY lines, then write kong.
begin_move() {
  grep -E "$(key_re KINBOARD_ENTRY)" "$ENV_FILE" > "$(backup_file)" 2>/dev/null || true
  set_env KINBOARD_ENTRY kong
}

# recover [--restart] [--mark] — undo a move that was not confirmed.
#
# Only the KINBOARD_ENTRY line goes back; everything else in .env stays as it
# is now, so whatever setup.sh or a person wrote since the move began is kept.
# --restart also puts the containers in the old layout; --mark starts the
# back-off.
entry_recover() {
  backup="$(backup_file)"
  [ -f "$backup" ] || return 0
  say "a move to Kong did not finish; putting KINBOARD_ENTRY back as it was"
  tmp_copy_of "$ENV_FILE"
  t="$TMP_PATH"
  # The line the move wrote; anything else (a person's own choice made in the
  # meantime) is theirs and stays.
  grep -v -x -F 'KINBOARD_ENTRY=kong' "$ENV_FILE" > "$t" || true
  # Only KINBOARD_ENTRY lines are ever taken from the saved copy.
  if grep -E "$(key_re KINBOARD_ENTRY)" "$backup" >/dev/null 2>&1; then
    if [ -s "$t" ] && [ -n "$(tail -c1 "$t")" ]; then printf '\n' >> "$t"; fi
    grep -E "$(key_re KINBOARD_ENTRY)" "$backup" >> "$t"
  fi
  mv -f "$t" "$ENV_FILE"
  TMP_FILES=""
  rm -f "$backup"
  for arg in "$@"; do
    case "$arg" in
      --restart) relayout kong webapp || say "could not recreate kong and webapp; run ./start.sh up" ;;
      --mark) mark_undone ;;
    esac
  done
  return 0
}

# A signal re-raised after cleanup, so a calling shell sees the interrupt
# (and stops) instead of a normal exit status it would carry on from.
reraise() {
  sig="$1"
  trap - EXIT INT TERM HUP
  cleanup_tmp
  if [ "${ARMED:-0}" = 1 ] && [ -f "$(backup_file)" ]; then
    entry_recover --restart --mark
  fi
  kill "-$sig" $$
  exit 130
}
set_traps() {
  trap 'cleanup_tmp; if [ "${ARMED:-0}" = 1 ] && [ -f "$(backup_file)" ]; then entry_recover --restart --mark; fi' EXIT
  trap 'reraise INT' INT
  trap 'reraise TERM' TERM
  trap 'reraise HUP' HUP
}
# Between writing .env and confirming the move, any exit puts everything back.
arm_recovery() { ARMED=1; }
disarm_recovery() { ARMED=0; }

webapp_running() {
  [ -n "$(compose ps -q webapp 2>/dev/null | head -n1)" ]
}

# Can this install be moved at all? Prints the reason when not.
eligible() {
  current="$(env_value KINBOARD_ENTRY)"
  if [ -n "$current" ]; then
    say "KINBOARD_ENTRY=$current is set in .env; leaving it"
    return 1
  fi
  # Traefik routes to the containers inside the stack, so host ports do not
  # matter there, and such an install opts in itself (RFC-018 §8).
  if behind_traefik; then
    say "staying on webapp: this stack runs behind Traefik; set KINBOARD_ENTRY=kong in .env to opt in"
    return 1
  fi
  # A proxy (NPM, Caddy, cloudflared) may send the app's host to webapp:3000
  # and the API host to Kong; moving it would break it from outside.
  if separate_api_host; then
    say "staying on webapp: separate API host (API_EXTERNAL_URL is not on SITE_URL's host); set KINBOARD_ENTRY=kong in .env to opt in"
    return 1
  fi
  if ! has_route "$KONG_YML"; then
    say "staying on webapp: kong.yml has no front-door route (setup.sh adds it)"
    return 1
  fi
  left="$(backoff_left)"
  if [ "$left" -gt 0 ]; then
    say "staying on webapp: a move to Kong was undone recently; trying again in $(( (left + 59) / 60 )) min (delete $(state_file) to try now)"
    return 1
  fi
  return 0
}

# Kong answers / with the app, restarting Kong once if it predates the route.
# $1: how many probes.
check_route_served() {
  if probe_once; then return 0; fi
  if kong_older_than_config; then
    say "Kong started before the route was added; restarting Kong"
    compose restart kong >/dev/null 2>&1 || true
  fi
  probe_with "$1"
}

entry_prepare() {
  if [ -f "$(backup_file)" ]; then
    # Only .env: the `up` that follows puts the containers back with it.
    entry_recover --mark
    return 0
  fi
  eligible || return 0
  # Before the stack is up there is nothing to ask; the check runs after the
  # up instead (switch), at the cost of a second webapp restart.
  if ! webapp_running; then
    say "not yet: the stack is not running; checking after it is up"
    return 0
  fi
  if ! check_route_served "$ENTRY_PREPARE_ATTEMPTS"; then
    say "not yet: a request through Kong to / did not reach the app; trying again after the stack is up"
    return 0
  fi
  begin_move
  port="$(env_value WEBAPP_PORT)"
  say "Kong serves the app; KINBOARD_ENTRY=kong, the next 'up' moves port ${port:-3001} to Kong"
  return 0
}

entry_confirm() {
  backup="$(backup_file)"
  [ -f "$backup" ] || return 0
  arm_recovery
  port="$(env_value WEBAPP_PORT)"
  port="${port:-3001}"
  case " $(kong_host_ports) " in
    *" $port "*)
      # A recreated webapp applies its migrations before it answers; give it
      # as long as start.sh waits for them.
      if probe_with "$ENTRY_CONFIRM_ATTEMPTS"; then
        rm -f "$backup" "$(state_file)"
        disarm_recovery
        say "switched: Kong publishes port $port, and the webapp answers through it"
        return 0
      fi
      reason="the webapp did not answer through Kong after the move"
      ;;
    *) reason="Kong did not get port $port" ;;
  esac
  entry_recover --restart --mark
  disarm_recovery
  say "staying on webapp: $reason; KINBOARD_ENTRY restored"
  return 0
}

entry_switch() {
  if [ -f "$(backup_file)" ]; then
    entry_recover --restart --mark
    return 0
  fi
  eligible || return 0
  if ! check_route_served "$ENTRY_PROBE_ATTEMPTS"; then
    say "staying on webapp: a request through Kong to / did not reach the app"
    return 0
  fi
  port="$(env_value WEBAPP_PORT)"
  port="${port:-3001}"
  arm_recovery
  begin_move
  say "Kong serves the app; switching KINBOARD_ENTRY to kong (Kong takes port $port)"
  # The webapp first, so it lets go of the port before Kong binds it.
  if ! relayout webapp kong; then
    entry_recover --restart --mark
    disarm_recovery
    say "staying on webapp: docker compose could not recreate webapp and kong; KINBOARD_ENTRY restored"
    return 0
  fi
  entry_confirm
}

main() {
  cmd="${1:-}"
  ENV_FILE="${ENV_FILE:-./.env}"
  KONG_YML="${KONG_YML:-./kong.yml}"
  COMPOSE="${COMPOSE:-docker compose}"
  COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml}"
  ENTRY_PROBE_ATTEMPTS="${ENTRY_PROBE_ATTEMPTS:-36}"
  ENTRY_PROBE_INTERVAL="${ENTRY_PROBE_INTERVAL:-5}"
  ENTRY_CONFIRM_ATTEMPTS="${ENTRY_CONFIRM_ATTEMPTS:-72}"
  ENTRY_PREPARE_ATTEMPTS="${ENTRY_PREPARE_ATTEMPTS:-6}"
  ENTRY_RETRY_AFTER="${ENTRY_RETRY_AFTER:-86400}"
  ARMED=0
  set_traps
  case "$cmd" in
    merge)
      [ $# -ge 2 ] || { echo "usage: $0 merge <kong.yml>" >&2; return 2; }
      entry_merge "$2"
      ;;
    has-route)
      [ $# -ge 2 ] || { echo "usage: $0 has-route <kong.yml>" >&2; return 2; }
      has_route "$2"
      ;;
    kong-stale)
      kong_older_than_config
      ;;
    normalise|recover|prepare|confirm|switch)
      if [ ! -f "$ENV_FILE" ]; then
        say "no $ENV_FILE; nothing to do"
        return 0
      fi
      case "$cmd" in
        normalise) entry_normalise ;;
        recover) shift; entry_recover "$@" ;;
        prepare) entry_normalise; entry_prepare ;;
        confirm) entry_confirm ;;
        switch) entry_normalise; entry_switch ;;
      esac
      ;;
    *)
      sed -n '2,56p' "$0" >&2
      return 2
      ;;
  esac
}

main "$@"
