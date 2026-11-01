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
#   --url <URL>         the address you'll open Kinboard at, e.g.
#                       https://kinboard.example.com or http://192.168.1.50:3001.
#                       Optional: every device reaches the API at the address it
#                       opened Kinboard from, so this is only used for links
#                       handed to other apps. Also settable via KINBOARD_URL.
#   --api-url <URL>     accepted and ignored since 1.15: the API is always on
#                       the address Kinboard was opened from.
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
cli_url="${KINBOARD_URL:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force|-f) force=1 ;;
    --non-interactive) non_interactive=1 ;;
    --advanced) advanced=1 ;;
    --url=*) cli_url="${1#*=}" ;;
    --url) cli_url="${2:-}"; shift || true ;;
    --api-url=*) echo "note: --api-url is ignored since 1.15 (the API is on the app's own address)" >&2 ;;
    --api-url) echo "note: --api-url is ignored since 1.15 (the API is on the app's own address)" >&2; shift || true ;;
    --help|-h)
      sed -n '3,22p' "$0"
      exit 0
      ;;
  esac
  shift || true
done
# Strip a trailing slash so SITE_URL derivation is consistent.
cli_url="${cli_url%/}"

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
# A new install (or --force) starts from .env.example. An existing .env keeps
# what it has; later steps only add what is missing.
fresh_env=0
if [[ ! -f "$DOCKER_ENV" ]] || [[ $force -eq 1 ]]; then
  echo "→ creating $DOCKER_ENV from .env.example"
  cp "$DOCKER_ENV_EXAMPLE" "$DOCKER_ENV"
  fresh_env=1
fi

# ----------------------------------------------------------------------
# 1b. The address
# ----------------------------------------------------------------------
# Every device reaches Kinboard — app and API alike, one container — at
# whatever address it opened it from: the LAN address at home, a domain or a
# tunnel outside. SITE_URL is only the address handed to other apps (calendar
# feed links, OAuth metadata), so it is suggested rather than asked.
#
# Until 1.13 this step asked where Kinboard would be opened and baked the
# answer into every browser call; a wrong answer loaded the page and then sent
# every call nowhere (Discussion #277). Until 1.15 it also managed
# API_EXTERNAL_URL, Kong's address. Kong is gone, and so is that setting: a
# line left in .env is ignored.
#
# Which address to suggest. Arguments are the detected facts, so the decision
# can be tested without a network: public IP, this machine's own addresses,
# the source address of the default route, and whether this is WSL (1/0).
# Prints "url|reason".
suggest_site_url() {
  local public_ip="$1" own_ips="$2" route_ip="$3" is_wsl="$4"

  # WSL2 sits behind its own NAT. Its addresses are the VM's — nothing on the
  # LAN reaches them and they change on restart — while the Windows browser on
  # the same PC reaches the stack through localhost forwarding.
  if [[ "$is_wsl" == "1" ]]; then
    echo "http://localhost:3001|WSL: works from this PC's browser; phones and tablets need WSL mirrored networking — see the wiki"
    return
  fi

  # A public IP only counts when it is on one of this machine's interfaces,
  # which is what a VPS looks like. Behind a home router the public address
  # belongs to the router, and offering it would mean a port forward.
  if [[ -n "$public_ip" ]] && printf '%s\n' $own_ips | grep -qxF "$public_ip"; then
    echo "http://${public_ip}:3001|this machine's public IP"
    return
  fi

  # The address the default route leaves from, rather than whichever
  # `hostname -I` lists first — on a Docker host that can be the docker0
  # bridge.
  local lan_ip="$route_ip"
  [[ -n "$lan_ip" ]] || lan_ip=$(printf '%s\n' $own_ips | head -n1)
  if [[ -n "$lan_ip" && "$lan_ip" != 127.* ]]; then
    echo "http://${lan_ip}:3001|this machine's LAN IP"
  else
    echo "http://localhost:3001|localhost only — won't work from other devices"
  fi
}

env_get() {
  grep -E "^$1=" "$DOCKER_ENV" | tail -n1 | cut -d= -f2- | tr -d '\r"' || true
}

# An address typed with Kong's old port (the habit the pre-1.13 prompt taught)
# names the API; the family opens the same host on the webapp port.
site_url_for() {
  local u="${1%/}"
  if [[ "$u" == *:8100 || "$u" == *:8100/* ]]; then
    echo "$u" | sed -E 's|:8100|:3001|; s|/$||'
  else
    echo "$u"
  fi
}

existing_site_url="$(env_get SITE_URL)"
cli_url="${cli_url%/}"

if [[ -n "$cli_url" ]]; then
  site_url="$(site_url_for "$cli_url")"
elif [[ $fresh_env -eq 0 && -n "$existing_site_url" ]]; then
  # A re-run keeps the address; --url is how it changes.
  site_url="${existing_site_url%/}"
elif [[ -t 0 && $non_interactive -eq 0 ]]; then
  # No question: a suggestion, said out loud, that --url changes later.
  detected_public_ip=$(curl -s --max-time 3 https://api.ipify.org 2>/dev/null || true)
  detected_own_ips=$(hostname -I 2>/dev/null || true)
  detected_route_ip=$(ip route get 1.1.1.1 2>/dev/null \
    | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)
  detected_wsl=0
  grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null && detected_wsl=1
  IFS='|' read -r site_url suggestion_reason <<< \
    "$(suggest_site_url "$detected_public_ip" "$detected_own_ips" "$detected_route_ip" "$detected_wsl")"
  echo "→ Kinboard will answer at ${site_url} (${suggestion_reason})."
  echo "  Every device can use whichever address reaches this machine — the LAN"
  echo "  address, a domain, a tunnel. This one is only used for links handed to"
  echo "  other apps; change it with ./setup.sh --url <address>."
else
  site_url="http://localhost:3001"
fi
site_url="${site_url%/}"

# Force-update on idempotent re-runs. awk, so any character is safe; a key
# the file does not have yet is appended.
if ! grep -qE "^SITE_URL=" "$DOCKER_ENV"; then
  printf 'SITE_URL=\n' >> "$DOCKER_ENV"
fi
awk -v v="$site_url" '$0 ~ /^SITE_URL=/ { print "SITE_URL=" v; next } { print }' \
  "$DOCKER_ENV" > "$DOCKER_ENV.tmp" && mv "$DOCKER_ENV.tmp" "$DOCKER_ENV"
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
CRON_SECRET=$(openssl rand -hex 32)
# Used only when the docker-compose.diun.yml auto-update overlay is
# enabled. Harmless to generate eagerly — costs nothing if unused.
DIUN_WEBHOOK_SECRET=$(openssl rand -hex 32)

echo "→ filling random secrets in $DOCKER_ENV"
fill_secret POSTGRES_PASSWORD "$POSTGRES_PASSWORD" "$DOCKER_ENV"
fill_secret JWT_SECRET "$JWT_SECRET" "$DOCKER_ENV"
fill_secret CRON_SECRET "$CRON_SECRET" "$DOCKER_ENV"
fill_secret DIUN_WEBHOOK_SECRET "$DIUN_WEBHOOK_SECRET" "$DOCKER_ENV"
# Auto-detect the project's host path from setup.sh's own location.
# Used by the Diun overlay's webhook bind-mount; see .env.example.
fill_secret KINBOARD_PROJECT_DIR "$REPO_ROOT" "$DOCKER_ENV"

# ----------------------------------------------------------------------
# 2b. Generate Supabase ANON_KEY + SERVICE_ROLE_KEY locally
# ----------------------------------------------------------------------
# These are JWTs signed with JWT_SECRET — purely local cryptography, no
# need to "issue" them at supabase.com. The browser uses ANON_KEY for its
# PostgREST queries until it has a family token; server-side code uses
# SERVICE_ROLE_KEY.
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

# kong.yml is no longer touched (1.15: Kong is gone). The file stays tracked
# and an install's copy keeps its keys: deleting or changing it upstream would
# stop `git pull --ff-only`, and with it the self-update, on every install
# whose copy setup.sh once filled in.

# ----------------------------------------------------------------------
# 5b. Substitute DIUN_WEBHOOK_SECRET into diun.yml. Diun doesn't evaluate Go-template env-var refs in
# header values, so the secret has to be substituted in at setup time.
# Re-running with a changed secret re-writes the live diun.yml; the
# diun container needs a `docker restart kinboard-diun` afterward to
# pick up the new config.
# ----------------------------------------------------------------------
DIUN_YML="$REPO_ROOT/webapp/docker/diun/diun.yml"
if [[ -f "$DIUN_YML" ]]; then
  diun_secret=$(grep -E "^DIUN_WEBHOOK_SECRET=" "$DOCKER_ENV" | head -n1 | cut -d= -f2-)
  if [[ -n "$diun_secret" ]]; then
    if grep -q "REPLACE_WITH_DIUN_WEBHOOK_SECRET\|X-Diun-Token: '{{ env " "$DIUN_YML"; then
      echo "→ substituting DIUN_WEBHOOK_SECRET into diun.yml"
      awk -v s="$diun_secret" '
        {
          gsub(/REPLACE_WITH_DIUN_WEBHOOK_SECRET/, s);
          # Recover stacks that still have the old broken Go-template syntax.
          gsub(/X-Diun-Token: '\''\{\{ env "DIUN_WEBHOOK_SECRET" \}\}'\''/, "X-Diun-Token: " s);
          print
        }
      ' "$DIUN_YML" > "$DIUN_YML.tmp" && mv "$DIUN_YML.tmp" "$DIUN_YML"
    fi
  fi
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

Setup complete. All required secrets are generated.

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

# Push-notification status — call it out at the very end so a missing
# VAPID key (e.g. Node.js wasn't installed at setup time) doesn't get lost
# in the scrollback. Without these, calendar reminders + other push alerts
# stay silently disabled.
vapid_pub_now=$(grep -E "^VAPID_PUBLIC_KEY=" "$DOCKER_ENV" | head -n1 | cut -d= -f2- | tr -d '\r')
if [[ -z "$vapid_pub_now" ]]; then
  cat <<'EOF'
⚠ Push notifications are OFF — no VAPID keys are set (Node.js wasn't found
  when secrets were generated). Calendar reminders and other push alerts
  stay disabled until you add them. To enable:
       install Node.js + npx, then re-run:  ./setup.sh --force

EOF
fi
