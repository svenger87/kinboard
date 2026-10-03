/**
 * Does the copy of a row this device keeps in its persisted store differ from
 * the row the database just returned?
 *
 * The family store (`family-calendar-storage`) is written when a device signs
 * in and then lives for as long as the session does. Anything that ever wrote
 * a partial row into it — `/api/session/resume` answering with
 * `families(id, name)` until #271 is the known case — left that device without
 * the missing columns indefinitely: Settings drew the family card with a blank
 * where the code belongs, and a wall panel lost `is_kiosk`.
 *
 * The periodic checks re-read the whole row and write it back when this says
 * so. It is a shallow compare over the fresh row's columns, so a column the
 * stored copy is missing counts as a difference, and so does a column the
 * fresh row no longer has. Array and json columns (`fingerprint_history`) are
 * compared by value: by reference they differ on every read, which would
 * rewrite the store — and the cookie it persists to — on every check.
 *
 * `ignore` names columns whose drift is not worth a write (the heartbeat's own
 * `last_seen`).
 */
export function storedRowIsStale(
  stored: object | null | undefined,
  fresh: object,
  ignore: readonly string[] = [],
): boolean {
  if (!stored) return true;
  const a = stored as Record<string, unknown>;
  const b = fresh as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (ignore.includes(key)) continue;
    if (!(key in a) || !(key in b)) return true;
    const x = a[key];
    const y = b[key];
    if (x === y) continue;
    if (x !== null && y !== null && typeof x === "object" && typeof y === "object") {
      if (JSON.stringify(x) === JSON.stringify(y)) continue;
    }
    return true;
  }
  return false;
}
