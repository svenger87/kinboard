#!/bin/sh
# Stamps the service worker with this build's identity before `next build`.
#   sh docker/stamp-sw.sh <path/to/sw.js> <version> [revision]
#
# sw.js names its cache 'kinboard-__KINBOARD_VERSION__-__KINBOARD_REVISION__'.
# Both parts matter. A browser only notices a new build when the bytes of
# sw.js change (that is what fires `updatefound`, which use-pwa.ts listens
# for and pwa-provider.tsx applies on kiosks). With the version alone, every
# build of one version served a byte-identical sw.js, so a screen left open
# kept its old bundle across all of them — six deploys of 1.17.0-rc.3 in a
# day, none of which an open page ever saw.
#
# The revision is the short git sha (BUILD_REVISION). A build that has none
# gets a timestamp plus random bytes instead: never empty, never shared with
# another build.
set -eu

file=$1
version=$2
rev=$(printf '%s' "${3:-}" | tr -cd 'A-Za-z0-9._-')
if [ -z "$rev" ]; then
  rev="local$(date -u +%Y%m%d%H%M%S)$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
fi
version=$(printf '%s' "$version" | tr -cd 'A-Za-z0-9._+-')
[ -n "$version" ] || { echo "stamp-sw: empty version" >&2; exit 1; }

sed -i -e "s/__KINBOARD_VERSION__/${version}/g" \
       -e "s/__KINBOARD_REVISION__/${rev}/g" "$file"

if grep -q '__KINBOARD_' "$file"; then
  echo "stamp-sw: a placeholder is left in $file" >&2
  exit 1
fi
echo "stamp-sw: CACHE_NAME = kinboard-${version}-${rev}"
