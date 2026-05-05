#!/usr/bin/env bash
# Kinboard — remote deployment to a self-hosted server over SSH.
#
# This script syncs the source tarball, applies migrations, rebuilds the
# webapp container, and restarts services. It's intended for the project
# maintainer's own NAS deploy; self-hosters should use
# `webapp/docker/start.sh` against a local checkout instead.
#
# Configuration: copy `deploy-config.local.sh.example` to
# `deploy-config.local.sh` (gitignored) and fill in your SSH details.
# Or pass values via environment variables:
#
#   HOST          remote host (required)
#   PORT          SSH port (default: 22)
#   DEPLOY_USER   SSH user (default: root)
#   REMOTE_PATH   absolute path on remote (required)
#   SSH_KEY       SSH private key path (default: ~/.ssh/id_ed25519)
#   PUBLIC_URL    URL printed on success (optional)
#
# Usage:
#   ./deploy.sh                  # full deploy
#   ./deploy.sh --migration-only # apply migrations and exit

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source per-host config if present (gitignored)
if [[ -f "$REPO_ROOT/deploy-config.local.sh" ]]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/deploy-config.local.sh"
fi

HOST="${HOST:-}"
PORT="${PORT:-22}"
USER="${DEPLOY_USER:-root}"
REMOTE_PATH="${REMOTE_PATH:-}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
PUBLIC_URL="${PUBLIC_URL:-}"

if [[ -z "$HOST" || -z "$REMOTE_PATH" ]]; then
  echo "error: HOST and REMOTE_PATH must be set." >&2
  echo "       create deploy-config.local.sh or export the env vars." >&2
  echo "       see the comments at the top of this script." >&2
  exit 2
fi

echo "========================================"
echo "Kinboard Deployment"
echo "========================================"
echo ""
echo "Target: $USER@$HOST:$PORT"
echo "Path:   $REMOTE_PATH"
echo ""

SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -p $PORT $USER@$HOST"
SCP_CMD="scp -i $SSH_KEY -o StrictHostKeyChecking=no -P $PORT"

# =========================================
# Step 1: Apply database migrations
# =========================================
echo "[1/6] Applying database migrations..."

# Run all migration*.sql files from docker/ directory
for migration in "$SCRIPT_DIR"/docker/migration*.sql; do
    [ -f "$migration" ] || continue
    name=$(basename "$migration")
    echo "  → $name"
    $SCP_CMD "$migration" "$USER@$HOST:/tmp/$name"
    $SSH_CMD "docker exec -i ${PROJECT_NAME:-kinboard}-db psql -U postgres -d postgres < /tmp/$name" || true
    $SSH_CMD "rm -f /tmp/$name"
done

# Reload PostgREST schema cache after migrations
$SSH_CMD "docker restart ${PROJECT_NAME:-kinboard}-rest 2>/dev/null" || true

echo "  Done!"

if [ "$1" = "--migration-only" ]; then
    echo ""
    echo "Migration complete!"
    exit 0
fi

# =========================================
# Step 2: Sync full source via tarball
# =========================================
echo "[2/6] Syncing project files..."

# Create tarball of everything needed for the Docker build
# (Dockerfile context is webapp/, so we need src, public, configs, docker/)
TARBALL="/tmp/kinboard-deploy.tar.gz"
cd "$SCRIPT_DIR"
tar czf "$TARBALL" \
    --exclude=node_modules \
    --exclude=.next \
    --exclude=dist \
    --exclude=.git \
    --exclude='*.jpg' \
    --exclude='*.py' \
    --exclude=analysis \
    --exclude=screenshots \
    --exclude=scripts \
    --exclude=bugs.md \
    --exclude=TASKS.md \
    --exclude=README.md \
    --exclude='docker/.env' \
    --exclude='docker/.env.*' \
    src/ \
    public/ \
    messages/ \
    docker/ \
    package.json \
    package-lock.json \
    next.config.mjs \
    next-env.d.ts \
    tailwind.config.ts \
    postcss.config.mjs \
    components.json \
    tsconfig.json 2>/dev/null || true

TARSIZE=$(du -h "$TARBALL" | cut -f1)
echo "  Tarball: $TARSIZE"

# Upload to remote
$SCP_CMD "$TARBALL" "$USER@$HOST:/tmp/kinboard-deploy.tar.gz"

# Wipe tarball-owned directories first so deleted files don't linger (tar extract
# overwrites but doesn't remove). Leave docker/ alone — it holds .env files that
# are intentionally excluded from the tarball and must persist across deploys.
$SSH_CMD "mkdir -p $REMOTE_PATH/webapp && rm -rf $REMOTE_PATH/webapp/src $REMOTE_PATH/webapp/public $REMOTE_PATH/webapp/messages"

# Extract fresh tree
$SSH_CMD "cd $REMOTE_PATH/webapp && tar xzf /tmp/kinboard-deploy.tar.gz"
$SSH_CMD "rm -f /tmp/kinboard-deploy.tar.gz"
rm -f "$TARBALL"

echo "  Done!"

# Compose overlay flags. docker-compose auto-loads docker-compose.yml +
# docker-compose.override.yml, but NOT docker-compose.traefik.yml — without
# the explicit -f flag the webapp recreates without Traefik labels and
# Traefik starts returning 404 for every route. We pass all three explicitly
# (only ones that actually exist on the remote) to keep the labels attached.
COMPOSE_FILES_REMOTE='-f docker-compose.yml'
if $SSH_CMD "test -f $REMOTE_PATH/webapp/docker/docker-compose.traefik.yml"; then
    COMPOSE_FILES_REMOTE="$COMPOSE_FILES_REMOTE -f docker-compose.traefik.yml"
fi
if $SSH_CMD "test -f $REMOTE_PATH/webapp/docker/docker-compose.override.yml"; then
    COMPOSE_FILES_REMOTE="$COMPOSE_FILES_REMOTE -f docker-compose.override.yml"
fi

# =========================================
# Step 3: Rebuild webapp container
# =========================================
echo "[3/6] Rebuilding webapp container..."
$SSH_CMD "cd $REMOTE_PATH/webapp/docker && docker-compose $COMPOSE_FILES_REMOTE build --no-cache webapp"

# =========================================
# Step 4: Restart webapp
# =========================================
echo "[4/6] Restarting webapp..."
$SSH_CMD "cd $REMOTE_PATH/webapp/docker && docker-compose $COMPOSE_FILES_REMOTE up -d --no-deps --force-recreate webapp"

# =========================================
# Step 5: Restart cron scheduler
# =========================================
echo "[5/6] Restarting cron scheduler..."
$SSH_CMD "cd $REMOTE_PATH/webapp/docker && docker-compose $COMPOSE_FILES_REMOTE up -d --no-deps --force-recreate cron"

# =========================================
# Step 6: Clean up unused Docker resources
# =========================================
echo "[6/6] Cleaning up unused Docker images and build cache..."
$SSH_CMD "docker image prune -f 2>/dev/null" || true
$SSH_CMD "docker builder prune -f --keep-storage=2GB 2>/dev/null" || true

# =========================================
# Done
# =========================================
echo ""
echo "========================================"
echo "Deployment Complete!"
echo "========================================"
$SSH_CMD "docker ps --filter name=${PROJECT_NAME:-kinboard} --format 'table {{.Names}}\t{{.Status}}'"
DISK_USAGE=$($SSH_CMD "docker system df --format 'table {{.Type}}\t{{.TotalCount}}\t{{.Size}}\t{{.Reclaimable}}'" 2>/dev/null) || true
if [ -n "$DISK_USAGE" ]; then
    echo ""
    echo "Docker disk usage:"
    echo "$DISK_USAGE"
fi
if [ -n "$PUBLIC_URL" ]; then
    echo ""
    echo "URL: $PUBLIC_URL"
fi
