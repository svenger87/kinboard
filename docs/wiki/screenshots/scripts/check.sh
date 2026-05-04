#!/usr/bin/env bash
# check.sh — report what wiki screenshots are done vs pending vs orphans.
#
# Status sources:
#   - "TODO markers" in docs/wiki/*.md  → pending
#   - PNG files in docs/wiki/images/    → done
#   - PNGs not referenced anywhere      → orphans

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WIKI_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGES_DIR="$WIKI_DIR/images"

cd "$WIKI_DIR"

# ---- Done: PNGs that exist ----
done_count=0
done_list=$(find images -name "*.png" -not -path "*/mobile/*" -not -path "*/mobile-framed/*" 2>/dev/null | sort) || true

# ---- Pending: TODO markers in any *.md, exclude Screenshots-needed.md itself ----
pending=$(grep -rE "^> TODO: screenshot" --include="*.md" --exclude="Screenshots-needed.md" --exclude="README.md" 2>/dev/null | sed -E 's|^([^:]+):> TODO: screenshot of (.+)$|\2 (\1)|' || true)

# ---- Orphans: PNGs in images/ that are not referenced by any md ----
orphan_list=""
if [[ -d "$IMAGES_DIR" ]]; then
  while IFS= read -r png; do
    [ -z "$png" ] && continue
    base=$(basename "$png")
    if ! grep -qrF "$base" --include="*.md" . 2>/dev/null; then
      orphan_list+=$'\n'"  $png"
    fi
  done < <(find images -name "*.png" -not -path "*/mobile/*" 2>/dev/null)
fi

# ---- Output ----
echo "=== Screenshot status ==="
echo ""

if [[ -n "$done_list" ]]; then
  echo "✅ Done (in docs/wiki/images/):"
  echo "$done_list" | sed 's|^|  |'
  done_count=$(echo "$done_list" | wc -l | tr -d ' ')
else
  echo "✅ Done: 0"
fi
echo ""

if [[ -n "$pending" ]]; then
  echo "⏳ Pending (still has TODO marker):"
  echo "$pending" | sed 's|^|  |'
  pending_count=$(echo "$pending" | wc -l | tr -d ' ')
else
  echo "⏳ Pending: 0"
  pending_count=0
fi
echo ""

if [[ -n "$orphan_list" ]]; then
  echo "⚠ Orphans (PNG exists, no wiki page references it):"
  echo "$orphan_list"
  orphan_count=$(echo "$orphan_list" | wc -l | tr -d ' ')
else
  echo "⚠ Orphans: 0"
  orphan_count=0
fi

echo ""
echo "Summary: $done_count done · $pending_count pending · $orphan_count orphan"
