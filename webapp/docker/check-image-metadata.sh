#!/usr/bin/env bash
# check-image-metadata.sh — check a pushed multi-arch image carries what
# RFC-024 §6 promises, reading only the registry:
#
#   - the manifest list's annotations: every key=value read from stdin (the
#     IMAGE_METADATA block in .github/workflows/docker.yml), plus a version,
#     revision, created, source and description, and a licenses equal to
#     webapp/package.json's "license" (PACKAGE_JSON overrides the path);
#   - each platform image: the same key=value pairs as OCI labels, and a
#     HEALTHCHECK (read by pulling that image, the one check that downloads);
#   - each platform: an SPDX SBOM with packages in it, and SLSA provenance in
#     max mode (it records the build's config, which min mode leaves out).
#
# Used by the merge job after it pushes the list, and by hand against a local
# registry:
#
#   webapp/docker/check-image-metadata.sh localhost:5000/kinboard:test <<< "$IMAGE_METADATA"
#
# Prints one line per check and exits 1 if any failed.
set -uo pipefail

ref="${1:?usage: check-image-metadata.sh <image ref> < key=value lines}"
# The licence is not taken from stdin: it must be the SPDX id the source
# states, webapp/package.json's "license".
package_json="${PACKAGE_JSON:-$(cd "$(dirname "$0")/.." && pwd)/package.json}"
license="$(jq -er '.license | select(type == "string" and . != "")' "$package_json")" \
  || { echo "no license in $package_json" >&2; exit 2; }
failures=0
ok()   { printf '  ok    %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; failures=$((failures + 1)); }

expected=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  [ -n "$line" ] && [ "${line#\#}" = "$line" ] && expected+=("$line")
done
[ ${#expected[@]} -gt 0 ] || { echo "no key=value lines on stdin" >&2; exit 2; }
# Whatever stdin says about the licence, package.json decides.
for i in "${!expected[@]}"; do
  case "${expected[$i]}" in org.opencontainers.image.licenses=*) unset 'expected[i]' ;; esac
done
expected+=("org.opencontainers.image.licenses=$license")

raw="$(docker buildx imagetools inspect --raw "$ref")" || { echo "cannot read $ref" >&2; exit 2; }
image="$(docker buildx imagetools inspect --format '{{json .Image}}' "$ref")"
sbom="$(docker buildx imagetools inspect --format '{{json .SBOM}}' "$ref")"
provenance="$(docker buildx imagetools inspect --format '{{json .Provenance}}' "$ref")"

# A single-platform index answers with the object itself, a multi-platform
# one with a map keyed by platform: make both a map.
per_platform() { jq -c 'if (type == "object" and (keys | all(test("^[a-z]+/")))) then . else {"single": .} end'; }
image="$(per_platform <<< "$image")"
sbom="$(per_platform <<< "$sbom")"
provenance="$(per_platform <<< "$provenance")"
platforms="$(jq -r 'keys[]' <<< "$image")"
echo "$ref: $(tr '\n' ' ' <<< "$platforms")"

echo "manifest list annotations"
for kv in "${expected[@]}"; do
  key="${kv%%=*}" want="${kv#*=}"
  got="$(jq -r --arg k "$key" '.annotations[$k] // empty' <<< "$raw")"
  [ "$got" = "$want" ] && ok "$key=$got" || bad "$key: want '$want', got '${got:-<missing>}'"
done
for key in version revision created source description; do
  got="$(jq -r --arg k "org.opencontainers.image.$key" '.annotations[$k] // empty' <<< "$raw")"
  [ -n "$got" ] && ok "org.opencontainers.image.$key present" || bad "org.opencontainers.image.$key missing"
done
echo "  (licenses expected from $(basename "$(dirname "$package_json")")/package.json: $license)"

for p in $platforms; do
  echo "$p"
  for kv in "${expected[@]}"; do
    key="${kv%%=*}" want="${kv#*=}"
    got="$(jq -r --arg p "$p" --arg k "$key" '.[$p].config.Labels[$k] // empty' <<< "$image")"
    [ "$got" = "$want" ] && ok "label $key" || bad "label $key: want '$want', got '${got:-<missing>}'"
  done
  # The OCI config type imagetools prints has no Healthcheck (it is a Docker
  # extension), so this one platform image is pulled and read by Docker.
  digest="$(jq -r --arg p "$p" '.manifests[] | select(.platform != null and .platform.os != "unknown")
             | select($p == "single" or "\(.platform.os)/\(.platform.architecture)" == $p) | .digest' <<< "$raw" | head -1)"
  hc=""
  if [ -n "$digest" ] && docker pull -q "${ref%:*}@$digest" >/dev/null 2>&1; then
    hc="$(docker image inspect -f '{{if .Config.Healthcheck}}{{json .Config.Healthcheck}}{{end}}' "${ref%:*}@$digest")"
    docker image rm "${ref%:*}@$digest" >/dev/null 2>&1 || true
  fi
  [ -n "$hc" ] && ok "HEALTHCHECK $hc" || bad "no HEALTHCHECK"
  packages="$(jq -r --arg p "$p" '.[$p].SPDX.packages // [] | length' <<< "$sbom")"
  [ "${packages:-0}" -gt 0 ] && ok "SBOM: SPDX with $packages packages" || bad "no SBOM (or an empty one)"
  max="$(jq -r --arg p "$p" '.[$p].SLSA // {} | [.. | objects | select(has("buildConfig"))] | length' <<< "$provenance")"
  slsa="$(jq -r --arg p "$p" '.[$p].SLSA // empty | type' <<< "$provenance")"
  if [ -z "$slsa" ]; then bad "no provenance"
  elif [ "${max:-0}" -gt 0 ]; then ok "provenance, max mode (buildConfig recorded)"
  else bad "provenance in min mode (no buildConfig)"; fi
done

[ "$failures" -eq 0 ] && { echo "all checks passed"; exit 0; }
echo "$failures check(s) failed"; exit 1
