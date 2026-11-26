#!/bin/sh
# cron-call.sh <route>: what every scheduled job runs (`docker exec`, from
# ofelia's labels): POST /api/cron/<route> with the cron secret.
#
# The secret: $CRON_SECRET from the container's configured environment, as
# always; when that is empty, the secrets store's cron_secret, by the same
# rules the entrypoint uses (secrets-store.mjs --get). `docker exec` never
# sees the entrypoint's exports, so on a stack whose secret lives only in the
# store (RFC-023 §4.1) every job would otherwise send an empty token and be
# refused with 401.
set -eu

route="${1:?usage: cron-call.sh <route>}"
secret="${CRON_SECRET:-}"
if [ -z "$secret" ]; then
  secret="$(node "${KINBOARD_SECRETS_READER:-/app/secrets-store.mjs}" --get CRON_SECRET)" || {
    echo "cron-call: no CRON_SECRET in the environment or the secrets store; not calling $route" >&2
    exit 1
  }
fi
exec curl -sS -X POST -H "Authorization: Bearer $secret" "${KINBOARD_CRON_BASE:-http://localhost:3000}/api/cron/$route"
