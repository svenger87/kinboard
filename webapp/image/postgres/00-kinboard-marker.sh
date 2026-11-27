#!/bin/sh
# Sourced by the official docker-entrypoint.sh once, right after initdb has
# created a new data directory: it is the proof, read by
# kinboard-postgres-guard.sh on every later start, that this directory was
# written by kinboard-postgres (this major, musl) and not by another image.
{
  echo "kinboard-postgres"
  echo "major=${PG_MAJOR}"
  echo "libc=musl"
  echo "created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$PGDATA/KINBOARD_POSTGRES"
chmod 0600 "$PGDATA/KINBOARD_POSTGRES"
