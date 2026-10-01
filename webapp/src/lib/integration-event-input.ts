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
  /**
   * Who the event is for; null for nobody. Only its shape is checked here —
   * the route checks it names a person of the family (`familyPersonId`).
   */
  personId?: string | null;
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

/** The same words `familyPersonId` uses for a malformed id. */
const PERSON_ID_ERROR = "`person_id` must be a uuid or null";
function isPersonIdShape(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && UUID.test(value));
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
  if (body.person_id !== undefined && !isPersonIdShape(body.person_id)) return fail(PERSON_ID_ERROR);
  const extras = {
    ...(typeof body.description === "string" ? { description: body.description.trim() } : {}),
    ...(typeof body.location === "string" ? { location: body.location.trim() } : {}),
    ...(body.person_id !== undefined ? { personId: body.person_id as string | null } : {}),
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

/**
 * The stored event a patch applies to — only what the time rules need.
 */
export interface StoredEventTimes {
  start_at: string;
  end_at: string;
  all_day: boolean;
}

/** Columns a PATCH may write; only the keys the caller sent are present. */
export interface EventPatchColumns {
  title?: string;
  description?: string | null;
  location?: string | null;
  start_at?: string;
  end_at?: string;
  all_day?: boolean;
  /** Shape-checked only; the route checks the person is the family's. */
  person_id?: string | null;
}

export interface EventPatch {
  columns: EventPatchColumns;
  /**
   * Provider dates for an all-day event, present only when the edit touched
   * its dates (or made it all-day). Absent on a title-only edit, so a
   * provider is never re-sent dates derived from instants stored by some
   * other client in some other zone.
   */
  allDayDates?: { start: string; endExclusive: string };
}

export type EventPatchResult = { ok: true; value: EventPatch } | { ok: false; error: string };

/** `instant` as a UTC day number of its calendar date in `timeZone`. */
function zonedDayNumber(instant: string, timeZone: string): number {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(instant));
  return dayNumber(key) ?? Math.floor(new Date(instant).getTime() / 86_400_000);
}

const PATCHABLE = ["title", "description", "location", "person_id", "all_day", "start_at", "end_at", "start_date", "end_date"];

/**
 * Validation for `PATCH /api/integration/v1/calendar/events/{id}`.
 *
 * The same rules as `parseEventInput`, applied to only the fields present:
 * a timed event moves with `start_at`/`end_at` (each with an offset), an
 * all-day event with `start_date`/`end_date` (the last day, inclusive), and
 * an end that is not sent keeps its stored value. A start that would land at
 * or after the stored end is refused rather than dragging the end along —
 * guessing that the caller wanted to keep the duration is exactly the kind
 * of silent decision an assistant should not have made for it.
 *
 * Switching between all-day and timed needs **both** ends in the new form:
 * there is no faithful way to turn 09:00–10:00 into dates, or a day into
 * times, without inventing one of them.
 *
 * `description`, `location` and `person_id` may be `null` to clear them. `calendar_id`
 * is refused: moving an event between calendars is a delete in one provider
 * and a create in another, not an edit.
 */
export function parseEventPatch(
  body: Record<string, unknown>,
  existing: StoredEventTimes,
  timeZone: string,
): EventPatchResult {
  const result = parseEventPatchFields(body, existing, timeZone);
  // `{ all_day: true }` on an event that already is all-day names a field
  // but changes nothing. Letting it through would run `.update({})`, which
  // PostgREST answers with no row (a 500 here), and still call the provider.
  if (result.ok && Object.keys(result.value.columns).length === 0 && !result.value.allDayDates) {
    return { ok: false, error: "nothing to change: the fields sent already have these values" };
  }
  return result;
}

function parseEventPatchFields(
  body: Record<string, unknown>,
  existing: StoredEventTimes,
  timeZone: string,
): EventPatchResult {
  const fail = (error: string): EventPatchResult => ({ ok: false, error });
  if (body.calendar_id !== undefined) return fail("`calendar_id` cannot be changed; delete the event and create it in the other calendar");
  if (!PATCHABLE.some((k) => body[k] !== undefined)) {
    return fail(`send at least one of ${PATCHABLE.map((k) => `\`${k}\``).join(", ")}`);
  }

  const columns: EventPatchColumns = {};
  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 300) return fail("`title` must be 1 to 300 characters");
    columns.title = title;
  }
  for (const [key, max] of [["description", 2000], ["location", 300]] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (value !== null && (typeof value !== "string" || value.length > max)) {
      return fail(`\`${key}\` must be a string of at most ${max} characters, or null to clear it`);
    }
    columns[key] = value === null ? null : value.trim();
  }
  if (body.person_id !== undefined) {
    if (!isPersonIdShape(body.person_id)) return fail(PERSON_ID_ERROR);
    columns.person_id = body.person_id;
  }
  if (body.all_day !== undefined && typeof body.all_day !== "boolean") return fail("`all_day` must be a boolean");

  const allDay = body.all_day ?? existing.all_day;
  const switching = allDay !== existing.all_day;
  if (switching) columns.all_day = allDay;

  if (allDay) {
    if (body.start_at !== undefined || body.end_at !== undefined) {
      return fail("an all-day event takes `start_date` and `end_date`, not timestamps");
    }
    if (switching && (body.start_date === undefined || body.end_date === undefined)) {
      return fail("making an event all-day needs both `start_date` and `end_date`");
    }
    if (body.start_date === undefined && body.end_date === undefined) return { ok: true, value: { columns } };
    const first = body.start_date !== undefined ? dayNumber(body.start_date) : zonedDayNumber(existing.start_at, timeZone);
    const last = body.end_date !== undefined ? dayNumber(body.end_date) : zonedDayNumber(existing.end_at, timeZone);
    if (first === null || last === null) return fail("`start_date` and `end_date` must be YYYY-MM-DD dates");
    if (last < first) return fail("`end_date` must not be before `start_date`");
    if (last - first + 1 > MAX_EVENT_DAYS) return fail(`an event may not exceed ${MAX_EVENT_DAYS} days`);
    if (switching || body.start_date !== undefined) columns.start_at = zonedWallTimeToUtc(first, 0, timeZone).toISOString();
    if (switching || body.end_date !== undefined) columns.end_at = zonedWallTimeToUtc(last, 86_400_000 - 1, timeZone).toISOString();
    return {
      ok: true,
      value: { columns, allDayDates: { start: dateFromDayNumber(first), endExclusive: dateFromDayNumber(last + 1) } },
    };
  }

  if (body.start_date !== undefined || body.end_date !== undefined) {
    return fail("`start_date` and `end_date` are only for all-day events");
  }
  if (switching && (body.start_at === undefined || body.end_at === undefined)) {
    return fail("making an event timed needs both `start_at` and `end_at`");
  }
  if (body.start_at === undefined && body.end_at === undefined) return { ok: true, value: { columns } };
  for (const key of ["start_at", "end_at"] as const) {
    const raw = body[key];
    if (raw !== undefined && (typeof raw !== "string" || !ISO_WITH_OFFSET.test(raw) || Number.isNaN(new Date(raw).getTime()))) {
      return fail("`start_at` and `end_at` must be ISO 8601 timestamps with `Z` or a `+HH:MM` offset");
    }
  }
  const start = new Date(body.start_at !== undefined ? (body.start_at as string) : existing.start_at);
  const end = new Date(body.end_at !== undefined ? (body.end_at as string) : existing.end_at);
  if (end <= start) {
    return fail("`end_at` must be after `start_at`; send both to move the event past its current end");
  }
  if (end.getTime() - start.getTime() > MAX_EVENT_DAYS * 86_400_000) return fail(`an event may not exceed ${MAX_EVENT_DAYS} days`);
  if (body.start_at !== undefined) columns.start_at = start.toISOString();
  if (body.end_at !== undefined) columns.end_at = end.toISOString();
  return { ok: true, value: { columns } };
}
