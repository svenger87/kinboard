#!/usr/bin/env bash
# Familyboard — first-run bootstrap.
#
# Generates random secrets, populates webapp/docker/.env from .env.example,
# generates VAPID push notification keys, and prints next steps.
#
# Idempotent: re-running won't overwrite existing values. Pass --force to
# regenerate everything from scratch.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_ENV_EXAMPLE="$REPO_ROOT/webapp/docker/.env.example"
DOCKER_ENV="$REPO_ROOT/webapp/docker/.env"
WEBAPP_ENV_EXAMPLE="$REPO_ROOT/webapp/.env.example"
WEBAPP_ENV="$REPO_ROOT/webapp/.env.local"

force=0
for arg in "$@"; do
  case "$arg" in
    --force|-f) force=1 ;;
    --help|-h)
      sed -n '3,11p' "$0"
      exit 0
      ;;
  esac
done

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: \`$1\` is required but not on PATH" >&2
    return 1
  }
}

require openssl

# node + npx are only needed for VAPID push-notification key generation.
# Without them setup still completes; push notifications just stay
# disabled until the user generates VAPID keys themselves later.
HAVE_NODE=0
if command -v node >/dev/null 2>&1 && command -v npx >/dev/null 2>&1; then
  HAVE_NODE=1
fi

# ----------------------------------------------------------------------
# 1. Bootstrap the docker stack .env
# ----------------------------------------------------------------------
if [[ ! -f "$DOCKER_ENV" ]] || [[ $force -eq 1 ]]; then
  echo "→ creating $DOCKER_ENV from .env.example"
  cp "$DOCKER_ENV_EXAMPLE" "$DOCKER_ENV"
fi

# ----------------------------------------------------------------------
# 1b. Resolve the public URL the BROWSER will use to reach Familyboard
# ----------------------------------------------------------------------
# This URL is baked into the client JS bundle via build-arg NEXT_PUBLIC_
# SUPABASE_URL. Browsers use it for direct PostgREST + Auth calls. The
# default `http://localhost:8100` only works when the browser is on the
# same machine that runs the stack — accessing from another device on
# the LAN or from the public internet needs the actual server IP/host.
#
# We auto-detect a plausible public IP if the user hasn't pre-set
# API_EXTERNAL_URL. Skipped when the env var is set non-interactively.
existing_api_url=$(grep -E "^API_EXTERNAL_URL=" "$DOCKER_ENV" | head -n1 | cut -d= -f2- | tr -d '\r')
default_api_url="${existing_api_url:-http://localhost:8100}"

if [[ -t 0 ]] && [[ "$default_api_url" == "http://localhost:8100" ]]; then
  # Auto-detect plausible defaults for the suggestion line.
  detected_public_ip=$(curl -s --max-time 3 https://api.ipify.org 2>/dev/null || true)
  detected_lan_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)

  if [[ -n "$detected_public_ip" && "$detected_public_ip" != "$detected_lan_ip" ]]; then
    # Server with public IP (e.g. VPS) — most likely they want public access
    suggested="http://${detected_public_ip}:8100"
    suggestion_reason="this machine's public IP"
  elif [[ -n "$detected_lan_ip" && "$detected_lan_ip" != "127.0.0.1" ]]; then
    # Home server / NAS — LAN-only access default
    suggested="http://${detected_lan_ip}:8100"
    suggestion_reason="this machine's LAN IP"
  else
    suggested="$default_api_url"
    suggestion_reason="localhost only — won't work from other devices"
  fi

  cat <<EOF

==============================================================
  Where will you and your family open Familyboard?
==============================================================

  This is the address you'll type into a browser to use Familyboard.
  Pick the option that matches your setup:

  1) Just trying it on this machine?
        http://localhost:8100

  2) Other devices in your home — phone, tablet, kitchen kiosk?
        Use this server's LAN IP, e.g.  http://192.168.1.50:8100
        (find it with: hostname -I)

  3) Accessing from outside your home (and you have a domain + Traefik)?
        https://familyboard.your-domain.com
        See the wiki Self-hosting page for the Traefik setup.

  4) Cloud server (Hetzner / DigitalOcean / etc.)?
        http://YOUR-SERVER-IP:8100

  Don't forget the port (:8100) unless you're using Traefik.

  Suggested: ${suggested}
             (${suggestion_reason})

EOF
  read -r -p "  Press Enter to accept, or type a different URL: " user_url
  api_url="${user_url:-$suggested}"
else
  api_url="$default_api_url"
fi

# Strip trailing slash for consistency
api_url="${api_url%/}"

# Update API_EXTERNAL_URL + SITE_URL + ADDITIONAL_REDIRECT_URLS to match.
# SITE_URL goes to the webapp port (3001); API goes to Kong (8100).
site_url=$(echo "$api_url" | sed -E 's|:8100$|:3001|; s|/$||')
[[ "$site_url" == "$api_url" ]] && site_url="http://localhost:3001"

# Force-update these even on idempotent re-runs since they affect baked-in
# build args. Use awk so JWT-style chars are handled.
for kv in "API_EXTERNAL_URL=$api_url" "SITE_URL=$site_url" "ADDITIONAL_REDIRECT_URLS=$site_url"; do
  k="${kv%%=*}"; v="${kv#*=}"
  awk -v k="$k" -v v="$v" '
    $0 ~ "^"k"=" { print k"="v; next }
    { print }
  ' "$DOCKER_ENV" > "$DOCKER_ENV.tmp" && mv "$DOCKER_ENV.tmp" "$DOCKER_ENV"
done
echo "  API_EXTERNAL_URL=$api_url"
echo "  SITE_URL=$site_url"

# ----------------------------------------------------------------------
# 2. Fill in secrets that are still empty
# ----------------------------------------------------------------------
fill_secret() {
  local key="$1"
  local value="$2"
  local file="$3"
  local current
  # Strip trailing \r in case the .env was edited on Windows (CRLF)
  current=$(grep -E "^${key}=" "$file" | head -n1 | cut -d= -f2- | tr -d '\r')
  if [[ -z "$current" ]] || [[ $force -eq 1 ]]; then
    # macOS sed needs an empty backup arg; use a tmp file for portability
    awk -v k="$key" -v v="$value" '
      $0 ~ "^"k"=" { print k"="v; next }
      { print }
    ' "$file" > "$file.tmp"
    mv "$file.tmp" "$file"
    echo "  set $key"
  else
    echo "  $key already set, leaving alone"
  fi
}

# Use hex (alphanumeric-only) for any secret that lands inside a URL —
# base64 emits +/= which break URL parsing inside connection strings.
# gotrue's URL parser nil-pointer-panics on URLs where the password
# component contains an unencoded `/`.
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
SECRET_KEY_BASE=$(openssl rand -hex 48)
CRON_SECRET=$(openssl rand -hex 32)

echo "→ filling random secrets in $DOCKER_ENV"
fill_secret POSTGRES_PASSWORD "$POSTGRES_PASSWORD" "$DOCKER_ENV"
fill_secret JWT_SECRET "$JWT_SECRET" "$DOCKER_ENV"
fill_secret SECRET_KEY_BASE "$SECRET_KEY_BASE" "$DOCKER_ENV"
fill_secret CRON_SECRET "$CRON_SECRET" "$DOCKER_ENV"

# ----------------------------------------------------------------------
# 2b. Generate Supabase ANON_KEY + SERVICE_ROLE_KEY locally
# ----------------------------------------------------------------------
# These are JWTs signed with JWT_SECRET — purely local cryptography, no
# need to "issue" them at supabase.com. The kong gateway uses them for
# the key-auth plugin; the client-side webapp uses ANON_KEY for direct
# PostgREST queries; server-side code uses SERVICE_ROLE_KEY.
#
# Reuse the JWT_SECRET we just generated (or that was already in .env).
JWT_SECRET_NOW=$(grep -E "^JWT_SECRET=" "$DOCKER_ENV" | head -n1 | cut -d= -f2- | tr -d '\r')

# Read existing keys to preserve them on idempotent re-runs
existing_anon=$(grep -E "^ANON_KEY=" "$DOCKER_ENV" | head -n1 | cut -d= -f2- | tr -d '\r')
existing_service=$(grep -E "^SERVICE_ROLE_KEY=" "$DOCKER_ENV" | head -n1 | cut -d= -f2- | tr -d '\r')

if [[ -z "$existing_anon" ]] || [[ -z "$existing_service" ]] || [[ $force -eq 1 ]]; then
  echo "→ minting Supabase ANON_KEY + SERVICE_ROLE_KEY (HS256-signed JWTs)"

  # base64url helpers (no padding)
  b64url() {
    openssl base64 -A | tr '+/' '-_' | tr -d '='
  }
  jwt_sign() {
    # $1 = role
    local role="$1"
    local header payload sig
    header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
    # iat: now; exp: 10 years out (matches supabase docs example)
    local iat exp
    iat=$(date -u +%s)
    exp=$((iat + 10 * 365 * 24 * 3600))
    payload=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$role" "$iat" "$exp" | b64url)
    sig=$(printf '%s' "${header}.${payload}" \
      | openssl dgst -sha256 -hmac "$JWT_SECRET_NOW" -binary \
      | b64url)
    printf '%s.%s.%s' "$header" "$payload" "$sig"
  }

  ANON_KEY=$(jwt_sign "anon")
  SERVICE_ROLE_KEY=$(jwt_sign "service_role")

  fill_secret ANON_KEY "$ANON_KEY" "$DOCKER_ENV"
  fill_secret SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY" "$DOCKER_ENV"
else
  echo "→ ANON_KEY + SERVICE_ROLE_KEY already set, leaving alone"
fi

# ----------------------------------------------------------------------
# 3. Generate VAPID keys for web-push
# ----------------------------------------------------------------------
existing_vapid_pub=$(grep -E "^VAPID_PUBLIC_KEY=" "$DOCKER_ENV" | head -n1 | cut -d= -f2-)
if [[ -z "$existing_vapid_pub" ]] || [[ $force -eq 1 ]]; then
  if [[ $HAVE_NODE -eq 1 ]]; then
    echo "→ generating VAPID keys (web-push)"
    vapid_output=$(npx --yes web-push generate-vapid-keys --json 2>/dev/null)
    vapid_pub=$(echo "$vapid_output" | node -e "const i=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(i.publicKey)")
    vapid_priv=$(echo "$vapid_output" | node -e "const i=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(i.privateKey)")
    fill_secret VAPID_PUBLIC_KEY "$vapid_pub" "$DOCKER_ENV"
    fill_secret VAPID_PRIVATE_KEY "$vapid_priv" "$DOCKER_ENV"
  else
    echo "⚠ skipping VAPID key generation (Node.js not on PATH)"
    echo "  Push notifications will be disabled until you generate keys."
    echo "  To enable later: install Node.js + npx, then re-run setup.sh --force,"
    echo "  or generate keys manually:"
    echo "    npx web-push generate-vapid-keys --json"
    echo "  and add VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY to webapp/docker/.env"
  fi
else
  echo "→ VAPID keys already set, leaving alone"
fi

# ----------------------------------------------------------------------
# 4. Bootstrap the webapp dev .env (for `npm run dev`)
# ----------------------------------------------------------------------
if [[ ! -f "$WEBAPP_ENV" ]]; then
  echo "→ creating $WEBAPP_ENV from .env.example"
  cp "$WEBAPP_ENV_EXAMPLE" "$WEBAPP_ENV"
  echo "  edit it after Supabase keys are issued"
fi

# ----------------------------------------------------------------------
# 5. Substitute Supabase keys into kong.yml (only if the user has set them)
# ----------------------------------------------------------------------
KONG_YML="$REPO_ROOT/webapp/docker/kong.yml"
if [[ -f "$KONG_YML" ]]; then
  anon_key=$(grep -E "^ANON_KEY=" "$DOCKER_ENV" | head -n1 | cut -d= -f2-)
  service_role_key=$(grep -E "^SERVICE_ROLE_KEY=" "$DOCKER_ENV" | head -n1 | cut -d= -f2-)
  if [[ -n "$anon_key" ]] && [[ -n "$service_role_key" ]]; then
    if grep -q "REPLACE_WITH_ANON_KEY\|REPLACE_WITH_SERVICE_ROLE_KEY" "$KONG_YML"; then
      echo "→ substituting ANON_KEY + SERVICE_ROLE_KEY into kong.yml"
      # awk in-place to avoid sed escaping pitfalls with JWT special chars
      awk -v a="$anon_key" -v s="$service_role_key" '
        { gsub(/REPLACE_WITH_ANON_KEY/, a); gsub(/REPLACE_WITH_SERVICE_ROLE_KEY/, s); print }
      ' "$KONG_YML" > "$KONG_YML.tmp" && mv "$KONG_YML.tmp" "$KONG_YML"
    fi
  else
    echo "→ kong.yml left with placeholders — re-run setup.sh after"
    echo "  setting ANON_KEY and SERVICE_ROLE_KEY in webapp/docker/.env"
  fi

  # Always rewrite the webapp_origin CORS lines — site_url can change
  # between runs, and getting it wrong gives the browser CORS errors when
  # talking to Kong. The marker `# webapp_origin` anchors each line so we
  # can rewrite without regenerating the file from a template.
  echo "→ pinning Kong CORS allowed origin to $site_url"
  awk -v origin="$site_url" '
    /# webapp_origin[[:space:]]*$/ {
      match($0, /^[[:space:]]*/);
      indent = substr($0, 1, RLENGTH);
      print indent "- " origin "  # webapp_origin";
      next;
    }
    { print }
  ' "$KONG_YML" > "$KONG_YML.tmp" && mv "$KONG_YML.tmp" "$KONG_YML"
fi

# ----------------------------------------------------------------------
# 6. Next steps
# ----------------------------------------------------------------------
cat <<EOF

Setup complete. All required secrets are generated and the kong gateway
is wired up.

Next steps:
  1. Optional integrations — paste keys into webapp/docker/.env if you
     want them, otherwise leave blank to disable:
       OPENWEATHERMAP_API_KEY  (weather widget)
       GOOGLE_CLIENT_ID/SECRET (Google Calendar sync)
       IMMICH_API_URL/KEY      (photo screensaver)
       camera credentials      (cameras page)

  2. Bring the stack up:
       cd webapp/docker
       ./start.sh up

  3. Open http://localhost:\${WEBAPP_PORT:-3001} and create your first family.

EOF
