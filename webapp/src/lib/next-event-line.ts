/**
 * The idle screen's line under the clock in the hour before an event
 * (RFC-021 §3.2): "Football in 35 minutes!" for a child's event, "Dentist in
 * 35 min." for anyone else's, nothing otherwise. Pure, so the fast suite can
 * hold it to the minute.
 */

export interface NextEventCandidate {
  title: string;
  start: Date;
  allDay: boolean;
  /** The event's person, or the person its calendar belongs to. */
  personId: string | null;
}

export interface NextEventLine {
  title: string;
  /** Whole minutes to go, rounded up: 34 min 10 s is "35". At least 1. */
  minutes: number;
  /** A child's event speaks to the child; anyone else's, and no one's, stays short (§8.1). */
  child: boolean;
}

/** The line shows in the 60 minutes before a start, and goes at the start. */
export const NEXT_EVENT_WINDOW_MS = 60 * 60_000;

/**
 * The next event that starts at a time (not all-day) within the hour, the
 * earliest first; on a tie, the first in the list.
 */
export function nextEventLine(
  events: ReadonlyArray<NextEventCandidate>,
  now: Date,
  people: ReadonlyArray<{ id: string; is_child?: boolean | null }>,
): NextEventLine | null {
  const at = now.getTime();
  let next: NextEventCandidate | null = null;
  for (const e of events) {
    if (e.allDay) continue;
    const left = e.start.getTime() - at;
    if (!(left > 0 && left <= NEXT_EVENT_WINDOW_MS)) continue;
    if (!next || e.start.getTime() < next.start.getTime()) next = e;
  }
  if (!next) return null;
  const person = next.personId ? people.find((p) => p.id === next!.personId) : undefined;
  return {
    title: next.title,
    minutes: Math.max(1, Math.ceil((next.start.getTime() - at) / 60_000)),
    child: person?.is_child === true,
  };
}
