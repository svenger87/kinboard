#!/bin/sh
# kinboard-updater: automatic image-only updates of an install with no git
# checkout (RFC-023 §4.11.3): a one-file install (compose.yml's `updater`
# service) or the all-in-one image (RFC-024 §4.7). Dockerfile.webhook copies
# it to /usr/local/bin/kinboard-updater, next to kinboard-self-update.sh,
# which does the work.
#
# Until 1.18 this was a two-line wrapper that ignored its arguments: every
# call started the update loop. `docker exec kinboard-updater kinboard-updater
# --help`, run on an Unraid test install, started a second loop beside the
# container's own. Now only the container's main process (or an explicit
# --loop) loops; --check-now runs one check through the same lock as the
# loop's, and anything else prints the usage and changes nothing.

set -eu

SCRIPT="$(dirname "$0")/kinboard-self-update.sh"
export KINBOARD_UPDATER=1

usage() {
  cat <<'EOF'
usage: kinboard-updater [--check-now | --loop | --help]

Keeps Kinboard up to date on an install with no git checkout: a one-file
install (compose.yml) or the all-in-one image.

  (none)        As the container's main process (its entrypoint): check for
                a new image two minutes after the start, then every 30
                minutes. Run any other way, for example with docker exec,
                it prints this and changes nothing.
  --check-now   Check once, now, and exit. If a check is already running,
                it says so and leaves that one to finish.
  --loop        Check every 30 minutes, as the main process does.
  --help        Print this and exit.

The log: updater/update.log in the folder mounted at /kinboard, and
docker logs kinboard-updater.
EOF
}

# Whether this is the container's main process: PID 1, or the one child of
# the init Docker puts in front with --init. A `docker exec` is neither (its
# parent is outside the container, so it sees PPID 0).
main_process() {
  [ "$$" = 1 ] && return 0
  [ "$PPID" = 1 ] || return 1
  case "$(cat /proc/1/comm 2>/dev/null || true)" in
    docker-init | tini | dumb-init | catatonit) return 0 ;;
  esac
  return 1
}

case "$#:${1-}" in
  0:)
    if main_process; then exec sh "$SCRIPT" --tick-loop; fi
    usage >&2
    exit 2 ;;
  1:--loop) exec sh "$SCRIPT" --tick-loop ;;
  1:--check-now) exec sh "$SCRIPT" --tick ;;
  1:-h | 1:--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
