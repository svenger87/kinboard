#!/usr/bin/env bash
# Kinboard — unattended download with interactive first-run setup.
#
# Intended entrypoint:
#   curl -fsSL https://raw.githubusercontent.com/svenger87/kinboard/main/install.sh | bash
#
# Existing installations are deliberately out of scope. Refusing an existing
# target is what keeps this convenience installer from replacing local config,
# secrets, compose overlays, or persistent data.

set -euo pipefail

REPOSITORY="${KINBOARD_REPOSITORY:-https://github.com/svenger87/kinboard.git}"
INSTALL_DIR="${KINBOARD_DIR:-$PWD/kinboard}"

fail() {
  echo "Kinboard installer: $*" >&2
  exit 1
}

for command in git docker openssl; do
  command -v "$command" >/dev/null 2>&1 \
    || fail "'$command' is required. Install it, then run this command again."
done

docker compose version >/dev/null 2>&1 \
  || fail "Docker Compose v2 is required ('docker compose')."

if [[ -e "$INSTALL_DIR" ]]; then
  fail "$INSTALL_DIR already exists. This installer never changes an existing installation. Use that checkout's documented update command instead."
fi

# A pipe consumes stdin, so setup.sh cannot use its normal terminal detection.
# Reattach it to the terminal for the public URL and optional integration
# prompts. Headless automation can provide KINBOARD_URL instead.
has_terminal=0
if [[ -t 1 ]] && [[ -r /dev/tty ]] && [[ -w /dev/tty ]]; then
  has_terminal=1
elif [[ -z "${KINBOARD_URL:-}" ]]; then
  fail "no interactive terminal found. Set KINBOARD_URL to the address browsers will use and run again."
fi

echo "Installing Kinboard in $INSTALL_DIR"
git clone --depth 1 "$REPOSITORY" "$INSTALL_DIR"

setup_args=()
if [[ -n "${KINBOARD_URL:-}" ]]; then
  setup_args+=(--url "$KINBOARD_URL")
fi

if [[ $has_terminal -eq 1 ]]; then
  "$INSTALL_DIR/setup.sh" "${setup_args[@]}" </dev/tty
else
  "$INSTALL_DIR/setup.sh" --non-interactive "${setup_args[@]}"
fi

(
  cd "$INSTALL_DIR/webapp/docker"
  COMPOSE_FILES="-f docker-compose.yml -f docker-compose.image.yml" ./start.sh up
)

site_url=$(grep -E '^SITE_URL=' "$INSTALL_DIR/webapp/docker/.env" | head -n1 | cut -d= -f2-)
echo
echo "Kinboard is ready: ${site_url:-http://localhost:3001}"
echo "Installation directory: $INSTALL_DIR"
echo "Keep that directory: it contains your configuration and upgrade tools."
