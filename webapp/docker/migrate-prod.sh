#!/usr/bin/env bash
# migrate-prod.sh — bring an existing production deploy up to the new
# templated docker-compose layout WITHOUT recreating any running
# service. Run this on the host before the next full-stack restart so
# kong/db/storage don't surprise you when they next get recreated.
#
# Does four idempotent things:
#   1. Appends DATA_DIR, DOMAIN, TRAEFIK_CERT_RESOLVER, TRAEFIK_NETWORK,
#      TZ to webapp/docker/.env if any are missing.
#   2. Substitutes the live ANON_KEY / SERVICE_ROLE_KEY from .env into
#      kong.yml placeholders (only if the placeholders are still there).
#   3. Renders docker-compose.traefik.yml from the .example.
#   4. Creates docker-compose.override.yml pinning the Intel QSV device
#      on go2rtc (only if no override file exists yet).
#
# Usage:
#   ./migrate-prod.sh             # apply
#   ./migrate-prod.sh --dry-run   # preview, change nothing
#
# Override defaults via environment variables, e.g.
#   DOMAIN=foo.example.com TZ=America/Los_Angeles ./migrate-prod.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Production-shaped defaults. Override via env var before running.
: "${DATA_DIR:=/mnt/user/appdata/kinboard}"
: "${DOMAIN:=kinboard.example.com}"
: "${TRAEFIK_CERT_RESOLVER:=cloudflare}"
: "${TRAEFIK_NETWORK:=proxy}"
: "${TZ:=Europe/Berlin}"
: "${PROJECT_NAME:=kinboard}"

dry_run=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) dry_run=1 ;;
    --help|-h)
      sed -n '3,20p' "$0"
      exit 0
      ;;
  esac
done

if [[ ! -f .env ]]; then
  echo "error: $SCRIPT_DIR/.env is missing — nothing to migrate against." >&2
  exit 1
fi

action() {
  if [[ $dry_run -eq 1 ]]; then
    printf '  [dry-run] %s\n' "$*"
  else
    printf '  %s\n' "$*"
  fi
}

run() {
  if [[ $dry_run -eq 0 ]]; then
    "$@"
  fi
}

# ---------------------------------------------------------------------
# 1. Append missing keys to .env
# ---------------------------------------------------------------------
echo "[1/4] checking .env for new templated keys"

declare -A new_keys=(
  [DATA_DIR]="$DATA_DIR"
  [DOMAIN]="$DOMAIN"
  [TRAEFIK_CERT_RESOLVER]="$TRAEFIK_CERT_RESOLVER"
  [TRAEFIK_NETWORK]="$TRAEFIK_NETWORK"
  [TZ]="$TZ"
  [PROJECT_NAME]="$PROJECT_NAME"
)

# Order is important so the appended block is readable
order=(PROJECT_NAME DATA_DIR DOMAIN TRAEFIK_CERT_RESOLVER TRAEFIK_NETWORK TZ)

missing=()
for k in "${order[@]}"; do
  if ! grep -qE "^${k}=" .env; then
    missing+=("$k")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  action "appending ${#missing[@]} key(s) to .env: ${missing[*]}"
  if [[ $dry_run -eq 0 ]]; then
    {
      echo ""
      echo "# ---- migrate-prod.sh ($(date +%F)): added templated keys ----"
      for k in "${missing[@]}"; do
        echo "$k=${new_keys[$k]}"
      done
    } >> .env
  fi
else
  action ".env already has all templated keys — nothing to do"
fi

# ---------------------------------------------------------------------
# 2. Substitute kong.yml JWT placeholders
# ---------------------------------------------------------------------
echo "[2/4] checking kong.yml for placeholder JWTs"

if [[ ! -f kong.yml ]]; then
  action "no kong.yml present — skipping (run a deploy first)"
elif grep -q 'REPLACE_WITH_ANON_KEY\|REPLACE_WITH_SERVICE_ROLE_KEY' kong.yml; then
  anon_key=$(grep -E "^ANON_KEY=" .env | head -n1 | cut -d= -f2-)
  service_role_key=$(grep -E "^SERVICE_ROLE_KEY=" .env | head -n1 | cut -d= -f2-)
  if [[ -z "$anon_key" || -z "$service_role_key" ]]; then
    echo "  error: kong.yml has placeholders but ANON_KEY / SERVICE_ROLE_KEY are blank in .env" >&2
    echo "         add them to .env and re-run this script." >&2
    exit 2
  fi
  action "substituting ANON_KEY + SERVICE_ROLE_KEY into kong.yml"
  if [[ $dry_run -eq 0 ]]; then
    awk -v a="$anon_key" -v s="$service_role_key" '
      { gsub(/REPLACE_WITH_ANON_KEY/, a); gsub(/REPLACE_WITH_SERVICE_ROLE_KEY/, s); print }
    ' kong.yml > kong.yml.tmp && mv kong.yml.tmp kong.yml
  fi
else
  action "kong.yml has no placeholders — already migrated or never templated"
fi

# ---------------------------------------------------------------------
# 3. Render docker-compose.traefik.yml from the example
# ---------------------------------------------------------------------
echo "[3/4] checking docker-compose.traefik.yml"

if [[ -f docker-compose.traefik.yml ]]; then
  action "docker-compose.traefik.yml already present — leaving alone"
elif [[ -f docker-compose.traefik.yml.example ]]; then
  action "rendering docker-compose.traefik.yml from .example"
  run cp docker-compose.traefik.yml.example docker-compose.traefik.yml
else
  action "no docker-compose.traefik.yml.example — skipping (deploy first)"
fi

# ---------------------------------------------------------------------
# 4. Create docker-compose.override.yml for host-specific extras
# ---------------------------------------------------------------------
echo "[4/4] checking docker-compose.override.yml for QSV device pin"

OVERRIDE=docker-compose.override.yml
if [[ -f "$OVERRIDE" ]]; then
  action "$OVERRIDE already present — leaving alone (review manually if needed)"
else
  action "creating $OVERRIDE with Intel QSV device + Berlin TZ on go2rtc"
  if [[ $dry_run -eq 0 ]]; then
    cat > "$OVERRIDE" <<'YAML'
# Per-host overrides. Gitignored (or should be) — pins production
# specifics like the Intel iGPU device that the base compose can't
# default to portably.

version: "3.8"

services:
  go2rtc:
    devices:
      - /dev/dri/renderD128:/dev/dri/renderD128
YAML
  fi
fi

# ---------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------
cat <<EOF

Migration $( [[ $dry_run -eq 1 ]] && echo "preview" || echo "applied" ).

Going forward, drive the stack with:

  cd $SCRIPT_DIR
  export COMPOSE_FILES="-f docker-compose.yml -f docker-compose.traefik.yml -f docker-compose.override.yml"
  ./start.sh up

Or, equivalent docker-compose invocation:
  docker compose \\
    -f docker-compose.yml \\
    -f docker-compose.traefik.yml \\
    -f docker-compose.override.yml \\
    up -d

Verify before relying on this:
  docker compose \\
    -f docker-compose.yml \\
    -f docker-compose.traefik.yml \\
    -f docker-compose.override.yml \\
    config | head -40

Look for: bind paths under /mnt/user/appdata/kinboard, Traefik
labels referencing $DOMAIN, the QSV device on go2rtc, kong.yml without
REPLACE_WITH_* tokens.
EOF
