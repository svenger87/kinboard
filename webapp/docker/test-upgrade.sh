#!/usr/bin/env bash
# Not an updater. This file only explains that, and never runs anything.
#
# Until 1.17 the upgrade test rig lived here, next to start.sh, and a
# self-hoster ran it to update (#539): it built a throwaway kbupg-* stack beside
# his own and updated nothing. The rig is now scripts/rigs/test-upgrade.sh and
# refuses to start unless a developer asks for it (KINBOARD_RIG=1).
#
# Kept for docs and muscle memory that still point here.
# TODO(1.19): remove this stub.
#
# The words match rig_not_an_updater in scripts/rigs/rig-intent.sh;
# e2e/dev-rigs-refuse.spec.ts checks both.

cat >&2 <<'MSG'

  test-upgrade.sh is a developer test, not an updater.

  It builds a separate, throwaway copy of Kinboard next to yours, runs checks
  against it and deletes it again. It does not update your Kinboard.

  To update Kinboard, run this in the folder you installed it in:

      git pull
      cd webapp/docker && ./start.sh up

  More on updating: https://github.com/svenger87/kinboard/wiki/Self-hosting#updates

  (Developers: the test is scripts/rigs/test-upgrade.sh now, and runs with
  KINBOARD_RIG=1 in a worktree of your own.)

MSG
exit 2
