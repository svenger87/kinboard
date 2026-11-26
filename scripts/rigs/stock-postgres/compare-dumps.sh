#!/usr/bin/env bash
# compare-dumps.sh <left dump> <right dump> <expected differences>
#
# Fails unless every line that differs between the two sorted security dumps
# is allowed by a line of the expected-differences file, and every line of
# that file allows at least one difference (RFC-024 §6.5). Prints what failed.
set -uo pipefail
left="$1"; right="$2"; expected="$3"
for f in "$left" "$right" "$expected"; do [ -s "$f" ] || { echo "compare-dumps: $f is missing or empty" >&2; exit 2; }; done
# A complete dump of a migrated database, on both sides: the end marker, and
# at least this many lines of each kind. Two dumps that both stopped early,
# or both found nothing, would otherwise compare equal.
for f in "$left" "$right"; do
  grep -qx 'end-of-dump' "$f" || { echo "compare-dumps: $f has no end-of-dump line: the dump stopped early" >&2; exit 2; }
  for want in policy:50 rls:50 relacl:500 procacl:50 role:6 member:9 setting:6 defacl:30 nspacl:4 publication-table:20; do
    kind="${want%%:*}" min="${want##*:}"
    n="$(grep -c "^$kind|" "$f" || true)"
    [ "$n" -ge "$min" ] || { echo "compare-dumps: $f has $n '$kind' lines, fewer than $min: not a migrated database" >&2; exit 2; }
  done
done

diffs="$(diff <(LC_ALL=C sort "$left") <(LC_ALL=C sort "$right") | grep -E '^[<>] ' || true)"
rules="$(grep -vE '^[[:space:]]*(#|$)' "$expected")"

status=0
unexplained=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  dir="${line:0:1}"; text="${line:2}"; ok=0
  while IFS= read -r rule; do
    [ "${rule:0:1}" = "$dir" ] || continue
    if grep -qE -- "${rule:2}" <<<"$text"; then ok=1; break; fi
  done <<<"$rules"
  if [ "$ok" = 0 ]; then
    [ "$unexplained" = 0 ] && echo "differences no line of $(basename "$expected") allows:"
    echo "  $line"
    unexplained=$((unexplained + 1)); status=1
  fi
done <<<"$diffs"

while IFS= read -r rule; do
  [ -n "$rule" ] || continue
  dir="${rule:0:1}"
  if ! grep -E '^[<>] ' <<<"$diffs" | grep "^$dir " | cut -c3- | grep -qE -- "${rule:2}"; then
    echo "an expected difference that no longer occurs (remove it): $rule"; status=1
  fi
done <<<"$rules"

total="$(grep -c . <<<"$diffs" || true)"
echo "compare-dumps: $(wc -l <"$left") vs $(wc -l <"$right") lines; $total differ, $unexplained unexplained"
exit "$status"
