/**
 * Working out which local events Google no longer has.
 *
 * The sync only ever deleted an event when Google handed back a tombstone —
 * an entry with `status: "cancelled"`. That is what an incremental sync
 * returns, but this sync is a full list every time, and a full list mostly
 * just *omits* what was deleted: Google keeps tombstones for a while and then
 * drops them. So an event deleted upstream quietly stayed on the board for
 * ever. Measured on a live instance: 435 events locally against 434 returned,
 * the surplus deleted on Google two days earlier and still showing.
 *
 * Reconciling the other way round — anything local that the feed did not
 * mention is gone — is the only way to catch those. It is also the dangerous
 * direction, because "the feed did not mention it" is indistinguishable from
 * "we failed to read the feed". Hence `prunableCalendars`: a calendar earns
 * the right to have its events deleted only by having been read completely.
 */

export interface LocalGoogleEvent {
  id: string;
  google_event_id: string | null;
}

export interface CalendarFetch {
  /** The local calendars row id. */
  calendarId: string;
  /** Google event ids seen for this calendar in this run. */
  seen: Set<string>;
  /**
   * Every page was read and none of the requests threw.
   *
   * False means the list is partial — a network error, or a `nextPageToken`
   * that was never followed. A partial list looks exactly like a pile of
   * deletions, so it must never drive one.
   */
  complete: boolean;
}

/**
 * Local events on this calendar that the feed no longer contains.
 *
 * Events with no `google_event_id` are the family's own, created in Kinboard,
 * and are never Google's to remove.
 */
export function orphanedEventIds(
  local: LocalGoogleEvent[],
  seen: Set<string>,
): string[] {
  return local
    .filter((e) => e.google_event_id !== null && !seen.has(e.google_event_id))
    .map((e) => e.id);
}

/** The calendars whose reads finished, and so may be reconciled. */
export function prunableCalendars(fetches: CalendarFetch[]): CalendarFetch[] {
  return fetches.filter((f) => f.complete);
}
