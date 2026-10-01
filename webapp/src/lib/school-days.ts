import { createAdminClient } from "@/lib/supabase/server";
import { isSchoolBreakOn, type SignalSchoolBreak } from "@/lib/attention/types";
import { timetabledChildren } from "@/lib/timetabled-children";
import { addDays } from "@/lib/family-time";

/**
 * The school timetable and "is there school on day X", shared by every
 * server-side reader (RFC-012 §4/§5): the Integration API's `GET /schedule`,
 * the family summary's `school_tomorrow`, and the Heute-Motor's school
 * rules, which read their holiday periods through `fetchSchoolBreaks` here.
 *
 * One copy on purpose. The summary used to decide "school tomorrow" from the
 * weekday alone while the board already knew about holidays, so a Home
 * Assistant sensor announced school every evening of the summer break while
 * the wall display stayed rightly quiet.
 *
 * Every query runs with the service role, which bypasses RLS, so the family
 * boundary is the explicit `family_id` filters here or nowhere.
 */

export type SchoolDb = ReturnType<typeof createAdminClient>;

/** `schedules.day_of_week` order: 0 = Sunday, as its CHECK constraint allows. */
export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Local `YYYY-MM-DD` of an instant in `timeZone`. */
export function localDayString(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export { addDays };

/** 0 = Sunday … 6 = Saturday, of a calendar date. */
export function dayOfWeekOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/**
 * School holiday periods overlapping `from`..`to` (local `YYYY-MM-DD`,
 * inclusive), from the two places a family can express them.
 *
 * 1. `school_holidays` — typed in by hand. The primary path, because it works
 *    in any country and needs no feed to exist for the family's own school.
 * 2. Events on a calendar flagged `is_holidays` — the ICS path, for anyone
 *    whose authority publishes a feed.
 *
 * Both reduce to the same inclusive `YYYY-MM-DD` range, so a reader cannot
 * tell them apart and does not have to. Throws on a failed query; the
 * Heute-Motor catches that and degrades to "term time", while the
 * Integration API reports it rather than claiming a school day it could not
 * check.
 */
export async function fetchSchoolBreaks(
  familyId: string,
  from: string,
  to: string,
  timeZone: string,
  db: SchoolDb = createAdminClient(),
): Promise<SignalSchoolBreak[]> {
  const [manual, calendarEvents] = await Promise.all([
    (db as any)
      .from("school_holidays")
      .select("name, starts_on, ends_on")
      .eq("family_id", familyId)
      .lte("starts_on", to)
      .gte("ends_on", from),
    (db as any)
      .from("events")
      .select("title, start_at, end_at, all_day, calendars!inner(family_id, is_holidays)")
      .eq("calendars.family_id", familyId)
      .eq("calendars.is_holidays", true)
      .lte("start_at", `${to}T23:59:59Z`)
      .gte("end_at", `${from}T00:00:00Z`),
  ]);
  if (manual.error) throw manual.error;
  if (calendarEvents.error) throw calendarEvents.error;

  const breaks: SignalSchoolBreak[] = [];

  for (const row of manual.data ?? []) {
    if (!row?.starts_on || !row?.ends_on) continue;
    breaks.push({
      name: String(row.name ?? ""),
      startsOn: String(row.starts_on),
      endsOn: String(row.ends_on),
      source: "manual",
    });
  }

  for (const row of calendarEvents.data ?? []) {
    if (!row?.start_at || !row?.end_at) continue;
    const start = new Date(row.start_at);
    const end = new Date(row.end_at);
    if (end.getTime() < start.getTime()) continue;
    breaks.push({
      name: String(row.title ?? ""),
      startsOn: localDayString(start, timeZone),
      endsOn: lastDayCovered(row, timeZone),
      source: "calendar",
    });
  }

  return breaks;
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
 * Is `day` (the family's local `YYYY-MM-DD`) a school day?
 *
 * A holiday beats the weekend, so a Saturday in the summer break says which
 * break it is. The holiday window is padded by a day either side because the
 * calendar-event bounds are UTC: in a zone behind UTC an event on the evening
 * of `day` starts on the next UTC date. `isSchoolBreakOn` then decides on the
 * exact local date.
 */
export async function schoolDayStatus(
  familyId: string,
  day: string,
  timeZone: string,
  db: SchoolDb = createAdminClient(),
): Promise<SchoolDayStatus> {
  const dow = dayOfWeekOf(day);
  const breaks = await fetchSchoolBreaks(familyId, addDays(day, -1), addDays(day, 1), timeZone, db);
  const hit = isSchoolBreakOn(breaks, day);
  const weekend = dow === 0 || dow === 6;
  return {
    date: day,
    weekday: WEEKDAYS[dow],
    school_day: !hit && !weekend,
    reason: hit ? "holiday" : weekend ? "weekend" : null,
    holiday: hit ? hit.name : null,
  };
}

export interface TimetableSlot {
  period: number | null;
  start: string | null;
  end: string | null;
  subject: string;
  room: string | null;
}

/**
 * A `time_slots` array as the timetable page writes it
 * (`{period, start, end, subject, room?}`), cleaned: a slot without a subject
 * is not a lesson, a malformed field is null rather than whatever was
 * stored, and lessons are in time order.
 */
export function normalizeSlots(timeSlots: unknown): TimetableSlot[] {
  if (!Array.isArray(timeSlots)) return [];
  const slots: TimetableSlot[] = [];
  for (const raw of timeSlots) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const subject = typeof s.subject === "string" ? s.subject.trim() : "";
    if (!subject) continue;
    const room = typeof s.room === "string" && s.room.trim() ? s.room.trim() : null;
    slots.push({
      period: typeof s.period === "number" && Number.isFinite(s.period) ? s.period : null,
      start: typeof s.start === "string" ? s.start : null,
      end: typeof s.end === "string" ? s.end : null,
      subject,
      room,
    });
  }
  return slots.sort(
    (a, b) =>
      (a.start ?? "99:99").localeCompare(b.start ?? "99:99") ||
      (a.period ?? Infinity) - (b.period ?? Infinity),
  );
}

export interface ChildLessons {
  person_id: string;
  name: string;
  /** Weekdays with lessons, Monday first, Sunday last. */
  days: { day_of_week: number; weekday: Weekday; slots: TimetableSlot[] }[];
}

/** Monday first: 1..6, then 0. */
const weekOrder = (dow: number) => (dow === 0 ? 7 : dow);

/**
 * The family's timetables: each child that has lessons, with their lessons
 * per weekday. `dayOfWeek` narrows to one weekday, `personId` to one person.
 *
 * Who counts is what the dashboard gives a Stundenplan card to
 * (`timetabledChildren`): a child, not in the recycle bin, with at least one
 * lesson. A binned person's `schedules` rows stay behind on purpose (the
 * soft delete keeps them for a restore), so the live-people filter is what
 * keeps them out. Both tables are filtered by family, and a schedule row
 * only counts when its person is one of this family's live people.
 */
export async function loadTimetables(
  familyId: string,
  options: { dayOfWeek?: number; personId?: string } = {},
  db: SchoolDb = createAdminClient(),
): Promise<ChildLessons[]> {
  let peopleQuery = (db as any)
    .from("people")
    .select("id, name, is_child")
    .eq("family_id", familyId)
    .is("deleted_at", null);
  if (options.personId) peopleQuery = peopleQuery.eq("id", options.personId);

  let scheduleQuery = (db as any)
    .from("schedules")
    .select("person_id, day_of_week, time_slots")
    .eq("family_id", familyId);
  if (options.dayOfWeek !== undefined) scheduleQuery = scheduleQuery.eq("day_of_week", options.dayOfWeek);
  if (options.personId) scheduleQuery = scheduleQuery.eq("person_id", options.personId);

  const [people, schedules] = await Promise.all([peopleQuery.order("created_at"), scheduleQuery]);
  if (people.error) throw people.error;
  if (schedules.error) throw schedules.error;

  const rows = ((schedules.data ?? []) as { person_id: string; day_of_week: number; time_slots: unknown }[])
    .map((r) => ({ person_id: String(r.person_id), day_of_week: Number(r.day_of_week), time_slots: normalizeSlots(r.time_slots) }))
    .filter((r) => r.time_slots.length > 0);

  const children = timetabledChildren(
    (people.data ?? []) as { id: string; name: string; is_child: boolean | null }[],
    rows,
  );

  return children.map((child) => ({
    person_id: child.id,
    name: child.name,
    days: rows
      .filter((r) => r.person_id === child.id)
      .sort((a, b) => weekOrder(a.day_of_week) - weekOrder(b.day_of_week))
      .map((r) => ({ day_of_week: r.day_of_week, weekday: WEEKDAYS[r.day_of_week] ?? "sunday", slots: r.time_slots })),
  }));
}

export interface SchoolDay extends SchoolDayStatus {
  /** Who has lessons that day. Empty whenever `school_day` is false. */
  children: { person_id: string; name: string; slots: TimetableSlot[] }[];
}

/**
 * Who has school on `day`, and which lessons. A holiday or a weekend means
 * nobody, whatever the weekday's timetable says — the timetable is per
 * weekday and cannot express a break.
 */
export async function schoolOn(
  familyId: string,
  day: string,
  timeZone: string,
  options: { personId?: string } = {},
  db: SchoolDb = createAdminClient(),
): Promise<SchoolDay> {
  const status = await schoolDayStatus(familyId, day, timeZone, db);
  if (!status.school_day) return { ...status, children: [] };
  const timetables = await loadTimetables(familyId, { dayOfWeek: dayOfWeekOf(day), personId: options.personId }, db);
  return {
    ...status,
    children: timetables.flatMap((c) =>
      c.days.filter((d) => d.day_of_week === dayOfWeekOf(day)).map((d) => ({ person_id: c.person_id, name: c.name, slots: d.slots })),
    ),
  };
}

/** The family summary's `school_tomorrow` sensor. */
export interface SchoolTomorrowSensor {
  /** The children's names — the human answer, which is what a dashboard shows. */
  state: string | null;
  children: string[];
  count: number;
  /** The first child's first lesson, by start time. */
  first_lesson: string | null;
  /** The day this is about: tomorrow in the family's time zone. */
  date: string | null;
  /** False on a school holiday or a weekend; null when it could not be read. */
  school_day: boolean | null;
  reason: "holiday" | "weekend" | null;
}

/** `schoolOn(tomorrow)` as the sensor reports it; `null` (a failed read) reports nothing. */
export function schoolTomorrowSensor(school: SchoolDay | null): SchoolTomorrowSensor {
  const children = school?.children ?? [];
  const names = children.map((c) => c.name);
  return {
    state: names.length > 0 ? names.join(", ") : null,
    children: names,
    count: names.length,
    first_lesson: children[0]?.slots[0]?.subject ?? null,
    date: school?.date ?? null,
    school_day: school ? school.school_day : null,
    reason: school?.reason ?? null,
  };
}
