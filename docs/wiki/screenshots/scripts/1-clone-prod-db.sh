#!/usr/bin/env bash
# 1-clone-prod-db.sh — pull the prod Postgres dump for screenshot generation.
#
# Output: docs/wiki/screenshots/dump/prod-dump.sql.gz (gitignored)
# Re-runnable; overwrites the dump each run.
#
# SSH details come from the environment, and nothing else:
#   SCREENSHOT_SSH_HOST  host, or a Host alias from ~/.ssh/config (required)
#   SCREENSHOT_SSH_PORT  port (default 22, or what ~/.ssh/config says for the alias)
#   SCREENSHOT_SSH_USER  user (default: ~/.ssh/config's, else root)
#   SCREENSHOT_SSH_KEY   identity file (default: ~/.ssh/config's)
#   SCREENSHOT_PROJECT   the stack's PROJECT_NAME there (default kinboard)
# No prompts; expects key-based SSH.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCREENSHOT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

HOST="${SCREENSHOT_SSH_HOST:-}"
PROJECT_NAME="${SCREENSHOT_PROJECT:-kinboard}"

if [[ -z "$HOST" ]]; then
  echo "error: SCREENSHOT_SSH_HOST is not set." >&2
  echo "       Set it to the host that runs the stack to copy (or a Host alias from ~/.ssh/config)," >&2
  echo "       plus SCREENSHOT_SSH_PORT / SCREENSHOT_SSH_USER / SCREENSHOT_SSH_KEY if ~/.ssh/config doesn't say." >&2
  exit 1
fi

OUT="$SCREENSHOT_ROOT/dump/prod-dump.sql.gz"
mkdir -p "$(dirname "$OUT")"

echo "Cloning prod DB"
echo "  Source:      $HOST (container: ${PROJECT_NAME}-db)"
echo "  Destination: $OUT"
echo ""

SSH_ARGS=(-o StrictHostKeyChecking=no)
[[ -n "${SCREENSHOT_SSH_PORT:-}" ]] && SSH_ARGS+=(-p "$SCREENSHOT_SSH_PORT")
[[ -n "${SCREENSHOT_SSH_KEY:-}" ]] && SSH_ARGS+=(-i "$SCREENSHOT_SSH_KEY")
[[ -n "${SCREENSHOT_SSH_USER:-}" ]] && SSH_ARGS+=(-l "$SCREENSHOT_SSH_USER")
SSH="ssh ${SSH_ARGS[*]} $HOST"

# Dump the public schema only — supabase auth/storage internals are recreated
# locally by init.sql when the demo stack starts. --column-inserts gives us
# row-by-row INSERTs the anonymizer can grep over if needed (we mostly run
# the anonymizer against a live local DB, but having grep-able SQL is useful
# for spot-checking what's in the dump).
echo "Running pg_dump on remote..."
$SSH "docker exec ${PROJECT_NAME}-db pg_dump \
  -U postgres \
  -d postgres \
  --schema=public \
  --data-only \
  --column-inserts \
  --no-owner \
  --no-privileges \
  | gzip" > "$OUT"

if [[ ! -s "$OUT" ]]; then
  echo "error: dump file is empty — did pg_dump succeed?" >&2
  rm -f "$OUT"
  exit 2
fi

SIZE=$(du -h "$OUT" | cut -f1)
ROWS=$(gunzip -c "$OUT" | grep -c "^INSERT INTO" || true)

echo ""
echo "Done."
echo "  File: $OUT ($SIZE)"
echo "  ~$ROWS INSERT statements"
echo ""
echo "Next: run scripts/2-anonymize.py against a freshly-restored local DB"
echo "      (docker compose up -d brings up the demo stack first)."
