import type { Holiday } from "./types";
import { differenceInCalendarDays } from "date-fns";
import { observedDays, regionYear } from "./adapter";

/**
 * A holiday region (RFC-014 §4.2): `DE-NI`, `AT-9`, `CH-ZH`, `GB-SCT`,
 * `US-CA` or a bare country (`NL`). #319's five lower-case codes are
 * accepted as aliases (`de` is `DE-NI`, `uk` is `GB-ENG`, …). A region
 * Kinboard does not offer has no holidays.
 */
export type CountryCode = string;

/**
 * @deprecated #319's five countries, as their legacy codes. Kept for the
 * specs and the oracle; the offered list is `OFFERED_COUNTRIES` in
 * `./region`.
 */
export const COUNTRIES: readonly CountryCode[] = ["de", "us", "uk", "nl", "fr"];

/** The public holidays the calendar marks, and the marked non-public days, in date order. */
export function getHolidays(country: CountryCode, year: number, locale: string = "en"): Holiday[] {
  return regionYear(country, year, locale)?.days.filter((d) => d.inCalendar).map((d) => d.holiday) ?? [];
}

/**
 * Days that are celebrated but are not public holidays -- Halloween, Mother's
 * Day -- for the holiday countdown; empty for a country without such a list.
 * The calendar does not mark them: its switch is for public holidays.
 */
export function getObservances(country: CountryCode, year: number, locale: string = "en"): Holiday[] {
  return regionYear(country, year, locale)?.days.filter((d) => d.isObservance).map((d) => d.holiday) ?? [];
}

/** A holiday as the countdown shows it. */
export interface UpcomingHoliday extends Holiday {
  /** The weekday a day off is taken instead, when the holiday falls on a weekend; null when it does not move. */
  observed: Date | null;
}

/**
 * The next `count` holidays from `from` on, that day included, for the
 * holiday countdown: the public holidays the calendar marks plus the
 * country's observances, sorted by date, each day off that falls on a weekend
 * with the weekday it is taken. A holiday already past whose day off is still
 * to come -- a Sunday holiday, on the Monday it is taken -- stays listed.
 */
export function nextHolidays(country: CountryCode, from: Date, count: number, locale: string = "en"): UpcomingHoliday[] {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const all: UpcomingHoliday[] = [];
  for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
    const holidays = getHolidays(country, year, locale);
    const observed = observedDays(country, year, holidays, locale);
    for (const holiday of holidays) all.push({ ...holiday, observed: observed.get(holiday) ?? null });
    for (const holiday of getObservances(country, year, locale)) all.push({ ...holiday, observed: null });
  }
  return all
    .filter((h) => h.date >= today || (h.observed !== null && h.observed >= today))
    .sort((a, b) => a.date.getTime() - b.date.getTime() || Number(b.dayOff) - Number(a.dayOff))
    .slice(0, count);
}

/**
 * The days the countdown shows for a holiday: to the holiday or its day off,
 * whichever comes first and is not yet past. On the Friday a Saturday holiday
 * is taken, and on the Monday after a Sunday one, that is 0 -- the badge says
 * "Today", because today is the day off.
 */
export function daysUntilHoliday(holiday: UpcomingHoliday, from: Date): number {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const days = [holiday.date, holiday.observed]
    .filter((d): d is Date => d !== null && d >= today)
    .map((d) => differenceInCalendarDays(d, today));
  return days.length > 0 ? Math.min(...days) : 0;
}

export type { Holiday } from "./types";
