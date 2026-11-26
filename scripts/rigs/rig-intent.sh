# shellcheck shell=bash
# The first thing every rig sources: refuse to run unless it was run on purpose.
#
# The rigs used to live in webapp/docker/, next to start.sh, under names like
# test-upgrade.sh. To a self-hoster that reads as "the script that tests and
# does the upgrade", and in November 2026 one ran it to update to 1.17 (#539).
# It built and started a whole throwaway kbupg-* stack beside his real one,
# rewrote his webapp/docker/.env to point at that stack, and updated nothing.
#
# So a rig now needs a developer's say-so before it does anything at all:
#   KINBOARD_RIG=1 scripts/rigs/test-upgrade.sh      (CI sets this in rigs.yml)
#   scripts/rigs/test-upgrade.sh --i-am-testing
# and exports KINBOARD_RIG=1 once given, so the start.sh it drives knows the
# rig's .env is meant (see the rig-project check in start.sh).
#
# Usage, at the very top of a rig, before anything reads "$@":
#   . "$RIG_DIR/rig-intent.sh"
#   rig_require_intent "$@"; set -- "${RIG_ARGS[@]}"

# The text a self-hoster sees. webapp/docker/test-upgrade.sh (the stub left at
# the old path) prints the same words; e2e/dev-rigs-refuse.spec.ts holds the
# two to the same update command and link.
rig_not_an_updater() {
  local name="$1"
  cat >&2 <<MSG

  $name is a developer test, not an updater.

  It builds a separate, throwaway copy of Kinboard next to yours, runs checks
  against it and deletes it again. It does not update your Kinboard.

  To update Kinboard, run this in the folder you installed it in:

      git pull
      cd webapp/docker && ./start.sh up

  More on updating: https://github.com/svenger87/kinboard/wiki/Self-hosting#updates

  (Developers: set KINBOARD_RIG=1 or pass --i-am-testing, in a worktree of
  your own, never in an installed copy.)

MSG
}

RIG_ARGS=()
rig_require_intent() {
  local intent="${KINBOARD_RIG:-0}" a
  for a in "$@"; do
    if [ "$a" = "--i-am-testing" ]; then intent=1; else RIG_ARGS+=("$a"); fi
  done
  if [ "$intent" != "1" ]; then
    rig_not_an_updater "$(basename "$0")"
    exit 2
  fi
  export KINBOARD_RIG=1
}
