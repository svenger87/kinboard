/**
 * Whether a calendar sync has anything to write for an event it already has.
 *
 * Every sync (Google, ICS, CalDAV) builds the full row for each event it sees
 * and used to write it unconditionally, with a fresh `updated_at`. Google's
 * cron alone did that to every event of every subscribed calendar every 15
 * minutes — 362 rows on the household's install, each one a new row version
 * for Postgres to vacuum and, since 1.15, a change notification to every open
 * screen. One sync made a single Home screen fire 1,494 requests in twenty
 * seconds (1,460 of them for the calendar), which a small kiosk PC never
 * caught up with: the widgets sat on "loading" until somebody changed page.
 *
 * So a sync now compares first and writes only rows that differ. `updated_at`
 * is not compared — it is what the write sets, not what the event says.
 */

/** The columns to read back for comparison: `id` plus everything the sync writes. */
export function syncedColumns(next: Record<string, unknown>): string {
  return ["id", ...Object.keys(next).filter((k) => k !== "updated_at")].join(", ");
}

/**
 * True when writing `next` would change the stored row.
 *
 * Timestamps compare by instant: Postgres returns `2026-11-03T08:00:00+00:00`
 * for what the sync wrote as `2026-11-03T08:00:00.000Z`. A missing value and
 * null are the same; the database has no undefined.
 */
export function eventRowChanged(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(next)) {
    if (key === "updated_at") continue;
    const stored = existing[key] ?? null;
    const incoming = value ?? null;
    if (stored === incoming) continue;
    if (key.endsWith("_at") && typeof stored === "string" && typeof incoming === "string") {
      const a = Date.parse(stored);
      const b = Date.parse(incoming);
      if (!Number.isNaN(a) && a === b) continue;
    }
    return true;
  }
  return false;
}
