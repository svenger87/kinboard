#!/usr/bin/env bash
# The system packages one Playwright browser needs on the CI runner, installed
# from .deb files kept between runs (e2e.yml caches $APT_ARCHIVES).
#
# `playwright install --with-deps` downloaded ~100 packages from Ubuntu's
# mirror on every run. The mirror is sometimes slow enough (10-30 s per small
# package, seen 2026-11-19) that the WebKit job spent its whole 45 minutes on
# it. With the .debs cached only what changed since is downloaded; apt-get
# update still runs, since the package lists are needed to install anything.
#
#   bash scripts/ci-playwright-deps.sh chromium|webkit
set -euo pipefail

engine="${1:?usage: ci-playwright-deps.sh <engine>}"
archives="${APT_ARCHIVES:-$HOME/apt-archives}"
mkdir -p "$archives/partial"

# Playwright's own list for this engine and this runner, from its dry run:
#   sudo -- sh -c "apt-get update&& apt-get install -y --no-install-recommends <packages>"
packages="$(npx playwright install-deps --dry-run "$engine" | sed -n 's/.*apt-get install -y --no-install-recommends \(.*\)"$/\1/p')"
if [ -z "$packages" ]; then
  echo "could not read the package list from: npx playwright install-deps --dry-run $engine" >&2
  exit 1
fi

apt_opts=(
  -o "Dir::Cache::Archives=$archives"
  -o APT::Keep-Downloaded-Packages=true
  -o Acquire::Retries=5
  -o Acquire::http::Timeout=30
)

for attempt in 1 2 3; do
  sudo apt-get "${apt_opts[@]}" update && break
  [ "$attempt" = 3 ] && exit 1
  sleep 10
done

cached=$(find "$archives" -maxdepth 1 -name '*.deb' | wc -l)
echo "packages from the cache: $cached .deb files before installing"
# shellcheck disable=SC2086  # one argument per package
sudo apt-get "${apt_opts[@]}" install -y --no-install-recommends $packages

# apt writes as root; the cache step saves as the runner user.
sudo rm -rf "$archives/partial" "$archives/lock"
sudo chown -R "$(id -u):$(id -g)" "$archives"
echo "packages in the cache now: $(find "$archives" -maxdepth 1 -name '*.deb' | wc -l)"
