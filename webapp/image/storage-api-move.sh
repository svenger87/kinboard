#!/bin/sh
# storage-api-move.sh: moves uploaded files out of storage-api's old layout
# (1.15), for webapp-entrypoint.sh's migrate_files.
#
#   storage-api-move.sh <FILES_DIR> <legacy folder> < objects
#
# stdin: one "<bucket>\t<name>\t<version>" line per storage.objects row.
# stdout: one line, "<moved> <present> <missing>". Reasons for skips on stderr.
#
# Run AS THE SERVER'S USER, never as root (su-exec from the entrypoint): it
# can then reach nothing that user could not read already, whatever a link in
# either tree points at. On top of that, every source is resolved with
# realpath and must lie inside <legacy>/stub and belong to this user, and no
# part of a destination path may be a link: a file is hard-linked (no copy,
# no extra space) or, where that is impossible, copied.
set -u

files="$1"
legacy="$2"
tab="$(printf '\t')"
me="$(id -u)"
moved=0; present=0; missing=0

if [ -L "$legacy/stub" ] || [ ! -d "$legacy/stub" ]; then
  echo "[entrypoint] $legacy/stub is not a plain folder; no uploaded files moved" >&2
  echo "0 0 0"
  exit 0
fi
root_real="$(realpath "$legacy")/stub"

while IFS="$tab" read -r bucket name version; do
  [ -n "$bucket" ] && [ -n "$name" ] || continue
  case "/$bucket/$name/" in
    */../* | */./* | *//*) echo "[entrypoint] skipping object with an unsafe name: $bucket/$name" >&2; continue ;;
  esac
  case "$version" in
    */* | . | ..) echo "[entrypoint] skipping object with an unsafe version: $bucket/$name" >&2; continue ;;
  esac
  dst="$files/$bucket/$name"
  if [ -e "$dst" ] || [ -L "$dst" ]; then present=$((present + 1)); continue; fi

  # No part of the destination may be a link.
  linked=""
  p="$files"
  rest="$bucket/$name"
  while [ -n "$rest" ]; do
    part="${rest%%/*}"
    if [ "$part" = "$rest" ]; then rest=""; else rest="${rest#*/}"; fi
    p="$p/$part"
    if [ -L "$p" ]; then linked="$p"; break; fi
  done
  if [ -n "$linked" ]; then
    echo "[entrypoint] skipping $bucket/$name: $linked is a symlink" >&2
    continue
  fi

  src=""
  for candidate in "$legacy/stub/stub/$bucket/$name/$version" "$legacy/stub/$bucket/$name/$version" \
                   "$legacy/stub/stub/$bucket/$name" "$legacy/stub/$bucket/$name"; do
    [ -f "$candidate" ] || continue
    real="$(realpath "$candidate" 2>/dev/null)" || continue
    case "$real" in
      "$root_real"/*) ;;
      *) echo "[entrypoint] skipping $bucket/$name: $candidate leads outside $legacy/stub ($real)" >&2; continue ;;
    esac
    if [ "$(stat -c %u "$real")" != "$me" ]; then
      echo "[entrypoint] skipping $bucket/$name: $real does not belong to the server's user" >&2
      continue
    fi
    src="$real"
    break
  done
  if [ -z "$src" ]; then
    echo "[entrypoint] storage object has no file on disk, skipped: $bucket/$name" >&2
    missing=$((missing + 1))
    continue
  fi
  mkdir -p "$(dirname "$dst")" || continue
  ln "$src" "$dst" 2>/dev/null || cp -p "$src" "$dst" || continue
  moved=$((moved + 1))
done

echo "$moved $present $missing"
