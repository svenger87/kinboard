#!/usr/bin/env bash
# Kinboard — unattended download with interactive first-run setup.
#
# Intended entrypoint:
#   curl -fsSL https://raw.githubusercontent.com/svenger87/kinboard/main/install.sh | bash
#
# The one-file install (RFC-023 §4.9), from Kinboard 1.18 on:
#   curl -fsSL https://raw.githubusercontent.com/svenger87/kinboard/main/install.sh | bash -s -- --one-file
# downloads the release's compose.yml into ./kinboard and starts it: no git,
# no setup.sh, no Node and no secrets on the host (they create themselves on
# the first start). Options, each also an environment variable:
#   --one-file             KINBOARD_INSTALL_MODE=one-file   (--git: the git install, today's default)
#   --version X.Y.Z        KINBOARD_VERSION    that release's compose.yml, and its image
#   --port N               WEBAPP_PORT         the port families open (3001)
#   --data-dir PATH        KINBOARD_DATA_DIR   a host folder for the data, instead of
#                                              Docker volumes (the default)
# KINBOARD_DIR, KINBOARD_URL, KINBOARD_TAG and KINBOARD_IMAGE work as for the
# git install and compose.yml; KINBOARD_COMPOSE_URL fetches the file from
# elsewhere (a mirror, or file:// for a test). Update a one-file install with
#   cd kinboard && docker compose pull && docker compose up -d
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

# ---------------------------------------------------------------- options

INSTALL_MODE="${KINBOARD_INSTALL_MODE:-git}"
ONE_FILE_VERSION="${KINBOARD_VERSION:-}"
ONE_FILE_PORT="${WEBAPP_PORT:-}"
ONE_FILE_DATA_DIR="${KINBOARD_DATA_DIR:-}"
one_file_flags=()

option_value() {
  [[ $# -ge 2 && -n "$2" ]] || fail "$1 needs a value."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --one-file) INSTALL_MODE=one-file; shift ;;
    --git) INSTALL_MODE=git; shift ;;
    --version) option_value "$@"; ONE_FILE_VERSION="$2"; one_file_flags+=("$1"); shift 2 ;;
    --version=*) ONE_FILE_VERSION="${1#*=}"; one_file_flags+=("${1%%=*}"); shift ;;
    --port) option_value "$@"; ONE_FILE_PORT="$2"; one_file_flags+=("$1"); shift 2 ;;
    --port=*) ONE_FILE_PORT="${1#*=}"; one_file_flags+=("${1%%=*}"); shift ;;
    --data-dir) option_value "$@"; ONE_FILE_DATA_DIR="$2"; one_file_flags+=("$1"); shift 2 ;;
    --data-dir=*) ONE_FILE_DATA_DIR="${1#*=}"; one_file_flags+=("${1%%=*}"); shift ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" 2>/dev/null | sed 's/^# \{0,1\}//' \
        || echo "See https://github.com/svenger87/kinboard#install"
      exit 0
      ;;
    *) fail "unknown option '$1'. Run with --help to see the options." ;;
  esac
done

case "$INSTALL_MODE" in
  git|one-file) ;;
  *) fail "KINBOARD_INSTALL_MODE must be 'git' or 'one-file', not '$INSTALL_MODE'." ;;
esac

# The git install asks setup.sh for these, so a flag without --one-file is a
# mistake worth naming. (Only the flags: the environment variables keep
# meaning nothing to the git install, as before.)
if [[ "$INSTALL_MODE" != one-file && ${#one_file_flags[@]} -gt 0 ]]; then
  fail "${one_file_flags[0]} belongs to the one-file install. Add --one-file, or leave it out."
fi

# The refusal for an existing folder names the update command for the shape
# that is there, so nobody reinstalls to update.
refuse_existing() {
  local dir="$1"
  if [[ -f "$dir/webapp/docker/start.sh" ]]; then
    fail "$dir already exists. This installer never changes an existing installation. It is a git install; update it with:
  cd \"$dir\" && git pull && cd webapp/docker && ./start.sh up"
  elif [[ -f "$dir/compose.yml" ]]; then
    fail "$dir already exists. This installer never changes an existing installation. It is a one-file install; update it with:
  cd \"$dir\" && docker compose pull && docker compose up -d"
  else
    fail "$dir already exists. This installer never changes an existing installation. To install next to it, choose another folder with KINBOARD_DIR. To update an install there:
  git install:      cd \"$dir\" && git pull && cd webapp/docker && ./start.sh up
  one-file install: cd \"$dir\" && docker compose pull && docker compose up -d"
  fi
}

# ------------------------------------------------------- one-file install

# The first release whose image runs compose.yml (kinboard-init, #548).
ONE_FILE_MIN_MAJOR=1
ONE_FILE_MIN_MINOR=18
ONE_FILE_MIN="$ONE_FILE_MIN_MAJOR.$ONE_FILE_MIN_MINOR"

# 0 when $1 is a version (X.Y or X.Y.Z, with an optional v and suffix) older
# than 1.18; 1 when it is 1.18 or newer; 2 when it is not such a version
# (latest, next, main, sha-…, a bare major), which only the image can answer.
version_older_than_min() {
  local v="${1#v}"
  [[ "$v" =~ ^([0-9]+)\.([0-9]+)([.-].*)?$ ]] || return 2
  local major=$((10#${BASH_REMATCH[1]})) minor=$((10#${BASH_REMATCH[2]}))
  if (( major < ONE_FILE_MIN_MAJOR || (major == ONE_FILE_MIN_MAJOR && minor < ONE_FILE_MIN_MINOR) )); then
    return 0
  fi
  return 1
}

refuse_old() {
  fail "Kinboard $1 is older than $ONE_FILE_MIN, the first release with the one-file install (compose.yml). Install it without --one-file, or choose $ONE_FILE_MIN or newer."
}

ask() {
  # ask <prompt> -> the answer on stdout; empty without a terminal.
  local answer=""
  if [[ $has_terminal -eq 1 ]]; then
    printf '%s' "$1" >/dev/tty
    IFS= read -r answer </dev/tty || answer=""
  fi
  printf '%s' "$answer"
}

install_one_file() {
  local command
  for command in docker curl; do
    command -v "$command" >/dev/null 2>&1 \
      || fail "'$command' is required. Install it, then run this command again."
  done
  docker compose version >/dev/null 2>&1 \
    || fail "Docker Compose v2 is required ('docker compose')."

  if [[ -e "$INSTALL_DIR" ]]; then
    refuse_existing "$INSTALL_DIR"
  fi

  # compose.yml fixes its container and volume names (RFC-023 §4.6), so a
  # second Kinboard on this machine would fail on the name, or start on the
  # first one's data. Say so before anything is downloaded.
  local names running="" volumes=""
  names="$(docker ps -a --format '{{.Names}}' 2>/dev/null || true)"
  for name in kinboard-init kinboard-db kinboard-db-init kinboard-rest kinboard-webapp kinboard-go2rtc; do
    if grep -qx "$name" <<<"$names"; then running="$running $name"; fi
  done
  if [[ -n "$running" ]]; then
    fail "Kinboard already runs on this machine (found:$running). This installer never changes an existing installation. Update that one instead:
  git install:      cd <its folder> && git pull && cd webapp/docker && ./start.sh up
  one-file install: cd <its folder> && docker compose pull && docker compose up -d"
  fi

  has_terminal=0
  if [[ -t 1 ]] && [[ -r /dev/tty ]] && [[ -w /dev/tty ]]; then
    has_terminal=1
  fi

  # The release: the newest, or the one asked for.
  local version="${ONE_FILE_VERSION#v}" compose_url tag_default=""
  if [[ -n "$version" ]]; then
    local vrc=0
    version_older_than_min "$version" || vrc=$?
    if [[ $vrc -eq 0 ]]; then refuse_old "$version"; fi
    [[ $vrc -ne 2 ]] || fail "--version wants a release number such as $ONE_FILE_MIN.0, not '$ONE_FILE_VERSION'."
    compose_url="https://github.com/svenger87/kinboard/releases/download/v$version/compose.yml"
    tag_default="$version"
  else
    compose_url="https://github.com/svenger87/kinboard/releases/latest/download/compose.yml"
  fi
  compose_url="${KINBOARD_COMPOSE_URL:-$compose_url}"

  # A tag set by hand that is plainly too old is refused before any download.
  local tag="${KINBOARD_TAG:-$tag_default}"
  if [[ -n "$tag" ]]; then
    local rc=0
    version_older_than_min "$tag" || rc=$?
    if [[ $rc -eq 0 ]]; then refuse_old "$tag"; fi
  fi

  # The questions the RFC lists, and no more: the port and where the data lives.
  local port="$ONE_FILE_PORT" data_dir="$ONE_FILE_DATA_DIR"
  if [[ -z "$port" ]]; then
    port="$(ask "Port for Kinboard [3001]: ")"
    port="${port:-3001}"
  fi
  if ! [[ "$port" =~ ^[0-9]{1,5}$ ]] || (( 10#$port < 1 || 10#$port > 65535 )); then
    fail "the port must be a number from 1 to 65535, not '$port'."
  fi
  port=$((10#$port))
  if [[ -z "$ONE_FILE_DATA_DIR" ]]; then
    data_dir="$(ask "Where should Kinboard keep its data? Enter for Docker volumes (kinboard-db, kinboard-storage, kinboard-config), or a folder: ")"
  fi
  if [[ -n "$data_dir" ]]; then
    case "$data_dir" in
      \~) data_dir="$HOME" ;;
      \~/*) data_dir="$HOME/${data_dir#\~/}" ;;
      /*) ;;
      *) data_dir="$PWD/$data_dir" ;;
    esac
    data_dir="${data_dir%/}"
    [[ -n "$data_dir" ]] || fail "the data folder can't be / itself."
    local sub
    for sub in db storage config; do
      if [[ -e "$data_dir/$sub" ]] && [[ -n "$(ls -A "$data_dir/$sub" 2>/dev/null || echo x)" ]]; then
        fail "$data_dir/$sub already holds data. This installer never changes an existing installation. Choose an empty folder."
      fi
    done
  else
    local existing
    existing="$(docker volume ls -q 2>/dev/null || true)"
    for name in kinboard-db kinboard-storage kinboard-config; do
      if grep -qx "$name" <<<"$existing"; then volumes="$volumes $name"; fi
    done
    if [[ -n "$volumes" ]]; then
      fail "the Docker volume(s)$volumes already exist: an earlier Kinboard's data and secrets. This installer never changes an existing installation. To start that install again, put its compose.yml in a folder and run 'docker compose up -d' there. To install with a folder instead, use --data-dir. Removing the volumes deletes that data for good."
    fi
  fi

  # Everything happens in a staging folder next to the target, which becomes
  # the install only once every check passed: a refusal leaves nothing behind.
  local parent staging
  parent="$(dirname "$INSTALL_DIR")"
  mkdir -p "$parent" || fail "can't create $parent."
  staging="$(mktemp -d "$parent/.kinboard-install.XXXXXX")" || fail "can't write to $parent."
  # shellcheck disable=SC2064  # the path is fixed now, on purpose
  trap "rm -rf '$staging'" EXIT

  echo "Downloading compose.yml from $compose_url"
  if ! curl -fsSL --retry 2 -o "$staging/compose.yml" "$compose_url"; then
    if [[ -n "$version" ]]; then
      fail "couldn't download compose.yml for Kinboard $version ($compose_url). Check the version number: the file exists for $ONE_FILE_MIN and newer."
    fi
    fail "couldn't download compose.yml ($compose_url). The one-file install needs Kinboard $ONE_FILE_MIN or newer; if the newest release is older, install without --one-file."
  fi

  # The image the file runs, from its one x-kinboard-image line (#555).
  local image_line image_repo image_tag image
  image_line="$(grep -E '^x-kinboard-image: &kinboard-image ' "$staging/compose.yml" | head -n1 || true)"
  [[ "$image_line" =~ \$\{KINBOARD_IMAGE:-([^}]+)\}:\$\{KINBOARD_TAG:-([^}]+)\} ]] \
    || fail "$compose_url is not Kinboard's compose.yml (no x-kinboard-image line)."
  image_repo="${KINBOARD_IMAGE:-${BASH_REMATCH[1]}}"
  image_tag="${KINBOARD_TAG:-${tag_default:-${BASH_REMATCH[2]}}}"
  image="$image_repo:$image_tag"

  # The variables the file reads, and nothing secret: those create themselves.
  {
    echo "# Written by install.sh. Every line is optional; compose.yml explains them."
    echo "WEBAPP_PORT=$port"
    if [[ -n "$tag_default" || -n "${KINBOARD_TAG:-}" ]]; then
      echo "# Remove KINBOARD_TAG to follow the newest release with Pull, then Up."
      echo "KINBOARD_TAG=$image_tag"
    fi
    if [[ -n "${KINBOARD_IMAGE:-}" ]]; then echo "KINBOARD_IMAGE=$KINBOARD_IMAGE"; fi
    if [[ -n "${KINBOARD_URL:-}" ]]; then echo "SITE_URL=$KINBOARD_URL"; fi
    if [[ -n "$data_dir" ]]; then
      echo "KINBOARD_DB_DIR=$data_dir/db"
      echo "KINBOARD_STORAGE_DIR=$data_dir/storage"
      echo "KINBOARD_CONFIG_DIR=$data_dir/config"
    fi
  } >"$staging/.env"

  echo "Pulling the images (Kinboard: $image)"
  (cd "$staging" && docker compose -p kinboard-install pull) \
    || fail "couldn't pull the images. Check the network, and that $image exists."

  # The image itself has the last word: its version label, then whether it
  # carries kinboard-init at all (a main or sha- build has no version number).
  local label rc=0
  label="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image" 2>/dev/null || true)"
  version_older_than_min "$label" || rc=$?
  if [[ $rc -eq 0 ]]; then refuse_old "$label (image $image)"; fi
  docker run --rm --entrypoint /bin/sh "$image" -c 'test -x /usr/local/bin/kinboard-init' >/dev/null 2>&1 \
    || refuse_old "in $image"

  if [[ -n "$data_dir" ]]; then
    mkdir -p "$data_dir" || fail "can't create $data_dir."
  fi
  mv "$staging" "$INSTALL_DIR" || fail "can't create $INSTALL_DIR."
  trap - EXIT
  chmod 755 "$INSTALL_DIR"

  echo "Installing Kinboard in $INSTALL_DIR"
  if ! (cd "$INSTALL_DIR" && docker compose up -d); then
    (cd "$INSTALL_DIR" && docker compose logs --no-color --tail 20 init db-init 2>/dev/null) >&2 || true
    fail "the stack did not start; the lines above say why. The install is in $INSTALL_DIR: fix the cause, then run 'docker compose up -d' there."
  fi

  local timeout="${KINBOARD_HEALTH_TIMEOUT:-300}" waited=0
  echo "Waiting for Kinboard to answer (up to ${timeout}s)"
  until curl -fsS -o /dev/null --max-time 5 "http://localhost:$port/api/health" 2>/dev/null; do
    if (( waited >= timeout )); then
      (cd "$INSTALL_DIR" && docker compose ps -a) >&2 || true
      fail "Kinboard did not answer on port $port within ${timeout}s. See 'docker compose logs webapp' in $INSTALL_DIR."
    fi
    sleep 3
    waited=$((waited + 3))
  done

  local address="${KINBOARD_URL:-}" lan=""
  if [[ -z "$address" ]]; then
    lan="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
    address="http://${lan:-localhost}:$port"
  fi
  echo
  echo "Kinboard is ready: $address"
  echo "Open it in a browser and create your family; that first page is the whole setup."
  echo "Installation directory: $INSTALL_DIR (compose.yml and its .env)"
  if [[ -n "$data_dir" ]]; then
    echo "Your data and secrets: $data_dir (db, storage, config). Back up all three and keep the backups private."
  else
    echo "Your data and secrets: the Docker volumes kinboard-db, kinboard-storage and kinboard-config. Back up all three and keep the backups private."
  fi
  echo "Update: cd \"$INSTALL_DIR\" && docker compose pull && docker compose up -d"
}

if [[ "$INSTALL_MODE" == one-file ]]; then
  install_one_file
  exit 0
fi

# ------------------------------------------------------------ git install

for command in git docker openssl; do
  command -v "$command" >/dev/null 2>&1 \
    || fail "'$command' is required. Install it, then run this command again."
done

docker compose version >/dev/null 2>&1 \
  || fail "Docker Compose v2 is required ('docker compose')."

if [[ -e "$INSTALL_DIR" ]]; then
  refuse_existing "$INSTALL_DIR"
fi

# A pipe consumes stdin, so setup.sh cannot use its normal terminal detection.
# Reattach it to the terminal for the optional integration prompts. Headless
# runs need nothing: every device reaches the API at the address it opened
# Kinboard from (RFC-018). KINBOARD_URL, when set, names that address for
# links handed to other apps.
has_terminal=0
if [[ -t 1 ]] && [[ -r /dev/tty ]] && [[ -w /dev/tty ]]; then
  has_terminal=1
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
  ./start.sh up
)

site_url=$(grep -E '^SITE_URL=' "$INSTALL_DIR/webapp/docker/.env" | head -n1 | cut -d= -f2-)
echo
echo "Kinboard is ready: ${site_url:-http://localhost:3001}"
echo "Installation directory: $INSTALL_DIR"
echo "Keep that directory: it contains your configuration and upgrade tools."
