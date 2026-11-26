#!/usr/bin/env bash
# publish-release.sh — create the GitHub release for a version tag. Run by
# the `release` job in .github/workflows/docker.yml once the image is pushed.
#
#   scripts/publish-release.sh <tag>          (GH_REPO or --repo via $REPO)
#
# Three cases, and nothing is ever overwritten:
#   - a release for the tag already exists (published or draft): left alone;
#   - release candidate (vX.Y.Z-rc.N): published as a pre-release, its notes
#     the changelog (scripts/release-notes.sh), else GitHub's generated notes;
#   - stable (vX.Y.Z): the owner writes these by hand, "Upgrading" first.
#     With docs/release-notes/vX.Y.Z.md in the tagged tree it is published
#     with that file as its body. Without it, it is created as a DRAFT with
#     the changelog section, to be edited and published by hand.
#
# RELEASE_ROOT (default: the repository root) is where CHANGELOG.md and
# docs/release-notes/ are read from; the spec points it at a fixture.
set -euo pipefail

tag="${1:?usage: publish-release.sh <tag>}"
repo="${REPO:?set REPO=owner/name}"
here="$(cd "$(dirname "$0")" && pwd)"
root="${RELEASE_ROOT:-$here/..}"
notes="$(mktemp)"
trap 'rm -f "$notes"' EXIT

# `gh release view <tag>` does not find drafts (a draft has no release under
# the tag yet), so the list, which includes drafts, is what is asked.
existing="$(gh release list --repo "$repo" --limit 200 --json tagName,isDraft \
             --jq ".[] | select(.tagName == \"$tag\") | if .isDraft then \"draft\" else \"published\" end")"
if [ -n "$existing" ]; then
  echo "$tag already has a release ($existing); leaving it alone"
  exit 0
fi

if [[ "$tag" == *-* ]]; then
  args=(--title "$tag" --prerelease)
  if "$here/release-notes.sh" "$tag" "$root/CHANGELOG.md" > "$notes"; then
    args+=(--notes-file "$notes")
  else
    echo "::warning::CHANGELOG.md has no entries for $tag; using GitHub's generated notes"
    args+=(--generate-notes)
  fi
  echo "publishing pre-release $tag"
else
  args=(--title "Kinboard $tag")
  handwritten="$root/docs/release-notes/$tag.md"
  if [ -s "$handwritten" ]; then
    args+=(--notes-file "$handwritten")
    echo "publishing $tag with docs/release-notes/$tag.md"
  elif "$here/release-notes.sh" "$tag" "$root/CHANGELOG.md" > "$notes"; then
    args+=(--draft --notes-file "$notes")
    echo "::notice::no docs/release-notes/$tag.md: $tag created as a DRAFT with its changelog section; edit and publish it by hand"
  else
    args+=(--draft --generate-notes)
    echo "::warning::no docs/release-notes/$tag.md and no '## [${tag#v}]' section in CHANGELOG.md: $tag created as a DRAFT with generated notes"
  fi
fi

gh release create "$tag" --repo "$repo" --verify-tag "${args[@]}"
