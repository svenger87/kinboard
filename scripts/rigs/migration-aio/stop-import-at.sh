#!/bin/sh
# stop-import-at.sh <stage>: runs INSIDE an all-in-one container (docker exec,
# as root) while `kinboard import` runs there. Waits until the import reaches
# <stage>, then freezes it (SIGSTOP), so the rig can SIGKILL the container at
# exactly that point:
#   files    staging the uploaded files (some written, not all)
#   secrets  a secret replaced, the database not started
#   db       the database transaction open (COPY running)
# Prints what it saw; exits 1 if the import ended first.
stage="$1"
pid() { pgrep -f 'kinboard-transfer.mjs import' | head -n 1; }
i=0
while :; do
  p="$(pid)"
  [ -n "$p" ] || { i=$((i + 1)); [ "$i" -gt 20000 ] && { echo "no import running"; exit 1; }; continue; }
  case "$stage" in
    files)   n="$(find /data/storage/files -path '*/.kinboard-import-*' -type f 2>/dev/null | wc -l)"; [ "$n" -ge 20 ] && break ;;
    # Two recorded: the first of them is written for certain (recorded, then written).
    secrets) [ "$(grep -o '"file"' /data/config/secrets/.kinboard-import-pending.json 2>/dev/null | wc -l)" -ge 2 ] && break ;;
    db)      pgrep -x psql >/dev/null && psql -X -U supabase_admin -d postgres -tAc "SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND query ILIKE 'COPY %'" 2>/dev/null | grep -q 1 && break ;;
    *) echo "unknown stage $stage"; exit 2 ;;
  esac
  kill -0 "$p" 2>/dev/null || { echo "the import ended before $stage"; exit 1; }
done
kill -STOP "$p"
echo "stopped the import at $stage (pid $p)"
