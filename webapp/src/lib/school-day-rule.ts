import type { SignalSchoolBreak } from "@/lib/attention/types";
import { isSchoolBreakOn } from "@/lib/attention/types";
import { addDays } from "@/lib/local-date";
import { publicHolidayBreaks } from "@/lib/holidays/school";
import type { Holiday } from "@/lib/holidays/types";

/**
 * "Is there school on day X", as a pure rule: no database, no clock, no
 * server import, so the server and the browser run the same code.
 *
 * The server (lib/school-days.ts) loads the family's rows and feeds them in
 * for the Integration API's `/schedule`, the family summary's
 * `school_tomorrow` and the MCP tools. The timetable widget feeds the same
 * rule from the hooks it already has. Two copies of this rule were how the
 * widget came to show lessons on Tag der Deutschen Einheit while the Home
 * Assistant sensor rightly said there was no school (#330).
 *
 * Every day here is a calendar date, `YYYY-MM-DD`: the family's local date on
 * the server, the device's local date in the widget. Nothing converts one
 * to an instant, so there is no UTC day to drift into.
 */

/** `schedules.day_of_week` order: 0 = Sunday, as its CHECK constraint allows. */
export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** 0 = Sunday … 6 = Saturday, of a calendar date. */
export function dayOfWeekOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/** Local `YYYY-MM-DD` of an instant in `timeZone`. */
export function localDayString(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * The last day an event covers, as a local `YYYY-MM-DD`: the day of the last
 * millisecond before `end_at`, or the start's day for a zero-length event.
 *
 * Every writer today stores an all-day event's `end_at` INCLUSIVELY: ICS and
 * CalDAV imports (`allDayEndAnchor` in ics-fetcher.ts) and Google sync at
 * 12:00 UTC of the last day, the app's own calendar and the Integration API
 * at local 23:59:59.999 of the last day — one millisecond earlier is the same
 * day for both. This once subtracted a whole day from every all-day end, from
 * the time imports stored iCalendar's exclusive DTEND verbatim, and that cost
 * every imported holiday its last day and dropped single-day ones altogether.
 * A legacy row in that exclusive form ends exactly at local midnight, and one
 * millisecond earlier is its real last day, so it still reads right; so does
 * a timed event that ends at midnight.
 */
export function lastDayCovered(row: { start_at: string; end_at: string }, timeZone: string): string {
  const start = new Date(row.start_at).getTime();
  const end = new Date(row.end_at).getTime();
  return localDayString(new Date(end > start ? end - 1 : start), timeZone);
}

/** A `school_holidays` row as both readers have it. */
export interface SchoolHolidayRowInput {
  name?: unknown;
  starts_on?: unknown;
  ends_on?: unknown;
  source?: unknown;
  hidden?: unknown;
}

/** An event on a calendar flagged `is_holidays`. */
export interface HolidayCalendarEventInput {
  title?: unknown;
  start_at?: string | null;
  end_at?: string | null;
}

/**
 * Events on a holiday calendar (`is_holidays`) as the local days they cover
 * in `timeZone`. The caller passes only such events, from calendars that are
 * not unticked Google calendars (lib/google-calendar-reconcile.ts).
 */
export function holidayCalendarBreaks(
  events: readonly HolidayCalendarEventInput[] | null | undefined,
  timeZone: string,
): SignalSchoolBreak[] {
  const out: SignalSchoolBreak[] = [];
  for (const row of events ?? []) {
    if (!row?.start_at || !row?.end_at) continue;
    const start = new Date(row.start_at);
    const end = new Date(row.end_at);
    if (end.getTime() < start.getTime()) continue;
    out.push({
      name: String(row.title ?? ""),
      startsOn: localDayString(start, timeZone),
      endsOn: lastDayCovered({ start_at: row.start_at, end_at: row.end_at }, timeZone),
      source: "calendar",
    });
  }
  return out;
}

export interface SchoolBreakInputs {
  /** The family's holiday region code; null means no public holidays. */
  region: string | null;
  /** `school_holidays` rows, manual and synced, hidden ones included (they are skipped here). */
  schoolHolidays: readonly SchoolHolidayRowInput[] | null | undefined;
  /** Holiday-calendar events, already reduced to local days (holidayCalendarBreaks). */
  holidayCalendarDays: readonly SignalSchoolBreak[] | null | undefined;
  /** The language public holidays are named in, and the namer. */
  locale: string;
  label: (holiday: Holiday) => string;
}

/**
 * Every break that can close school between `from` and `to` (inclusive), in
 * the order that names a day (RFC-014 §6.2): the family's own rows, then a
 * holiday calendar they chose, then rows synced for them, then public
 * holidays. `isSchoolBreakOn` takes the first match, so a school break wins
 * over a public holiday on the same day.
 *
 * The rows and calendar days are taken as given, not cut to the range: the
 * server already asked the database for that range, and a day outside it is
 * never asked about. Public holidays are computed for the range only.
 *
 * The country rule lives with the holidays: a US family gets no public
 * holidays here, because districts set their own school calendars
 * (`schoolClosures`, RFC-014 §6.3).
 */
export function schoolBreaks(inputs: SchoolBreakInputs, from: string, to: string): SignalSchoolBreak[] {
  const manual: SignalSchoolBreak[] = [];
  const synced: SignalSchoolBreak[] = [];
  for (const row of inputs.schoolHolidays ?? []) {
    if (!row?.starts_on || !row?.ends_on) continue;
    // A range the family hid is not a break (§6.2).
    if (row.hidden === true) continue;
    const source = row.source === "openholidays" ? "openholidays" : "manual";
    (source === "manual" ? manual : synced).push({
      name: String(row.name ?? ""),
      startsOn: String(row.starts_on),
      endsOn: String(row.ends_on),
      source,
    });
  }
  const breaks: SignalSchoolBreak[] = [...manual, ...(inputs.holidayCalendarDays ?? []), ...synced];
  if (inputs.region) breaks.push(...publicHolidayBreaks(inputs.region, from, to, inputs.locale, inputs.label));
  return breaks;
}

export interface SchoolDayStatus {
  date: string;
  weekday: Weekday;
  school_day: boolean;
  /** Why not: a holiday period covers the day, or it is a Saturday or Sunday. */
  reason: "holiday" | "weekend" | null;
  /** The holiday's own name, when `reason` is `holiday`. */
  holiday: string | null;
}

/**
 * Is there school on `day`, given the breaks that could cover it?
 *
 * No school on a weekend or on a day a break covers. A holiday beats the
 * weekend, so a Saturday in the summer break says which break it is.
 */
export function schoolDayStatusOn(day: string, breaks: readonly SignalSchoolBreak[]): SchoolDayStatus {
  const dow = dayOfWeekOf(day);
  const hit = isSchoolBreakOn(breaks as SignalSchoolBreak[], day);
  const weekend = dow === 0 || dow === 6;
  return {
    date: day,
    weekday: WEEKDAYS[dow],
    school_day: !hit && !weekend,
    reason: hit ? "holiday" : weekend ? "weekend" : null,
    holiday: hit ? hit.name : null,
  };
}

/** `schoolDayStatusOn(day, breaks).school_day`. */
export function isSchoolDay(day: string, breaks: readonly SignalSchoolBreak[]): boolean {
  return schoolDayStatusOn(day, breaks).school_day;
}

/** How far nextSchoolDay looks by default: past the longest summer break (Italy's runs to about 13 weeks). */
export const NEXT_SCHOOL_DAY_HORIZON = 120;

/**
 * The first school day strictly after `after`, within `within` days, or
 * null. `hasLessons` narrows it to a day the child has a timetable for, so
 * a child with no lessons on Fridays is shown Monday's. The breaks must
 * cover the whole window, or a day past them reads as term time.
 */
export function nextSchoolDay(
  after: string,
  breaks: readonly SignalSchoolBreak[],
  options: { hasLessons?: (dayOfWeek: number) => boolean; within?: number } = {},
): SchoolDayStatus | null {
  const within = options.within ?? NEXT_SCHOOL_DAY_HORIZON;
  for (let offset = 1; offset <= within; offset++) {
    const status = schoolDayStatusOn(addDays(after, offset), breaks);
    if (!status.school_day) continue;
    if (options.hasLessons && !options.hasLessons(dayOfWeekOf(status.date))) continue;
    return status;
  }
  return null;
}
