/**
 * @deprecated Import from `@/lib/holidays` instead.
 * This file is kept for backwards compatibility; it re-exports the DE holiday
 * set and the old `getUpcomingHolidays(daysAhead)` signature from the new
 * country-aware module.
 */

export type { Holiday } from "./holidays/types";
import { getDeHolidays } from "./holidays/de";
import { getUpcomingHolidays as _getUpcomingHolidays } from "./holidays";

export function getGermanHolidays(year: number) {
  return getDeHolidays(year);
}

export function getUpcomingHolidays(daysAhead: number = 14) {
  return _getUpcomingHolidays("de", daysAhead);
}

export function getNextHoliday() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const year = today.getFullYear();
  const holidays = [...getDeHolidays(year), ...getDeHolidays(year + 1)];
  return (
    holidays
      .filter((h) => h.date >= today)
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0] || null
  );
}
