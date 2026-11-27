#!/usr/bin/env bash
# aio-smoke.sh: the all-in-one image builds and starts on one platform.
#
#   scripts/ci/aio-smoke.sh linux/arm64
#
# Builds webapp/docker/aio/Dockerfile for that platform FROM a published
# webapp image (APP_IMAGE, default ghcr.io/svenger87/kinboard:main, the same
# platform's variant), so it needs no webapp build: what it checks is the
# all-in-one layer, the part that differs per architecture (PostgreSQL and s6
# from Alpine, safeupdate built here, PostgREST from its pinned image). The
# build runs `postgrest --version`; then the container starts on an empty
# /data and must answer /api/health with db:true, with PostgREST listening on
# 127.0.0.1:3010 only.
#
# The PR-side arm64 check in ci.yml. scripts/rigs/test-aio.sh is the full rig
# (amd64 on PRs, arm64 weekly); this is the part that failed only on arm64
# (#569's PostgREST, 127 at `--version`) and that amd64 cannot see.
#
#   APP_IMAGE=<image>     the webapp image to build FROM
#   SMOKE_TIMEOUT=600     seconds to wait for /api/health (QEMU is slow)
#   SMOKE_PORT=3079       the loopback port the webapp is published on
#   KEEP_FAILED=1         leave the container up after a failure
#
# Names: image kbaio-smoke:<arch>, container kbaio-smoke, volume
# kbaio-smoke-data. Removes all three when it ends.

set -uo pipefail

PLATFORM="${1:?usage: aio-smoke.sh <platform, e.g. linux/arm64>}"
ARCH="${PLATFORM#*/}"; ARCH="${ARCH//\//-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_IMAGE="${APP_IMAGE:-ghcr.io/svenger87/kinboard:main}"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-600}"
SMOKE_PORT="${SMOKE_PORT:-3079}"
IMAGE="kbaio-smoke:$ARCH" NAME=kbaio-smoke VOL=kbaio-smoke-data

cleanup() {
  local rc=$?
  if [ "$rc" != 0 ] && [ "${KEEP_FAILED:-0}" = 1 ]; then echo "left up: $NAME, $VOL, $IMAGE"; return; fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  docker rmi "$IMAGE" >/dev/null 2>&1 || true
}
fail() { echo "FAIL: $*" >&2; docker logs "$NAME" 2>&1 | tail -60 >&2 || true; exit 1; }

if docker ps -a --format '{{.Names}}' | grep -qx "$NAME" || docker volume ls -q | grep -qx "$VOL"; then
  echo "refusing: $NAME or $VOL already exists" >&2; exit 2
fi
trap cleanup EXIT

echo "== build for $PLATFORM FROM $APP_IMAGE"
docker buildx build --platform "$PLATFORM" --progress=plain --load \
  --build-arg APP_IMAGE="$APP_IMAGE" --build-arg BUILD_REVISION=smoke \
  -f "$REPO_ROOT/webapp/docker/aio/Dockerfile" -t "$IMAGE" "$REPO_ROOT/webapp/docker/aio" \
  || fail "the image did not build for $PLATFORM"

arch="$(docker image inspect -f '{{.Architecture}}' "$IMAGE")"
[ "$arch" = "${ARCH%%-*}" ] || fail "built $arch, wanted $ARCH"
docker run --rm --platform "$PLATFORM" --entrypoint /usr/local/bin/postgrest "$IMAGE" --version \
  || fail "postgrest does not run in the image"

echo "== start on an empty /data, wait up to ${SMOKE_TIMEOUT}s for /api/health"
docker run -d --name "$NAME" --platform "$PLATFORM" -p "127.0.0.1:$SMOKE_PORT:3000" -v "$VOL:/data" "$IMAGE" >/dev/null \
  || fail "the container did not start"
start=$SECONDS health=""
while [ $((SECONDS - start)) -lt "$SMOKE_TIMEOUT" ]; do
  [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = true ] || fail "the container stopped"
  health="$(curl -s -m 5 "http://127.0.0.1:$SMOKE_PORT/api/health" || true)"
  case "$health" in *'"db":true'*) break ;; esac
  sleep 5
done
case "$health" in *'"db":true'*) echo "healthy after $((SECONDS - start))s: $health" ;; *) fail "no healthy /api/health within ${SMOKE_TIMEOUT}s (last: ${health:-nothing})" ;; esac

listen="$(docker exec "$NAME" netstat -ltn | awk '$4 ~ /:3010$/ { print $4 }')"
[ "$listen" = "127.0.0.1:3010" ] || fail "PostgREST listens on '${listen:-nothing}', want 127.0.0.1:3010 only"
code="$(docker exec "$NAME" curl -s -o /dev/null -w '%{http_code}' -m 30 http://127.0.0.1:3010/families)"
[ "$code" = 200 ] || fail "PostgREST /families answered $code"
code="$(curl -s -o /dev/null -w '%{http_code}' -m 30 "http://127.0.0.1:$SMOKE_PORT/rest/v1/families")"
[ "$code" = 200 ] || fail "the webapp's /rest/v1/families answered $code"
echo "PostgREST on 127.0.0.1:3010 only, /families 200 straight and through the webapp"

echo "OK: kinboard-aio builds and starts on $PLATFORM"
