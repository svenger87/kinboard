#!/usr/bin/env bash
# Sync docs/wiki/*.md to the GitHub wiki repo.
# Run after changes are merged to main.
#
# Usage:
#   ./docs/wiki/sync.sh                       # uses default repo
#   WIKI_REPO=git@github.com:owner/repo.wiki.git ./docs/wiki/sync.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WIKI_REPO="${WIKI_REPO:-git@github.com:svenger87/kinboard.wiki.git}"
WORK_DIR="${WORK_DIR:-$(mktemp -d)}"

echo "→ cloning $WIKI_REPO into $WORK_DIR"
git clone --depth 1 "$WIKI_REPO" "$WORK_DIR" 2>/dev/null || {
  echo "  (wiki repo doesn't exist yet — initialize it via the GitHub web UI first)"
  echo "  https://github.com/svenger87/kinboard/wiki/_new"
  exit 1
}

echo "→ syncing markdown files"
cp "$SCRIPT_DIR"/*.md "$WORK_DIR/"
mkdir -p "$WORK_DIR/images"
if [[ -d "$SCRIPT_DIR/images" ]]; then
  cp -r "$SCRIPT_DIR/images/." "$WORK_DIR/images/"
fi

cd "$WORK_DIR"
if git diff --quiet && git diff --cached --quiet; then
  echo "→ no changes to publish"
else
  git add -A
  git commit -m "Sync from main repo ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
  git push
  echo "→ pushed to $WIKI_REPO"
fi

# Clean up if we created the workdir
if [[ "${WORK_DIR}" == /tmp/* ]]; then
  rm -rf "$WORK_DIR"
fi
