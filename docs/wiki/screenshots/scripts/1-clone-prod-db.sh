#!/usr/bin/env bash
# 1-clone-prod-db.sh — pull the prod Postgres dump for screenshot generation.
#
# Output: docs/wiki/screenshots/dump/prod-dump.sql.gz (gitignored)
# Re-runnable; overwrites the dump each run.
#
# Reads SSH config from the repo's deploy-config.local.sh (same one deploy.sh uses).
# No prompts; expects key-based SSH.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCREENSHOT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

# Load SSH config from deploy-config.local.sh (gitignored, same as deploy.sh uses)
if [[ -f "$REPO_ROOT/deploy-config.local.sh" ]]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/deploy-config.local.sh"
else
  echo "error: $REPO_ROOT/deploy-config.local.sh not found." >&2
  echo "       this script reuses the same SSH config as webapp/deploy.sh." >&2
  exit 1
fi

HOST="${HOST:-}"
PORT="${PORT:-22}"
DEPLOY_USER="${DEPLOY_USER:-root}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
PROJECT_NAME="${PROJECT_NAME:-kinboard}"

if [[ -z "$HOST" ]]; then
  echo "error: HOST not set in deploy-config.local.sh." >&2
  exit 1
fi

OUT="$SCREENSHOT_ROOT/dump/prod-dump.sql.gz"
mkdir -p "$(dirname "$OUT")"

echo "Cloning prod DB"
echo "  Source:      $DEPLOY_USER@$HOST:$PORT (container: ${PROJECT_NAME}-db)"
echo "  Destination: $OUT"
echo ""

SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -p $PORT $DEPLOY_USER@$HOST"

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
