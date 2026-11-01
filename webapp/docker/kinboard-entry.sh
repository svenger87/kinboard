#!/bin/sh
# kinboard-entry.sh — retired in 1.15, kept as a shim for one upgrade.
#
# Until 1.15 this moved Kong in front of the webapp (RFC-018). Kong is gone:
# the webapp serves the app, /rest/v1 and the uploaded files itself and
# publishes WEBAPP_PORT directly, so there is no front door left to choose.
#
# The file stays because of how an install reaches 1.15. kinboard-self-update.sh
# runs `git pull` and then carries on executing the copy it started with — the
# previous version — and that copy calls this file by name:
#
#   normalise, prepare, confirm, recover, switch, kong-stale
#
# Everything answers "nothing to do", except two:
#
#   prepare     runs immediately before that old script's `docker compose up`.
#               Here it removes the containers 1.15 retired (kong, auth,
#               realtime, storage, imgproxy). The old script's `up` has no
#               --remove-orphans, so without this they would keep running —
#               and Kong would keep WEBAPP_PORT, which the webapp needs now,
#               failing the up. A service still defined by the stack's compose
#               files (an overlay that adds one back) is left alone.
#   kong-stale  exits 1 ("Kong does not need a restart"), so the old script
#               does not try to restart a container that no longer exists.
#
# Also `retire`, the same as prepare, for start.sh and the new self-update.
#
# Environment: ENV_FILE (./.env), COMPOSE ("docker compose"), COMPOSE_FILES
# ("-f docker-compose.yml"). POSIX sh: the self-update runs in Alpine.

set -eu

ENV_FILE="${ENV_FILE:-./.env}"
COMPOSE="${COMPOSE:-docker compose}"
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml}"

say() { echo "entry: $*"; }

retire() {
  project="$(grep -E '^PROJECT_NAME=' "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"' || true)"
  project="${project:-kinboard}"
  # shellcheck disable=SC2086
  defined="$($COMPOSE $COMPOSE_FILES config --services 2>/dev/null || true)"
  if [ -z "$defined" ]; then
    say "could not read the compose files; leaving every container as it is"
    return 0
  fi
  for svc in kong auth realtime storage imgproxy; do
    if printf '%s\n' "$defined" | grep -qx "$svc"; then
      say "$svc is still defined by the compose files; leaving it"
      continue
    fi
    name="$project-$svc"
    if docker container inspect "$name" >/dev/null 2>&1; then
      if docker rm -f "$name" >/dev/null 2>&1; then
        say "removed $name (retired in 1.15)"
      else
        say "could not remove $name; remove it by hand: docker rm -f $name"
      fi
    fi
  done
  # Leftovers of the old front-door move; nothing reads them any more.
  rm -f "${ENV_FILE}.pre-entry" "${ENV_FILE}.entry-state" 2>/dev/null || true
}

case "${1:-}" in
  prepare | retire) retire ;;
  kong-stale | has-route) exit 1 ;;
  *) exit 0 ;;
esac
