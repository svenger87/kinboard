/**
 * Validation and normalisation for `POST /api/integration/v1/calendar/events`.
 *
 * All-day events take plain dates, not timestamps. The app stores an all-day
 * event as local midnight of the first day to local 23:59:59.999 of the last
 * (`calendar/page.tsx`, `startOfDay`/`endOfDay`), and the month view treats
 * `end_at` as inclusive. Accepting an exclusive midnight end — what Google and
 * iCalendar use — put a one-day event on two days, and accepting timestamps at
 * all let a client send UTC midnight for a Berlin family, which is 02:00 local
 * and spread a CalDAV copy over two days as well. A date has no zone to get
 * wrong; the family's zone turns it into the app's own convention here.
 */

/** Same bound as the read window: longer is a mistake, not an event. */
export const MAX_EVENT_DAYS = 370;

export interface EventInput {
  calendarId: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  /** Provider dates for an all-day event: first day and the exclusive end. */
  allDayDates?: { start: string; endExclusive: string };
  description?: string;
  location?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date as UTC day number, or null for `2026-02-30`. */
function dayNumber(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = DATE_ONLY.exec(value);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return ms / 86_400_000;
}

function dateFromDayNumber(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** Offset of `timeZone` from UTC at `instantMs`, in milliseconds. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The UTC instant of a wall-clock time on a day in `timeZone`, resolved the
 * way a browser's `Date` resolves it, since the calendar page's own all-day
 * events come from `startOfDay`/`endOfDay` in the browser:
 *
 * - A wall time that happens twice (clocks going back) is the **earlier**
 *   instant. Beirut repeats 23:00–24:00 on its last October Saturday.
 * - A wall time that never happens (clocks going forward) moves **forward**
 *   to the first instant that does. Chile skips 00:00 on its first September
 *   Sunday, so that day starts at 01:00.
 *
 * Every offset the zone uses around the wall time is tried, rather than
 * correcting one guess, because a single correction gets one of those two
 * cases wrong in one hemisphere or the other.
 */
export function zonedWallTimeToUtc(day: number, msIntoDay: number, timeZone: string): Date {
  const wall = day * 86_400_000 + msIntoDay;
  const offsets = new Set([-86_400_000, 0, 86_400_000].map((d) => zoneOffsetMs(wall + d, timeZone)));
  const candidates = [...offsets].map((o) => wall - o);
  const real = candidates.filter((u) => u + zoneOffsetMs(u, timeZone) === wall);
  return new Date(real.length > 0 ? Math.min(...real) : Math.max(...candidates));
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export type EventInputResult = { ok: true; value: EventInput } | { ok: false; error: string };

export function parseEventInput(body: Record<string, unknown>, timeZone: string): EventInputResult {
  const fail = (error: string): EventInputResult => ({ ok: false, error });

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 300) return fail("`title` is required and at most 300 characters");
  const calendarId = typeof body.calendar_id === "string" ? body.calendar_id : "";
  if (!UUID.test(calendarId)) return fail("`calendar_id` must be a calendar ID");
  if (body.all_day !== undefined && typeof body.all_day !== "boolean") return fail("`all_day` must be a boolean");
  if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 2000)) {
    return fail("`description` must be a string of at most 2000 characters");
  }
  if (body.location !== undefined && (typeof body.location !== "string" || body.location.length > 300)) {
    return fail("`location` must be a string of at most 300 characters");
  }
  const extras = {
    ...(typeof body.description === "string" ? { description: body.description.trim() } : {}),
    ...(typeof body.location === "string" ? { location: body.location.trim() } : {}),
  };

  if (body.all_day === true) {
    if (body.start_at !== undefined || body.end_at !== undefined) {
      return fail("an all-day event takes `start_date` and `end_date`, not timestamps");
    }
    const first = dayNumber(body.start_date);
    const last = dayNumber(body.end_date ?? body.start_date);
    if (first === null || last === null) return fail("`start_date` and `end_date` must be YYYY-MM-DD dates");
    if (last < first) return fail("`end_date` must not be before `start_date`");
    if (last - first + 1 > MAX_EVENT_DAYS) return fail(`an event may not exceed ${MAX_EVENT_DAYS} days`);
    return {
      ok: true,
      value: {
        calendarId, title, allDay: true, ...extras,
        startAt: zonedWallTimeToUtc(first, 0, timeZone).toISOString(),
        endAt: zonedWallTimeToUtc(last, 86_400_000 - 1, timeZone).toISOString(),
        allDayDates: { start: dateFromDayNumber(first), endExclusive: dateFromDayNumber(last + 1) },
      },
    };
  }

  if (body.start_date !== undefined || body.end_date !== undefined) {
    return fail("`start_date` and `end_date` are only for all-day events");
  }
  const startRaw = typeof body.start_at === "string" ? body.start_at : "";
  const endRaw = typeof body.end_at === "string" ? body.end_at : "";
  if (!ISO_WITH_OFFSET.test(startRaw) || !ISO_WITH_OFFSET.test(endRaw)) {
    return fail("`start_at` and `end_at` must be ISO 8601 timestamps with `Z` or a `+HH:MM` offset");
  }
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return fail("`start_at` or `end_at` is not a real time");
  if (end <= start) return fail("`end_at` must be after `start_at`");
  if (end.getTime() - start.getTime() > MAX_EVENT_DAYS * 86_400_000) return fail(`an event may not exceed ${MAX_EVENT_DAYS} days`);
  return {
    ok: true,
    value: { calendarId, title, allDay: false, ...extras, startAt: start.toISOString(), endAt: end.toISOString() },
  };
}
