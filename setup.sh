#!/usr/bin/env bash
# Kinboard — first-run bootstrap.
#
# Generates random secrets, populates webapp/docker/.env from .env.example,
# generates VAPID push notification keys, and walks you through optional
# integration keys (OpenWeatherMap, Google Calendar, etc.).
#
# Idempotent: re-running won't overwrite existing values. Already-set keys
# show "already set, skipping" and are left alone.
#
# Flags:
#   --force, -f         regenerate everything from scratch (re-prompts for keys)
#   --non-interactive   never prompt; useful for CI / Docker entrypoint use
#   --advanced          also prompt for Immich, Bring, camera, SMTP server
#   --help, -h          show this help

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_ENV_EXAMPLE="$REPO_ROOT/webapp/docker/.env.example"
DOCKER_ENV="$REPO_ROOT/webapp/docker/.env"
WEBAPP_ENV_EXAMPLE="$REPO_ROOT/webapp/.env.example"
WEBAPP_ENV="$REPO_ROOT/webapp/.env.local"

force=0
non_interactive=0
advanced=0
for arg in "$@"; do
  case "$arg" in
    --force|-f) force=1 ;;
    --non-interactive) non_interactive=1 ;;
    --advanced) advanced=1 ;;
    --help|-h)
      sed -n '3,15p' "$0"
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
# 1b. Resolve the public URL the BROWSER will use to reach Kinboard
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
  Where will you and your family open Kinboard?
==============================================================

  This is the address you'll type into a browser to use Kinboard.
  Pick the option that matches your setup:

  1) Just trying it on this machine?
        http://localhost:8100

  2) Other devices in your home — phone, tablet, kitchen kiosk?
        Use this server's LAN IP, e.g.  http://192.168.1.50:8100
        (find it with: hostname -I)

  3) Accessing from outside your home (and you have a domain + Traefik)?
        https://kinboard.your-domain.com
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
# Default-port deployments expose Kong on :8100 and the webapp on :3001 as
# two separate host ports — swap the suffix. Reverse-proxy deployments
# (Traefik / Caddy / Cloudflare Tunnel) front both behind the same
# hostname with no port — keep api_url as-is so SITE_URL matches.
if [[ "$api_url" == *:8100 || "$api_url" == *:8100/* ]]; then
  site_url=$(echo "$api_url" | sed -E 's|:8100|:3001|; s|/$||')
else
  site_url="${api_url%/}"
fi

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

  # Append the line with an empty value if the file doesn't have it at
  # all yet (e.g. existing self-hosters whose .env predates a new key
  # introduced in a later release). Without this, awk's pattern-match
  # rewrite below silently no-ops on missing keys and the new secret
  # never lands.
  if ! grep -qE "^${key}=" "$file"; then
    printf '%s=\n' "$key" >> "$file"
  fi

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
# Used only when the docker-compose.diun.yml auto-update overlay is
# enabled. Harmless to generate eagerly — costs nothing if unused.
DIUN_WEBHOOK_SECRET=$(openssl rand -hex 32)

echo "→ filling random secrets in $DOCKER_ENV"
fill_secret POSTGRES_PASSWORD "$POSTGRES_PASSWORD" "$DOCKER_ENV"
fill_secret JWT_SECRET "$JWT_SECRET" "$DOCKER_ENV"
fill_secret SECRET_KEY_BASE "$SECRET_KEY_BASE" "$DOCKER_ENV"
fill_secret CRON_SECRET "$CRON_SECRET" "$DOCKER_ENV"
fill_secret DIUN_WEBHOOK_SECRET "$DIUN_WEBHOOK_SECRET" "$DOCKER_ENV"
# Auto-detect the project's host path from setup.sh's own location.
# Used by the Diun overlay's webhook bind-mount; see .env.example.
fill_secret KINBOARD_PROJECT_DIR "$REPO_ROOT" "$DOCKER_ENV"

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
# 3b. Interactive prompts for optional integration keys
# ----------------------------------------------------------------------
# Walks the user through API keys that need to live in .env (server-side
# only — keys that have a per-family in-app UI like Home Assistant URL
# are handled in /settings/* instead and aren't prompted for here).
#
# Idempotent: each prompt skips if the key is already set in .env. Pass
# --force to re-prompt. Pass --non-interactive to skip the entire block
# (useful for CI / Docker entrypoint). Pass --advanced to also prompt
# for Immich, Bring, camera credentials, and SMTP server config.

prompt_for_key() {
  # $1 = .env key name
  # $2 = human-readable label / question
  # $3 = optional URL or hint shown above the input prompt
  local key="$1"
  local label="$2"
  local hint="${3:-}"

  local current
  current=$(grep -E "^${key}=" "$DOCKER_ENV" | head -n1 | cut -d= -f2- | tr -d '\r')
  # Strip surrounding double quotes so `KEY=""` (empty quoted) is treated
  # as empty rather than a 2-char value.
  current="${current%\"}"; current="${current#\"}"

  if [[ -n "$current" ]] && [[ $force -eq 0 ]]; then
    echo "  $key already set, skipping"
    return
  fi

  echo
  echo "  $label"
  if [[ -n "$hint" ]]; then
    echo "  $hint"
  fi
  local value
  read -r -p "  $key (Enter to skip): " value
  if [[ -n "$value" ]]; then
    awk -v k="$key" -v v="$value" '
      $0 ~ "^"k"=" { print k"="v; next }
      { print }
    ' "$DOCKER_ENV" > "$DOCKER_ENV.tmp" && mv "$DOCKER_ENV.tmp" "$DOCKER_ENV"
    echo "  ✓ $key set"
  else
    echo "  → $key skipped"
  fi
}

if [[ -t 0 ]] && [[ $non_interactive -eq 0 ]]; then
  cat <<EOF

==============================================================
  Optional integration keys
==============================================================

  Press Enter to skip any field. You can add or change keys in
  webapp/docker/.env later and re-run ./setup.sh to fill in
  what's still empty.

EOF

  prompt_for_key SMTP_ADMIN_EMAIL \
    "Maintainer email — used for VAPID push compliance + supabase admin notifications"

  # Sync VAPID_SUBJECT from SMTP_ADMIN_EMAIL when the email was just set
  # AND VAPID_SUBJECT is still the .env.example default. Avoids stomping
  # a custom mailto: the user might have set themselves.
  smtp_admin=$(grep -E "^SMTP_ADMIN_EMAIL=" "$DOCKER_ENV" | head -n1 | cut -d= -f2- | tr -d '\r')
  vapid_subject=$(grep -E "^VAPID_SUBJECT=" "$DOCKER_ENV" | head -n1 | cut -d= -f2- | tr -d '\r')
  if [[ -n "$smtp_admin" ]] \
     && [[ "$smtp_admin" != "admin@example.com" ]] \
     && { [[ "$vapid_subject" == "mailto:admin@example.com" ]] || [[ -z "$vapid_subject" ]]; }; then
    awk -v v="mailto:$smtp_admin" '
      /^VAPID_SUBJECT=/ { print "VAPID_SUBJECT="v; next }
      { print }
    ' "$DOCKER_ENV" > "$DOCKER_ENV.tmp" && mv "$DOCKER_ENV.tmp" "$DOCKER_ENV"
    echo "  ✓ VAPID_SUBJECT mirrored to mailto:$smtp_admin"
  fi

  prompt_for_key OPENWEATHERMAP_API_KEY \
    "OpenWeatherMap API key — for the weather widget" \
    "Free tier: https://openweathermap.org/api  (sign up, copy from dashboard)"

  echo
  echo "  Google Calendar OAuth credentials"
  echo "  Get a CLIENT_ID + CLIENT_SECRET from a Google Cloud project:"
  echo "    https://console.cloud.google.com/apis/credentials → Create OAuth client ID"
  echo "  Walkthrough: https://github.com/svenger87/kinboard/wiki/Google-Calendar"
  echo "  Skip both fields to disable Google Calendar entirely."
  prompt_for_key GOOGLE_CLIENT_ID "Google OAuth client ID"
  prompt_for_key GOOGLE_CLIENT_SECRET "Google OAuth client secret"

  if [[ $advanced -eq 1 ]]; then
    cat <<EOF

  ── advanced ──
  These have per-family in-app UIs at /settings/<integration> — only
  prefill them in .env if you want a stack-wide default that doesn't
  depend on per-family setup.

EOF
    prompt_for_key IMMICH_API_URL \
      "Immich API URL — fallback default for the photo screensaver"
    prompt_for_key IMMICH_API_KEY "Immich API key"
    prompt_for_key BRING_EMAIL "Bring! email — fallback default for shopping sync (legacy)"
    prompt_for_key BRING_PASSWORD "Bring! password"
    prompt_for_key CAMERA_USER \
      "Default RTSP camera username — used by go2rtc.yaml's camera entries"
    prompt_for_key CAMERA_PASS \
      "Default RTSP camera password" \
      "URL-encode special chars: '#' → '%23', '@' → '%40'"
    prompt_for_key HIKVISION_HOST "Hikvision camera host (LAN IP)"
    prompt_for_key AMCREST_HOST "Amcrest/Dahua camera host (LAN IP)"
    prompt_for_key SMTP_HOST \
      "SMTP server host" \
      "Only needed if you actually use supabase auth's email features — the device-cookie auth model doesn't"
    prompt_for_key SMTP_PORT "SMTP server port (e.g. 587 for STARTTLS, 465 for TLS)"
    prompt_for_key SMTP_USER "SMTP username"
    prompt_for_key SMTP_PASS "SMTP password / app token"
  fi

elif [[ $non_interactive -eq 1 ]]; then
  echo "→ skipping interactive prompts (--non-interactive)"
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
# Summarize which optional keys are still empty so the user knows what
# they can come back and fill in.
unset_keys=()
for key in OPENWEATHERMAP_API_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  value=$(grep -E "^${key}=" "$DOCKER_ENV" | head -n1 | cut -d= -f2- | tr -d '\r')
  value="${value%\"}"; value="${value#\"}"
  [[ -z "$value" ]] && unset_keys+=("$key")
done

cat <<EOF

Setup complete. All required secrets are generated and the kong gateway
is wired up.

Next steps:
EOF

if [[ ${#unset_keys[@]} -gt 0 ]]; then
  cat <<EOF
  1. (Optional) Fill in the keys you skipped — edit webapp/docker/.env
     directly, or re-run ./setup.sh to be prompted again:
EOF
  for key in "${unset_keys[@]}"; do
    case "$key" in
      OPENWEATHERMAP_API_KEY) echo "       $key  (weather widget)" ;;
      GOOGLE_CLIENT_ID)       echo "       $key       (Google Calendar sync)" ;;
      GOOGLE_CLIENT_SECRET)   echo "       $key   (Google Calendar sync)" ;;
    esac
  done
  echo
  echo "  2. Bring the stack up:"
else
  echo "  1. Bring the stack up:"
fi

cat <<EOF
       cd webapp/docker
       ./start.sh up

  $([ ${#unset_keys[@]} -gt 0 ] && echo "3" || echo "2"). Open ${site_url} and create your first family.

EOF
