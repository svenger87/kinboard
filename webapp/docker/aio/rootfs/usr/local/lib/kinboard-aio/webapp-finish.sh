#!/bin/sh
# $1: the entrypoint's exit code. 100 is a refusal (no verified backup before
# a migration; a migration that failed): restarting would only repeat it, so
# the container stops, with the reason as the last lines of its log.
. "$(dirname "$0")/common.sh"
if [ "${1:-0}" = 100 ]; then
  halt_container
fi
# Anything else (a crash): s6 starts it again; a short pause keeps a broken
# start from filling the log.
sleep 3
