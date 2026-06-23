import {
  differenceInDays,
  differenceInYears,
  setYear,
  addYears,
  parseISO,
  startOfDay,
} from "date-fns";

/**
 * Parse a "YYYY-MM-DD" birthday string as a LOCAL date (not UTC).
 * Appends T12:00:00 so timezone offsets never shift the calendar day.
 */
export function parseBirthdayDate(dateStr: string): Date {
  return parseISO(dateStr + "T12:00:00");
}

/**
 * The next occurrence (this year, or next year if already past).
 * `now` defaults to the current date; pass a tick value (see `useToday`) so
 * callers recompute when the calendar day rolls over.
 */
export function getNextBirthday(date: Date, now: Date = new Date()): Date {
  const today = startOfDay(now);
  const thisYearBirthday = startOfDay(setYear(date, today.getFullYear()));
  if (differenceInDays(today, thisYearBirthday) > 0) {
    return addYears(thisYearBirthday, 1);
  }
  return thisYearBirthday;
}

/** Whole days from today until the next birthday. */
export function getDaysUntilBirthday(date: Date, now: Date = new Date()): number {
  const nextBirthday = getNextBirthday(date, now);
  return differenceInDays(startOfDay(nextBirthday), startOfDay(now));
}

/** Current age in whole years. */
export function getAge(date: Date): number {
  return differenceInYears(startOfDay(new Date()), startOfDay(date));
}

/** Age the person turns on their next birthday. */
export function getUpcomingAge(date: Date): number {
  const nextBirthday = getNextBirthday(date);
  return differenceInYears(nextBirthday, startOfDay(date));
}
