/**
 * `GET /api/integration/v1/holidays` and the `list_school_holidays` tool:
 * the school holidays and public holidays over a range of days, for planning
 * a trip or a break ("Plan the autumn break").
 *
 * The breaks are fetchSchoolBreaks()'s (lib/school-days.ts), the same read
 * get_school_timetable and the Heute-Motor decide "school or not" with, so
 * the three cannot disagree: the family's own school_holidays rows, events
 * on a calendar marked as holidays, rows synced from OpenHolidays (a row the
 * family hid is left out), and the public holidays of the family's region,
 * named in the family's language. A break the family has twice (typed in
 * and synced, same name and days) is listed once, as the event lists do
 * (normalizeHolidayName, lib/holiday-entries.ts).
 *
 * Kinboard keeps one set of school holidays per family, not per child, so
 * every school break applies to all the children; public holidays are the
 * family's region's (`region`).
 */

import { familyDateKey, familyHolidayRegion, addDays } from "@/lib/family-time";
import { fetchSchoolBreaks, type SchoolDb } from "@/lib/school-days";
import { isRealDate } from "@/lib/integration-meal-input";
import { normalizeHolidayName } from "@/lib/holiday-entries";
import type { SignalSchoolBreak } from "@/lib/attention/types";

/** The default range: today and the next 12 months. */
export const DEFAULT_HOLIDAY_DAYS = 365;
/** The widest range one read covers. */
export const MAX_HOLIDAY_DAYS = 400;

export interface HolidayView {
  name: string;
  /** First and last day, inclusive, YYYY-MM-DD in the family's calendar. */
  start_date: string;
  end_date: string;
  days: number;
  kind: "school" | "public";
  /** manual (typed in), calendar (a calendar marked as holidays), openholidays (synced), public_holiday. */
  source: SignalSchoolBreak["source"];
}

export interface HolidaysView {
  start: string;
  end: string;
  time_zone: string;
  /** The family's holiday region (e.g. DE-NI), which public holidays and the sync follow; null when none is chosen. */
  region: string | null;
  holidays: HolidayView[];
}

export type HolidaysResult =
  | { status: 200; body: HolidaysView }
  | { status: 400; body: { error: string; code: "invalid_request" } };

const dayNumber = (key: string) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86_400_000;

/** Both dates or neither; without them, today and the next 12 months. */
export function parseHolidayRange(
  startRaw: string | null, endRaw: string | null, today: string,
): { ok: true; start: string; end: string } | { ok: false; error: string } {
  if (startRaw === null && endRaw === null) return { ok: true, start: today, end: addDays(today, DEFAULT_HOLIDAY_DAYS) };
  if (startRaw === null || endRaw === null) return { ok: false, error: "send both `start` and `end`, or neither for the next 12 months" };
  if (!isRealDate(startRaw) || !isRealDate(endRaw)) return { ok: false, error: "`start` and `end` must be YYYY-MM-DD dates" };
  if (endRaw < startRaw) return { ok: false, error: "`end` must not be before `start`" };
  if (dayNumber(endRaw) - dayNumber(startRaw) + 1 > MAX_HOLIDAY_DAYS) {
    return { ok: false, error: `the range may not exceed ${MAX_HOLIDAY_DAYS} days` };
  }
  return { ok: true, start: startRaw, end: endRaw };
}

/**
 * The breaks as a list: each once, earliest first, a school break before a
 * public holiday on the same first day. A break the family has from two
 * sources keeps the first one fetchSchoolBreaks names (their own words win).
 */
export function holidayList(breaks: readonly SignalSchoolBreak[]): HolidayView[] {
  const seen = new Set<string>();
  const out: HolidayView[] = [];
  for (const b of breaks) {
    const name = b.name.trim();
    if (!name || b.endsOn < b.startsOn) continue;
    const identity = `${normalizeHolidayName(name)}|${b.startsOn}|${b.endsOn}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push({
      name,
      start_date: b.startsOn,
      end_date: b.endsOn,
      days: dayNumber(b.endsOn) - dayNumber(b.startsOn) + 1,
      kind: b.source === "public_holiday" ? "public" : "school",
      source: b.source,
    });
  }
  return out.sort((a, b) => a.start_date.localeCompare(b.start_date)
    || (a.kind === b.kind ? a.end_date.localeCompare(b.end_date) : a.kind === "school" ? -1 : 1));
}

export async function readHolidays(
  familyId: string,
  query: { start: string | null; end: string | null },
  deps: { db: SchoolDb; timeZone: string; now: Date },
): Promise<HolidaysResult> {
  const today = familyDateKey(deps.now, deps.timeZone);
  const range = parseHolidayRange(query.start, query.end, today);
  if (!range.ok) return { status: 400, body: { error: range.error, code: "invalid_request" } };
  const [breaks, region] = await Promise.all([
    fetchSchoolBreaks(familyId, range.start, range.end, deps.timeZone, deps.db),
    familyHolidayRegion(familyId, deps.db),
  ]);
  // fetchSchoolBreaks takes rows overlapping the range as they are; a break
  // that began before it keeps its real first day.
  const inRange = breaks.filter((b) => b.endsOn >= range.start && b.startsOn <= range.end);
  return {
    status: 200,
    body: {
      start: range.start,
      end: range.end,
      time_zone: deps.timeZone,
      region: region?.code ?? null,
      holidays: holidayList(inRange),
    },
  };
}
