#!/usr/bin/env bash
# validate-upstream.sh: each generated store listing through that store's own
# tooling, at the commit pinned in scripts/stores/upstream.json (RFC-024 §6.5:
# "the store's own linter where one exists").
#
#   umbrel     getumbrel/umbrel-apps .tools/lint-apps.mjs --check-images, with
#              the listing placed among the store's 400-odd apps, so its port
#              is checked against theirs; images checked for a tag, a digest,
#              amd64 and arm64 in the registry
#   casaos     IceWhaleTech/CasaOS-AppStore's validate_compose.py (YAML,
#              `name`, `x-casaos.id`, `docker compose config -q`), then
#              build-appstore-action's build_appstore.py on a store holding
#              only this listing: the store build that resolves every image
#              per declared architecture and fetches the icon and screenshots
#   truenas    truenas/apps .github/scripts: generate_metadata.py --no-bump,
#              which renders the app with TrueNAS's own library in its
#              apps_validation container and rewrites the metadata it owns;
#              any difference to the committed app.yaml, item.yaml or README
#              fails. Then ci.py --render-only (render + `docker compose config`)
#   portainer  portainer/templates (branch v3) schema.json, draft-07, with
#              Python's jsonschema
#
# What this does NOT do is install anything on the real store systems: that
# is the rehearsal in dist/README.md (RFC-024 §10). scripts/rigs/
# test-store-listings.sh starts the compose that each store would run.
#
# Usage: scripts/stores/validate-upstream.sh [umbrel casaos truenas portainer]
# Needs: git, node, python3 (venv), docker (TrueNAS's renderer, compose config).
# STORES_WORK=<dir> keeps the clones between runs; otherwise a temporary
# directory, removed at the end.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PINS="$HERE/upstream.json"
STORES=("$@"); [ ${#STORES[@]} -gt 0 ] || STORES=(umbrel casaos truenas portainer)

red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
FAILED=()
pin() { node -e 'const p=require(process.argv[1]); const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],p); if(v===undefined) process.exit(1); console.log(v)' "$PINS" "$1"; }
meta() { node --input-type=module -e "import {loadSources} from '$HERE/lib/sources.mjs'; const s=loadSources(); console.log(s.meta$1)"; }

SLUG="$(meta .slug)" || { red "cannot read the metadata"; exit 1; }
NAME="$(meta .name)"

if [ -n "${STORES_WORK:-}" ]; then WORK="$STORES_WORK"; mkdir -p "$WORK"; KEEP=1; else WORK="$(mktemp -d "${TMPDIR:-/tmp}/store-validate.XXXXXX")"; KEEP=0; fi
cleanup() { [ "$KEEP" = 1 ] || rm -rf "$WORK"; }
trap cleanup EXIT

# The listings must be what the metadata generates before anything else.
say "generated listings up to date"
node "$HERE/build-store-listings.mjs" --check || { red "dist/ is out of date"; exit 1; }

# A pinned commit of a repository, shallow; reused when STORES_WORK keeps it.
checkout() { # checkout <dir> <url> <commit>
  local dir="$WORK/$1" url="$2" commit="$3"
  if [ -d "$dir/.git" ] && [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" = "$commit" ]; then
    git -C "$dir" checkout -q -f "$commit" && git -C "$dir" clean -qfdx -e node_modules -e .venv; return
  fi
  rm -rf "$dir"; mkdir -p "$dir"
  git -C "$dir" init -q && git -C "$dir" remote add origin "$url" \
    && git -C "$dir" fetch -q --depth 1 origin "$commit" && git -C "$dir" checkout -q FETCH_HEAD
}

VENV="$WORK/.venv"
python_env() {
  [ -x "$VENV/bin/python" ] || python3 -m venv "$VENV" || return 1
  # shellcheck disable=SC2046
  "$VENV/bin/pip" install -q --disable-pip-version-check $(node -e 'console.log(require(process.argv[1]).python.join(" "))' "$PINS") >/dev/null
}

for store in "${STORES[@]}"; do
  case "$store" in
  umbrel)
    say "umbrel: lint-apps.mjs at $(pin umbrel.commit | cut -c1-12)"
    checkout umbrel "$(pin umbrel.repository)" "$(pin umbrel.commit)" || { FAILED+=("umbrel: checkout"); continue; }
    rm -rf "$WORK/umbrel/$SLUG" && cp -r "$ROOT/dist/umbrel/$SLUG" "$WORK/umbrel/$SLUG"
    ( cd "$WORK/umbrel" && { [ -d node_modules ] || npm ci --ignore-scripts --no-audit --no-fund >/dev/null; } \
      && node .tools/lint-apps.mjs "$SLUG" --check-images --format text --root "$WORK/umbrel" ) >"$WORK/umbrel.log" 2>&1
    rc=$?; cat "$WORK/umbrel.log"
    [ "$rc" = 0 ] && grn "umbrel: lint passed" || { FAILED+=("umbrel: lint-apps.mjs"); red "umbrel: lint failed"; }
    ;;
  casaos)
    say "casaos: validate_compose.py and build_appstore.py"
    python_env || { FAILED+=("casaos: python env"); continue; }
    checkout casaos "$(pin casaos.repository)" "$(pin casaos.commit)" || { FAILED+=("casaos: checkout"); continue; }
    checkout casaos-build "$(pin casaos.build_action_repository)" "$(pin casaos.build_action_commit)" || { FAILED+=("casaos: build action checkout"); continue; }
    rm -rf "$WORK/casaos/Apps/$NAME" && cp -r "$ROOT/dist/casaos/Apps/$NAME" "$WORK/casaos/Apps/$NAME"
    ( cd "$WORK/casaos" && "$VENV/bin/python" .github/actions/validate-compose/scripts/validate_compose.py \
        --app-path "$NAME" --report-json "$WORK/casaos-validate.json" )
    [ $? = 0 ] && grn "casaos: validate_compose.py passed" || FAILED+=("casaos: validate_compose.py")
    # A store of its own, as a third-party store is (docs/guides/third-party-store-guide.md).
    rm -rf "$WORK/casaos-store" "$WORK/casaos-out" && mkdir -p "$WORK/casaos-store/Apps"
    cp -r "$ROOT/dist/casaos/Apps/$NAME" "$WORK/casaos-store/Apps/$NAME"
    "$VENV/bin/python" "$WORK/casaos-build/scripts/build_appstore.py" --source "$WORK/casaos-store" --output "$WORK/casaos-out" \
      --base-url "https://example.invalid/store" --report-json "$WORK/casaos-build.json" >"$WORK/casaos-build.log" 2>&1
    rc=$?; tail -n 25 "$WORK/casaos-build.log"
    errors="$(node -e 'const r=require(process.argv[1]); console.log((r.issues||[]).filter(i=>i.severity==="error").map(i=>i.code+": "+i.message).join("\n"))' "$WORK/casaos-build.json" 2>/dev/null)"
    warnings="$(node -e 'const r=require(process.argv[1]); console.log((r.issues||[]).filter(i=>i.severity!=="error").map(i=>i.code+": "+i.message).join("\n"))' "$WORK/casaos-build.json" 2>/dev/null)"
    [ -n "$warnings" ] && printf 'casaos build warnings:\n%s\n' "$warnings"
    if [ "$rc" = 0 ] && [ -z "$errors" ]; then grn "casaos: build_appstore.py built the store ($(ls "$WORK/casaos-out/apps" 2>/dev/null | tr '\n' ' '))"
    else FAILED+=("casaos: build_appstore.py"); red "casaos: store build failed: $errors"; fi
    ;;
  truenas)
    say "truenas: generate_metadata.py and ci.py --render-only at $(pin truenas.commit | cut -c1-12)"
    python_env || { FAILED+=("truenas: python env"); continue; }
    checkout truenas "$(pin truenas.repository)" "$(pin truenas.commit)" || { FAILED+=("truenas: checkout"); continue; }
    app="$WORK/truenas/ix-dev/community/$SLUG"
    rm -rf "$app" && cp -r "$ROOT/dist/truenas/ix-dev/community/$SLUG" "$app"
    docker pull -q "$(pin truenas.validation_image)" >/dev/null || { FAILED+=("truenas: pull the validation image"); continue; }
    ( cd "$WORK/truenas" && "$VENV/bin/python" .github/scripts/generate_metadata.py --train community --app "$SLUG" --no-bump ) >"$WORK/truenas-meta.log" 2>&1
    rc=$?; grep -E 'ERROR|WARNING|Updated|Success|Error|rror' "$WORK/truenas-meta.log" | head -30
    if [ "$rc" != 0 ]; then FAILED+=("truenas: generate_metadata.py"); red "truenas: generate_metadata.py failed"; tail -30 "$WORK/truenas-meta.log"
    else
      # What TrueNAS's tool wrote must be what we committed (parsed, so its YAML style doesn't count).
      same=1
      for f in app.yaml item.yaml; do
        "$VENV/bin/python" -c 'import sys,yaml; a=yaml.safe_load(open(sys.argv[1])); b=yaml.safe_load(open(sys.argv[2])); sys.exit(0 if a==b else 1)' \
          "$app/$f" "$ROOT/dist/truenas/ix-dev/community/$SLUG/$f" || { same=0; red "truenas: generate_metadata.py changed $f:"; diff <("$VENV/bin/python" -c 'import sys,yaml,json; print(json.dumps(yaml.safe_load(open(sys.argv[1])),indent=1,sort_keys=True))' "$ROOT/dist/truenas/ix-dev/community/$SLUG/$f") <("$VENV/bin/python" -c 'import sys,yaml,json; print(json.dumps(yaml.safe_load(open(sys.argv[1])),indent=1,sort_keys=True))' "$app/$f") | head -40; }
      done
      cmp -s "$app/README.md" "$ROOT/dist/truenas/ix-dev/community/$SLUG/README.md" || { same=0; red "truenas: generate_metadata.py changed README.md:"; diff "$ROOT/dist/truenas/ix-dev/community/$SLUG/README.md" "$app/README.md" | head -30; }
      [ "$same" = 1 ] && grn "truenas: generate_metadata.py leaves app.yaml, item.yaml and README.md as generated" || FAILED+=("truenas: metadata differs from TrueNAS's tool")
    fi
    ( cd "$WORK/truenas" && "$VENV/bin/python" .github/scripts/ci.py --train community --app "$SLUG" --test-file basic-values.yaml --render-only true --skip-metadata ) >"$WORK/truenas-render.yaml" 2>"$WORK/truenas-render.log"
    if [ $? = 0 ] && grep -q '^services:' "$WORK/truenas-render.yaml"; then
      grn "truenas: rendered and accepted by docker compose config ($(grep -cE '^  [a-z0-9-]+:$' "$WORK/truenas-render.yaml") top-level entries)"
      cp "$WORK/truenas-render.yaml" "${TRUENAS_RENDER_OUT:-/dev/null}" 2>/dev/null || true
    else FAILED+=("truenas: ci.py --render-only"); red "truenas: render failed"; tail -30 "$WORK/truenas-render.log"; fi
    ;;
  portainer)
    say "portainer: templates.json against schema.json (v3) at $(pin portainer.commit | cut -c1-12)"
    python_env || { FAILED+=("portainer: python env"); continue; }
    schema="$WORK/portainer-schema.json"
    curl -fsSL "https://raw.githubusercontent.com/portainer/templates/$(pin portainer.commit)/$(pin portainer.schema)" -o "$schema" \
      || { FAILED+=("portainer: fetch schema"); continue; }
    "$VENV/bin/python" - "$schema" "$ROOT/dist/portainer/templates.json" <<'PY'
import json, sys
from jsonschema import Draft7Validator, FormatChecker
schema = json.load(open(sys.argv[1])); doc = json.load(open(sys.argv[2]))
errors = sorted(Draft7Validator(schema, format_checker=FormatChecker()).iter_errors(doc), key=lambda e: list(e.path))
for e in errors: print(f"  {'/'.join(map(str, e.path))}: {e.message}")
sys.exit(1 if errors else 0)
PY
    [ $? = 0 ] && grn "portainer: templates.json is valid" || FAILED+=("portainer: schema")
    docker compose -f "$ROOT/dist/portainer/compose.yml" config -q && grn "portainer: the stack file passes docker compose config" || FAILED+=("portainer: docker compose config")
    ;;
  *) red "unknown store: $store"; FAILED+=("$store: unknown") ;;
  esac
done

echo
if [ ${#FAILED[@]} -gt 0 ]; then red "FAILED: ${FAILED[*]}"; exit 1; fi
grn "every store's own validation passed: ${STORES[*]}"
