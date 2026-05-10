#!/bin/sh
# kinboard-self-update.sh
#
# Runs the FULL Kinboard upgrade path. Triggered by the webhook
# container when Diun detects a new ghcr.io/svenger87/kinboard:* image,
# or run by hand from the host for one-off updates.
#
# Steps (in order, halting on first error):
#   1. git fetch + git pull origin main  — pulls new compose files,
#      kong.yml, migrations, init.sql, seed-demo.sql.
#   2. ./setup.sh --non-interactive       — re-substitutes kong.yml
#      placeholders if a new release shipped new keys/routes. No-ops
#      when nothing's stale.
#   3. docker compose pull                — pulls new GHCR images.
#   4. docker compose up -d                — recreates only services
#      whose image changed. The webapp's entrypoint re-applies all
#      migration_*.sql on boot (idempotent).
#   5. docker restart kinboard-kong        — Kong's DB-less mode doesn't
#      fully reload from `kong reload`. Only kicked if kong.yml's mtime
#      is newer than kong's container start time.
#
# Logs to /var/log/kinboard-update.log inside the webhook container —
# bind-mount that path on the host if you want persistent logs.
#
# Idempotent: re-running when nothing changed is a fast no-op.
#
# Required env / mounts (configured by docker-compose.diun.yml.example):
#   PROJECT_DIR    project root (bind-mounted from host)
#   COMPOSE_FILES  space-separated -f flags for the host's stack overlay
#                  set, e.g. "-f docker-compose.yml -f docker-compose.image.yml -f ..."
#   /var/run/docker.sock  bind-mounted so we can talk to the host docker

set -eu

LOG_FILE="${LOG_FILE:-/var/log/kinboard-update.log}"
PROJECT_DIR="${PROJECT_DIR:-/project}"
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml}"

log() {
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] $*" | tee -a "$LOG_FILE"
}

cd "$PROJECT_DIR"

log "=== self-update fired ==="
log "PROJECT_DIR=$PROJECT_DIR"
log "COMPOSE_FILES=$COMPOSE_FILES"

# 1. git fetch + pull
log "git fetch origin main"
git fetch origin main >>"$LOG_FILE" 2>&1
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/main)"
KONG_BEFORE="$(stat -c %Y webapp/docker/kong.yml 2>/dev/null || echo 0)"

if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  log "pulling $LOCAL_SHA → $REMOTE_SHA"
  git pull --ff-only origin main >>"$LOG_FILE" 2>&1
  log "pulled $REMOTE_SHA"
else
  log "git up-to-date at $LOCAL_SHA"
fi

# 2. setup.sh — idempotent. Re-substitutes kong.yml placeholders if new
#    ones landed; does nothing if everything is already substituted.
if [ -x ./setup.sh ]; then
  log "running setup.sh --non-interactive"
  ./setup.sh --non-interactive >>"$LOG_FILE" 2>&1 || {
    log "ERROR: setup.sh failed; aborting before touching containers"
    exit 1
  }
fi

# 3. + 4. compose pull + up -d
cd webapp/docker
log "docker compose $COMPOSE_FILES pull"
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES pull >>"$LOG_FILE" 2>&1

log "docker compose $COMPOSE_FILES up -d --no-build"
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES up -d --no-build >>"$LOG_FILE" 2>&1

# 5. Kong restart — only if kong.yml changed during this run.
KONG_AFTER="$(stat -c %Y kong.yml 2>/dev/null || echo 0)"
if [ "$KONG_AFTER" != "$KONG_BEFORE" ]; then
  log "kong.yml changed (mtime $KONG_BEFORE → $KONG_AFTER); restarting kinboard-kong"
  docker restart kinboard-kong >>"$LOG_FILE" 2>&1 || log "WARN: kong restart failed (kong may not be running)"
else
  log "kong.yml unchanged; skipping kong restart"
fi

log "=== self-update done ==="
