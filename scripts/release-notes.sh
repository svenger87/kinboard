#!/usr/bin/env bash
# release-notes.sh — print a version's section of CHANGELOG.md, the notes of
# its GitHub release (RFC-024 §6). Used by the `release` job in
# .github/workflows/docker.yml, and by hand:
#
#   gh release create vX.Y.Z --notes-file <(scripts/release-notes.sh vX.Y.Z)
#
# Which section:
#   vX.Y.Z        `## [X.Y.Z]`
#   vX.Y.Z-rc.N   `## [X.Y.Z-rc.N]` if there is one, else `## [Unreleased]`,
#                 where release candidates collect entries until the stable cut
#
# The section runs to the next `## [` heading, without its own heading, and
# with leading and trailing blank lines trimmed: the same extraction RELEASE.md
# has always used. Exits 1, printing nothing, when the section is missing or
# has no text, so a release never goes out with empty notes by accident.
set -euo pipefail

tag="${1:?usage: release-notes.sh <tag> [CHANGELOG.md]}"
changelog="${2:-$(dirname "$0")/../CHANGELOG.md}"
version="${tag#v}"

section() {
  awk -v want="## [$1]" '
    index($0, want) == 1 { f = 1; next }
    /^## \[/ { f = 0 }
    f
  ' "$changelog" | sed -e '/./,$!d' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}'
}

notes="$(section "$version")"
if [ -z "$notes" ] && [[ "$version" == *-* ]]; then
  notes="$(section Unreleased)"
fi

if [ -z "$notes" ]; then
  echo "release-notes.sh: no entries for $tag in $changelog" >&2
  exit 1
fi
printf '%s\n' "$notes"
