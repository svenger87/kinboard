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
# Every new release also carries compose.yml as an asset (RFC-023 §4.6), so
# releases/latest/download/compose.yml is a stable link: the repository's file
# at the tag, made by scripts/release-compose.mjs with the image name from
# docker.yml (REGISTRY and IMAGE_NAME, the workflow's env) and the release's
# channel as the default tag. A file it can't make stops the release before
# anything is created. A tagged tree without compose.yml (older than the
# one-file install) gets a release without the asset.
#
# RELEASE_ROOT (default: the repository root) is where CHANGELOG.md,
# compose.yml and docs/release-notes/ are read from; the spec points it at a
# fixture.
set -euo pipefail

tag="${1:?usage: publish-release.sh <tag>}"
repo="${REPO:?set REPO=owner/name}"
here="$(cd "$(dirname "$0")" && pwd)"
root="${RELEASE_ROOT:-$here/..}"
notes="$(mktemp)"
assets="$(mktemp -d)"
trap 'rm -rf "$notes" "$assets"' EXIT

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

files=()
if [ -f "$root/compose.yml" ]; then
  image="${REGISTRY:?set REGISTRY (docker.yml)}/${IMAGE_NAME:?set IMAGE_NAME (docker.yml)}"
  REPO="$repo" node "$here/release-compose.mjs" "$tag" "$image" "$root/compose.yml" "$assets/compose.yml"
  files+=("$assets/compose.yml")
else
  echo "::notice::no compose.yml in this tree; $tag gets no compose.yml asset"
fi

gh release create "$tag" --repo "$repo" --verify-tag "${args[@]}" "${files[@]}"
