#!/usr/bin/env bash
# Kinboard — local Docker operations.
#
# Usage:
#   ./start.sh up        # fetch the published webapp image, bring stack up
#   ./start.sh down      # tear down
#   ./start.sh restart   # rebuild webapp + restart
#   ./start.sh logs      # tail logs
#   ./start.sh status    # show container state
#   ./start.sh migrate   # apply migrations/NNN_*.sql (migrate.sh)
#   ./start.sh seed-demo # load optional demo family + subjects
#
# Compose file selection: defaults to `docker-compose.yml`, which runs the
# published image. Override the full set in .env or your shell, e.g.:
#   COMPOSE_FILES="-f docker-compose.yml -f docker-compose.traefik.yml"
#   COMPOSE_FILES="-f docker-compose.yml -f docker-compose.build.yml"   # from source
# In .env the quotes are optional: COMPOSE_FILES=-f docker-compose.yml -f
# docker-compose.diun.yml works too. .env is read the way Docker Compose reads
# it, never run as a shell script (see env_file_value below).

# $COMPOSE and $COMPOSE_FILES are word lists on purpose (`docker compose`, `-f a -f b`).
# shellcheck disable=SC2086
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "error: $SCRIPT_DIR/.env is missing." >&2
  echo "       run \`./setup.sh\` from the repo root, or copy" >&2
  echo "       .env.example to .env and fill in the values." >&2
  exit 1
fi

# The value of $1 in the .env file $2, read the way Docker Compose reads it,
# and nothing run: status 1 when the file does not set it.
#
# This used to be `set -a; . ./.env`, which runs .env as a shell script. That
# is not what .env is: Compose reads `KEY=two words` as one value, bash runs
# `words` as a command. Discussion #539: COMPOSE_FILES=-f docker-compose.yml
# -f docker-compose.diun.yml, unquoted as the wiki showed it, ended
# `./start.sh up` with "docker-compose.yml: command not found", where
# `docker compose` on its own read the same file fine. And a `$(…)` or a
# backtick in any value ran.
#
# What it follows (checked against Compose v5): blank lines and `#` lines are
# skipped; `export ` before a key is allowed; spaces around the key, `=` and
# an unquoted value are dropped, as is ` # comment` after it. 'single quotes'
# keep everything as written. "double quotes" may span lines and turn \n, \\,
# \" and \$ into their characters. Outside single quotes, ${VAR}, $VAR,
# ${VAR:-default}, ${VAR-default}, ${VAR:+alt}, ${VAR+alt} take VAR from the
# environment, else from earlier lines, and $$ is one $. Anything else,
# $(…) and backticks included, stays text. CRLF line ends are fine.
env_file_value() {
  awk -v want="$1" '
    function lookup(n) { return (n in ENVIRON) ? ENVIRON[n] : ((n in val) ? val[n] : "") }
    function isset(n) { return (n in ENVIRON) || (n in val) }
    # The $-references in s expanded; dq: also the escapes of a "…" value.
    function expand(s, dq,    out, i, n, c, d, j, k, depth, inner, name, rest, op, word, v) {
      out = ""; n = length(s); i = 1
      while (i <= n) {
        c = substr(s, i, 1)
        if (dq && c == "\\" && i < n) {
          d = substr(s, i + 1, 1)
          if (d == "n") out = out "\n"
          else if (d == "\\" || d == "\"" || d == "$") out = out d
          else out = out c d
          i += 2; continue
        }
        if (c != "$" || i == n) { out = out c; i++; continue }
        d = substr(s, i + 1, 1)
        if (d == "$") { out = out "$"; i += 2; continue }
        if (d == "{") {
          depth = 1; j = i + 2
          while (j <= n && depth > 0) {
            k = substr(s, j, 1)
            if (k == "{") depth++
            else if (k == "}") depth--
            j++
          }
          inner = substr(s, i + 2, j - i - 3)
          if (depth > 0 || !match(inner, /^[A-Za-z_][A-Za-z0-9_]*/)) { out = out substr(s, i, j - i); i = j; continue }
          name = substr(inner, 1, RLENGTH); rest = substr(inner, RLENGTH + 1); v = lookup(name)
          if (rest == "") out = out v
          else {
            op = substr(rest, 1, 2)
            if (op == ":-") out = out (v != "" ? v : expand(substr(rest, 3), 0))
            else if (op == ":+") out = out (v != "" ? expand(substr(rest, 3), 0) : "")
            else if (substr(rest, 1, 1) == "-") out = out (isset(name) ? v : expand(substr(rest, 2), 0))
            else if (substr(rest, 1, 1) == "+") out = out (isset(name) ? expand(substr(rest, 2), 0) : "")
            else out = out substr(s, i, j - i)
          }
          i = j; continue
        }
        if (match(substr(s, i + 1), /^[A-Za-z_][A-Za-z0-9_]*/)) {
          out = out lookup(substr(s, i + 1, RLENGTH)); i += 1 + RLENGTH; continue
        }
        out = out c; i++
      }
      return out
    }
    # Where the closing quote q is in s (escaped ones skipped inside "…"), or 0.
    function closing(s, q,    i, n, c) {
      n = length(s)
      for (i = 1; i <= n; i++) {
        c = substr(s, i, 1)
        if (q == "\"" && c == "\\") { i++; continue }
        if (c == q) return i
      }
      return 0
    }
    { sub(/\r$/, ""); line[++lines] = $0 }
    END {
      for (l = 1; l <= lines; l++) {
        s = line[l]
        sub(/^[ \t]+/, "", s)
        if (s == "" || substr(s, 1, 1) == "#") continue
        sub(/^export[ \t]+/, "", s)
        if (!match(s, /^[A-Za-z_][A-Za-z0-9_.-]*/)) continue
        key = substr(s, 1, RLENGTH); s = substr(s, RLENGTH + 1)
        sub(/^[ \t]+/, "", s)
        if (substr(s, 1, 1) != "=") continue
        s = substr(s, 2)
        sub(/^[ \t]+/, "", s)
        q = substr(s, 1, 1)
        if (q == "\"" || q == "\047") {
          body = substr(s, 2)
          while ((p = closing(body, q)) == 0 && l < lines) body = body "\n" line[++l]
          v = (p == 0) ? body : substr(body, 1, p - 1)
          if (q == "\"") v = expand(v, 1)
        } else {
          v = s
          if (match(v, /[ \t]#/)) v = substr(v, 1, RSTART - 1)
          sub(/[ \t]+$/, "", v)
          v = expand(v, 0)
        }
        val[key] = v
      }
      if (!(want in val)) exit 1
      printf "%s", val[want]
    }
  ' "$2"
}

# The keys this script uses, from .env where it sets them (.env wins over the
# shell, as when it was sourced); others keep what the shell had. Nothing is
# exported: `docker compose` reads .env itself, the same way.
env_file_load() {
  local key value
  for key in "$@"; do
    if value="$(env_file_value "$key" ./.env)"; then
      printf -v "$key" '%s' "$value"
    fi
  done
}
env_file_load COMPOSE_FILES PROJECT_NAME KINBOARD_TAG KINBOARD_RIG DATA_DIR BUILD_REVISION

# The base file runs the published image (docker-compose.image.yml used to be
# needed for that and is now only kept for COMPOSE_FILES lines that name it).
# Traefik, a source build and demo overlays go in COMPOSE_FILES explicitly.
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml}"
if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  COMPOSE="docker compose"
fi

cmd="${1:-up}"

PROJECT_NAME="${PROJECT_NAME:-kinboard}"

# A developer test rig run in an installed copy rewrites this .env for its own
# throwaway stack (#539): the rig's project name, data folder, ports and
# subnet, and no COMPOSE_FILES. Bringing that up would start an empty copy of
# Kinboard and look as if the family's data were gone. The rigs set
# KINBOARD_RIG=1; nobody else has a reason to use these project names.
# (Same list as RIG_PROJECTS in scripts/rigs/test-rig-common.sh.)
case "$PROJECT_NAME" in
  kbupg|kbinstall|kbbak)
    if [[ "${KINBOARD_RIG:-0}" != "1" ]]; then
      cat >&2 <<MSG
error: $SCRIPT_DIR/.env was rewritten by one of Kinboard's developer tests
       (PROJECT_NAME=$PROJECT_NAME), so this would start that test's empty
       copy of Kinboard, not yours. Your family's data is untouched, in the
       data folder your own .env named.

       Put your own values back in .env: PROJECT_NAME (normally kinboard),
       COMPOSE_PROJECT_NAME (delete the line), DATA_DIR, WEBAPP_PORT,
       POSTGRES_PORT, NETWORK_SUBNET, GO2RTC_HTTP_PORT, GO2RTC_WEBRTC_PORT,
       KINBOARD_PROJECT_DIR, KINBOARD_DEMO_FAMILY_CODE, and your COMPOSE_FILES
       line if you had one. .env.example has the defaults. Then run
       ./start.sh up again.

       To remove the test's own containers:
         docker compose -p $PROJECT_NAME down -v --remove-orphans
MSG
      exit 1
    fi
    ;;
esac

# A source build (docker-compose.build.yml) stamps this into sw.js, so every
# rebuild serves a different service worker and pages left open pick it up.
# Without git it stays empty and the Dockerfile falls back to a timestamp.
BUILD_REVISION="${BUILD_REVISION:-$(git -C "$SCRIPT_DIR" rev-parse --short=7 HEAD 2>/dev/null || true)}"
export BUILD_REVISION

# NOTE: PostgREST's login-role password is aligned INSIDE the stack by the
# one-shot `db-init` service in docker-compose.yml, which `rest` waits for, so
# a bare `docker compose up` works without this script.

# Apply the migrations to the running DB from the host, by hand.
#
# THIS IS NOT THE PATH MIGRATIONS NORMALLY TAKE. The webapp container applies
# them itself on every start (webapp-entrypoint.sh), and refuses to start the
# app if one fails rather than serving against a half-applied schema. This is
# the escape hatch for when it could not, and for a dev box running `next dev`
# with no webapp container. (A webapp without POSTGRES_PASSWORD no longer
# starts at all, since RFC-023's secrets store: it names the missing secret.)
#
# Same runner, same files, same order: migrate.sh, reading migrations/NNN_*.sql
# and recording each in kinboard.schema_migrations. Running it twice is safe;
# the second run applies nothing.
#
# Adding a migration: the next free number, `NNN_topic.sql`, idempotent
# (IF NOT EXISTS, guarded DO blocks) because an edited file is applied again.
run_migrations() {
  PSQL="docker exec -i ${PROJECT_NAME:-kinboard}-db psql -U postgres -d postgres" ./migrate.sh
}

# Report on the migrations the webapp container runs at startup.
#
# `up` used to apply them from here, so the operator saw them scroll past and
# knew whether they worked. Now that the container is the only runner, this
# watches its log instead — same feedback, one runner.
wait_for_migrations() {
  local container="${PROJECT_NAME:-kinboard}-webapp"
  local i=0 logs="" since=""

  # Scope the log read to THIS run of the container. `docker logs` spans every
  # restart it has ever had, so on an already-running stack a previous boot's
  # success line matches immediately — and a genuinely failing new boot would
  # be reported as fine.
  since="$(docker inspect -f '{{.State.StartedAt}}' "$container" 2>/dev/null || true)"

  echo "→ migrations (applied by $container on startup)"
  while [[ $i -lt 180 ]]; do
    if [[ -n "$since" ]]; then
      logs="$(docker logs --since "$since" "$container" 2>&1 || true)"
    else
      logs="$(docker logs "$container" 2>&1 || true)"
    fi

    # Only a terminal give-up is an error. A single failed pass is expected on
    # a first boot — the Supabase services are creating their own schemas at
    # the same time and the two deadlock — and the entrypoint retries.
    if grep -q '\[entrypoint\] GIVING UP' <<<"$logs"; then
      echo >&2
      grep '\[entrypoint\]' <<<"$logs" | tail -20 >&2
      echo >&2
      echo "error: migrations failed; the webapp will not start against a half-applied schema." >&2
      echo "       Full output: docker logs $container" >&2
      return 1
    fi

    # A secret it cannot start without (POSTGRES_PASSWORD, JWT_SECRET):
    # neither in its environment nor in the secrets store. The entrypoint
    # names it and exits before anything else runs (secrets-store.mjs), so
    # there is nothing to wait for. Before RFC-023 it started without migrations
    # instead, and this warned.
    if grep -q '\[entrypoint\] refusing to start' <<<"$logs"; then
      echo >&2
      grep -E '\[entrypoint\] ([A-Z_]+ is not set|[A-Z_]+: cannot read|refusing to start)' <<<"$logs" | awk '!seen[$0]++' >&2
      echo >&2
      echo "error: the webapp is missing a secret it cannot start without; it has not started." >&2
      echo "       Set it in webapp/docker/.env, then ./start.sh up again." >&2
      return 1
    fi

    if grep -q '\[entrypoint\] starting Next.js server' <<<"$logs"; then
      local retried
      retried="$(grep -c '\[entrypoint\] migration attempt ' <<<"$logs" || true)"
      if [[ ${retried:-0} -gt 0 ]]; then
        echo "  migrations applied after ${retried} retry/retries (normal on a first boot), schema cache reloaded"
      else
        echo "  migrations applied, schema cache reloaded"
      fi
      return 0
    fi

    sleep 2
    i=$((i + 1))
  done

  echo "  warning: the webapp had not finished its migrations after 6 minutes." >&2
  echo "           Check: docker logs $container" >&2
  return 0
}

# Refuse to start when the data directory sits on a Windows drive.
#
# Discussion #275: a Windows user on WSL cloned into /mnt/c, ran `./start.sh
# up`, and got
#
#   Error dependency db failed to start — container kinboard-db is unhealthy
#
# PostgreSQL cannot initialise a data directory on a Windows drive mounted
# into WSL — drvfs (WSL1) and 9p (WSL2) do not carry the ownership and
# permission semantics initdb needs. It dies on first start, pg_isready never
# succeeds, and every other service reports the dependency failure instead of
# the cause. Nothing anywhere said so; he concluded Kinboard needed a
# PostgreSQL server, installed one on the host, and lost an evening.
#
# DATA_DIR defaults to ./data, inside the project, so wherever somebody clones
# is where the database tries to live — which on Windows is the wrong place by
# default rather than by mistake.
#
# A refusal, not a warning like the build-from-source one below: there is no
# configuration in which continuing works.
check_data_dir_filesystem() {
  data_dir="${DATA_DIR:-./data}"

  # The directory may not exist yet on a first run; the filesystem question is
  # about where it WILL be, so walk up to the nearest existing parent.
  probe="$data_dir"
  while [ ! -e "$probe" ] && [ "$probe" != "/" ] && [ "$probe" != "." ]; do
    parent="$(dirname "$probe")"
    [ "$parent" = "$probe" ] && break
    probe="$parent"
  done
  [ -e "$probe" ] || return 0

  fs_type="$(stat -f -c %T "$probe" 2>/dev/null || echo unknown)"

  case "$fs_type" in
    drvfs|9p|cifs|fuseblk)
      echo "error: the data directory is on a filesystem PostgreSQL cannot use." >&2
      echo "" >&2
      echo "         $data_dir  ->  $probe  ($fs_type)" >&2
      echo "" >&2
      echo "       That looks like a Windows drive mounted into WSL. PostgreSQL" >&2
      echo "       cannot create its data directory there — the permissions it" >&2
      echo "       needs do not exist on an NTFS mount — so kinboard-db would" >&2
      echo "       fail to start and every other service would report" >&2
      echo "       'dependency failed to start' without saying why." >&2
      echo "" >&2
      echo "       Move the project into the WSL filesystem, not /mnt/c:" >&2
      echo "" >&2
      echo "         cd ~ && git clone https://github.com/svenger87/kinboard.git" >&2
      echo "         cd kinboard && ./setup.sh" >&2
      echo "" >&2
      echo "       Or point DATA_DIR at a path inside WSL in webapp/docker/.env." >&2
      echo "       See the wiki: Windows (WSL) as a host." >&2
      return 1
      ;;
  esac
  return 0
}

# ofelia (the `cron` service) reads its jobs from the webapp container's
# labels once, at start. `up -d` recreates the webapp when its image or
# definition changed but leaves `cron` running with the old job list, so a
# job a release adds would never run. So when `up` made a new webapp
# container, the scheduler is recreated after it; otherwise it is left alone.
# $1: the webapp container id from before `up -d`.
webapp_container() {
  $COMPOSE $COMPOSE_FILES ps -aq webapp 2>/dev/null | head -n1 || true
}
recreate_scheduler_if_webapp_changed() {
  local before="$1" after
  after="$(webapp_container)"
  if [[ -z "$after" || "$before" == "$after" ]]; then
    return 0
  fi
  # grep reads to the end (no -q): under pipefail, compose dying of SIGPIPE
  # after an early exit would read as "no cron".
  if ! $COMPOSE $COMPOSE_FILES config --services 2>/dev/null | grep -x cron >/dev/null; then
    return 0
  fi
  echo "→ webapp recreated; recreating cron so the scheduler reads its jobs again"
  $COMPOSE $COMPOSE_FILES up -d --no-deps --force-recreate cron
}

case "$cmd" in
  up)
    check_data_dir_filesystem || exit 1

    # Say something when the stack is about to build the webapp from source
    # while a published image sits unused on this machine.
    #
    # That combination makes an upgrade quietly do nothing: compose rebuilds
    # whatever the source checkout is on, which for anyone who has not run
    # `git pull` is the version they already had. It reports success, the
    # containers come up healthy, and only the version in Settings disagrees
    # (issue #106). A warning, not a refusal — building from source on
    # purpose is a supported path.
    if $COMPOSE $COMPOSE_FILES config 2>/dev/null | grep -q 'image: kinboard-webapp:local'; then
      building_from_source=1
      if docker image inspect "ghcr.io/svenger87/kinboard:${KINBOARD_TAG:-latest}" >/dev/null 2>&1; then
        echo "warning: the webapp will be BUILT FROM SOURCE, but the published image" >&2
        echo "         ghcr.io/svenger87/kinboard:${KINBOARD_TAG:-latest} is already on this machine." >&2
        echo "         To run the published image instead, drop docker-compose.build.yml" >&2
        echo "         from COMPOSE_FILES." >&2
        echo "         To build on purpose, run 'git pull --ff-only origin main' first, or you" >&2
        echo "         will rebuild the version you are already running." >&2
      fi
    fi

    # Fetch the published webapp image before starting it. `up -d` alone
    # starts whatever `kinboard:latest` is already on the machine, so an
    # install that runs `git pull && ./start.sh up` on boot kept the version it
    # was first installed with: the scripts updated, the app did not, and only
    # Settings showed the old version. Offline (no network at boot), the pull
    # fails and the stack starts on the image it has.
    if [[ -z "${building_from_source:-}" ]]; then
      echo "→ fetching ghcr.io/svenger87/kinboard:${KINBOARD_TAG:-latest}"
      if ! $COMPOSE $COMPOSE_FILES pull webapp; then
        echo "warning: could not fetch the webapp image (offline?);" >&2
        echo "         starting with the version already on this machine." >&2
      fi
    fi

    # The Diun overlay's webhook, the same way: it is published
    # (ghcr.io/svenger87/kinboard-webhook) and pulled, never built here
    # (#539). --ignore-buildable leaves a webhook built on purpose
    # (docker-compose.webhook-build.yml) to the up below. A failed pull with
    # no image on the machine would stop that whole up, so the rest of the
    # stack starts without it and Diun (webhook and Diun containers from
    # before keep running as they are), and this says why.
    up_services=""
    if $COMPOSE $COMPOSE_FILES config --services 2>/dev/null | grep -qx webhook; then
      webhook_ref="$($COMPOSE $COMPOSE_FILES config --images webhook 2>/dev/null | head -n1)"
      echo "→ fetching ${webhook_ref:-the webhook image}"
      if ! $COMPOSE $COMPOSE_FILES pull --ignore-buildable webhook; then
        if [[ -n "$webhook_ref" ]] && ! docker image inspect "$webhook_ref" >/dev/null 2>&1; then
          echo "warning: could not fetch $webhook_ref, and it is not on this machine," >&2
          echo "         so the auto-update (webhook and Diun) is left as it is; everything else starts." >&2
          echo "         Offline? Then run ./start.sh up again later." >&2
          echo "         A KINBOARD_TAG pinned to a version older than the published webhook" >&2
          echo "         image has none: add KINBOARD_WEBHOOK_TAG=latest to .env." >&2
          # Diun too: it depends on the webhook, and Compose would start it.
          up_services="$($COMPOSE $COMPOSE_FILES config --services 2>/dev/null | grep -vxE 'webhook|diun' | tr '\n' ' ')"
        else
          echo "warning: could not fetch the webhook image (offline?);" >&2
          echo "         starting with the one already on this machine." >&2
        fi
      fi
    fi

    # Containers of services 1.15 retired (kong, auth, realtime, storage,
    # imgproxy) go first: Kong may hold WEBAPP_PORT, which the webapp
    # publishes now. --remove-orphans below would get them too, but only in
    # the same up that has to bind the port. See kinboard-entry.sh.
    COMPOSE="$COMPOSE" COMPOSE_FILES="$COMPOSE_FILES" ENV_FILE=./.env sh ./kinboard-entry.sh retire || true

    webapp_before="$(webapp_container)"
    set +e
    # shellcheck disable=SC2086
    $COMPOSE $COMPOSE_FILES up -d --remove-orphans $up_services
    up_status=$?
    set -e
    if [[ $up_status -ne 0 ]]; then
      echo "error: docker compose up failed" >&2
      exit 1
    fi
    recreate_scheduler_if_webapp_changed "$webapp_before"
    wait_for_migrations
    $COMPOSE $COMPOSE_FILES ps
    ;;
  down)
    $COMPOSE $COMPOSE_FILES down
    ;;
  restart)
    # Rebuilds only when the build overlay is loaded; otherwise pulls.
    if $COMPOSE $COMPOSE_FILES config 2>/dev/null | grep -q 'image: kinboard-webapp:local'; then
      $COMPOSE $COMPOSE_FILES build --no-cache webapp
    else
      $COMPOSE $COMPOSE_FILES pull webapp
    fi
    $COMPOSE $COMPOSE_FILES up -d --no-deps webapp
    $COMPOSE $COMPOSE_FILES up -d --no-deps --force-recreate cron
    ;;
  logs)
    shift || true
    $COMPOSE $COMPOSE_FILES logs -f --tail=200 "$@"
    ;;
  status|ps)
    $COMPOSE $COMPOSE_FILES ps
    ;;
  migrate)
    run_migrations
    ;;
  seed-demo)
    # Apply the optional demo dataset (gated — explicit opt-in).
    if [[ ! -f seed-demo.sql ]]; then
      echo "error: seed-demo.sql not found in $SCRIPT_DIR" >&2
      exit 1
    fi
    echo "→ seeding demo family (idempotent)"
    docker exec -i "${PROJECT_NAME:-kinboard}-db" \
      psql -U postgres -d postgres < seed-demo.sql
    ;;
  *)
    echo "unknown command: $cmd" >&2
    sed -n '4,19p' "$0"
    exit 2
    ;;
esac
