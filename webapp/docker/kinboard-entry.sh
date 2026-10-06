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
#   merge <kong.yml>   adds the catch-all route to an existing kong.yml. The
#                      file holds the install's real keys; the route is
#                      inserted as whole lines and no other byte changes.
#                      Idempotent: a file that has the route is left alone.
#   switch             for an install with no KINBOARD_ENTRY yet: asks Kong
#                      for / and only if the webapp answers, writes
#                      KINBOARD_ENTRY=kong and moves the port. Any failure
#                      leaves the install on the webapp and says why.
#
# Called by setup.sh (merge), and by start.sh up and the self-update (switch).
# POSIX sh: the self-update runs inside an Alpine container.
#
# Environment for `switch` (all optional):
#   ENV_FILE        default ./.env
#   KONG_YML        default ./kong.yml
#   COMPOSE         default "docker compose"
#   COMPOSE_FILES   default "-f docker-compose.yml"
#   ENTRY_PROBE_ATTEMPTS / ENTRY_PROBE_INTERVAL   default 36 / 5 (three minutes:
#                   a webapp that was just recreated runs its migrations first)

set -eu

MARKER="# kinboard_entry"

# The route, one marker on every line so a later release can find and
# replace the whole block without guessing where it ends. Inserted directly
# below `services:`. Its place in the list does not matter to Kong: the
# longest matching path prefix wins, and `/` is the shortest there is.
#
# preserve_host: the webapp sees the address the browser used, as it does
#   when it is published itself (secure cookies, OAuth metadata, redirects).
# response_buffering off: Next streams pages; buffering would hold every
#   response until it is complete.
# No key-auth and no CORS: these are the app's own pages, same origin.
entry_route_block() {
  cat <<'EOF'
  ## Front door (RFC-018): everything that is not /rest, /auth, /storage or  # kinboard_entry
  ## /realtime goes to the webapp. Added by setup.sh (kinboard-entry.sh).  # kinboard_entry
  - name: webapp-entry  # kinboard_entry
    _comment: "Front door: /* -> webapp:3000/*, lowest priority (the API routes are longer prefixes)"  # kinboard_entry
    url: http://webapp:3000  # kinboard_entry
    routes:  # kinboard_entry
      - name: webapp-entry-route  # kinboard_entry
        strip_path: false  # kinboard_entry
        preserve_host: true  # kinboard_entry
        response_buffering: false  # kinboard_entry
        paths:  # kinboard_entry
          - /  # kinboard_entry
EOF
}

say() { printf 'entry: %s\n' "$*"; }

has_route() {
  [ -f "$1" ] && grep -F -- "$MARKER" "$1" >/dev/null 2>&1
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
  if grep -E '^[[:space:]]*-[[:space:]]+name:[[:space:]]+webapp-entry(-route)?[[:space:]]*$' "$file" >/dev/null 2>&1; then
    say "kong.yml already has a service named webapp-entry without the marker; leaving it alone" >&2
    return 1
  fi
  line="$(grep -n -E '^services:[[:space:]]*$' "$file" | head -n1 | cut -d: -f1)"
  if [ -z "$line" ]; then
    say "kong.yml has no top-level 'services:' line; cannot add the route" >&2
    return 1
  fi

  tmp="$file.entry-tmp.$$"
  # head/tail copy bytes exactly, including a missing final newline and CRLF
  # line ends; only whole new lines are added after `services:`.
  {
    head -n "$line" "$file"
    entry_route_block
    tail -n +"$((line + 1))" "$file"
  } > "$tmp"

  added="$(grep -c -F -- "$MARKER" "$tmp" || true)"
  expected="$(entry_route_block | grep -c -F -- "$MARKER")"
  if [ "$added" != "$expected" ]; then
    rm -f "$tmp"
    say "merge produced an unexpected file; kong.yml left as it was" >&2
    return 1
  fi
  # Written over the original rather than renamed onto it: keeps its owner,
  # its mode and its inode (Kong mounts this single file).
  cat "$tmp" > "$file"
  rm -f "$tmp"
  say "added the front-door route to kong.yml"
  return 0
}

env_value() {
  # The last assignment wins, as it does for compose.
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"\r' || true
}

# set_env KEY VALUE — replace every KEY= line, or append one.
set_env() {
  key="$1"; value="$2"
  if grep -E "^$key=" "$ENV_FILE" >/dev/null 2>&1; then
    awk -v k="$key" -v v="$value" '
      index($0, k "=") == 1 { print k "=" v; next }
      { print }
    ' "$ENV_FILE" > "$ENV_FILE.entry-tmp.$$"
    cat "$ENV_FILE.entry-tmp.$$" > "$ENV_FILE"
    rm -f "$ENV_FILE.entry-tmp.$$"
  else
    # A file without a final newline would glue the new line onto the last one.
    if [ -s "$ENV_FILE" ] && [ -n "$(tail -c1 "$ENV_FILE")" ]; then
      printf '\n' >> "$ENV_FILE"
    fi
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

compose() {
  # shellcheck disable=SC2086
  $COMPOSE $COMPOSE_FILES "$@"
}

# Ask Kong for / from inside the stack and check that the webapp answered.
# Every response the app sends carries x-correlation-id (src/proxy.ts); Kong's
# own "no Route matched" 404 and its 502 while the webapp starts do not.
probe_once() {
  headers="$(compose exec -T webapp curl -s -o /dev/null -D - --max-time 10 http://kong:8000/ 2>/dev/null)" || return 1
  status="$(printf '%s\n' "$headers" | head -n1 | awk '{print $2}')"
  case "$status" in
    2??|3??) ;;
    *) return 1 ;;
  esac
  printf '%s\n' "$headers" | grep -i '^x-correlation-id:' >/dev/null 2>&1
}

probe() {
  n=0
  while [ "$n" -lt "$ENTRY_PROBE_ATTEMPTS" ]; do
    if probe_once; then
      return 0
    fi
    n=$((n + 1))
    [ "$n" -lt "$ENTRY_PROBE_ATTEMPTS" ] && sleep "$ENTRY_PROBE_INTERVAL"
  done
  return 1
}

# Kong reads kong.yml only when it starts. A route merged since then is not
# being served yet; restart Kong once so it is.
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

entry_switch() {
  current="$(env_value KINBOARD_ENTRY)"
  if [ -n "$current" ]; then
    say "KINBOARD_ENTRY=$current is set in .env; leaving it"
    return 0
  fi

  # Traefik routes to the containers inside the stack, so host ports do not
  # matter there, and such an install opts in itself (RFC-018 §8).
  if behind_traefik; then
    say "staying on webapp: this stack runs behind Traefik; set KINBOARD_ENTRY=kong in .env to opt in"
    return 0
  fi

  if ! has_route "$KONG_YML"; then
    say "staying on webapp: kong.yml has no front-door route (setup.sh adds it)"
    return 0
  fi

  if ! probe_once; then
    if kong_older_than_config; then
      say "Kong started before the route was added; restarting Kong"
      compose restart kong >/dev/null 2>&1 || true
    fi
    if ! probe; then
      say "staying on webapp: a request through Kong to / did not reach the app"
      return 0
    fi
  fi

  port="$(env_value WEBAPP_PORT)"
  port="${port:-3001}"
  backup="$ENV_FILE.pre-entry"
  cp -p "$ENV_FILE" "$backup"
  set_env KINBOARD_ENTRY kong
  say "Kong serves the app; switching KINBOARD_ENTRY to kong (Kong takes port $port)"

  # The webapp first, so it lets go of the port before Kong binds it.
  if compose up -d --no-deps --no-build webapp >/dev/null 2>&1 \
     && compose up -d --no-deps --no-build kong >/dev/null 2>&1; then
    case " $(kong_host_ports) " in
      *" $port "*)
        if probe; then
          rm -f "$backup"
          say "switched: Kong publishes port $port, and the webapp answers through it"
          return 0
        fi
        reason="the webapp did not answer through Kong after the move"
        ;;
      *) reason="Kong did not get port $port" ;;
    esac
  else
    reason="docker compose could not recreate webapp and kong"
  fi

  # Put .env back exactly as it was and the containers with it.
  cat "$backup" > "$ENV_FILE"
  rm -f "$backup"
  compose up -d --no-deps --no-build kong >/dev/null 2>&1 || true
  compose up -d --no-deps --no-build webapp >/dev/null 2>&1 || true
  say "staying on webapp: $reason; .env restored"
  return 0
}

main() {
  cmd="${1:-}"
  case "$cmd" in
    merge)
      [ $# -ge 2 ] || { echo "usage: $0 merge <kong.yml>" >&2; return 2; }
      entry_merge "$2"
      ;;
    has-route)
      [ $# -ge 2 ] || { echo "usage: $0 has-route <kong.yml>" >&2; return 2; }
      has_route "$2"
      ;;
    switch)
      ENV_FILE="${ENV_FILE:-./.env}"
      KONG_YML="${KONG_YML:-./kong.yml}"
      COMPOSE="${COMPOSE:-docker compose}"
      COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml}"
      ENTRY_PROBE_ATTEMPTS="${ENTRY_PROBE_ATTEMPTS:-36}"
      ENTRY_PROBE_INTERVAL="${ENTRY_PROBE_INTERVAL:-5}"
      if [ ! -f "$ENV_FILE" ]; then
        say "no $ENV_FILE; nothing to switch"
        return 0
      fi
      entry_switch
      ;;
    *)
      sed -n '2,33p' "$0" >&2
      return 2
      ;;
  esac
}

main "$@"
