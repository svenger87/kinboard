/**
 * UK bank holidays (England & Wales).
 * nameKeys map to the `holidays` translation namespace.
 */

import type { Holiday } from "./types";
import { computeEaster, addDays, nthWeekdayOfMonth, lastWeekdayOfMonth } from "./utils";

export function getUkHolidays(year: number): Holiday[] {
  const easter = computeEaster(year);

  return [
    { nameKey: "ukNewYearsDay", date: new Date(year, 0, 1), emoji: "🎆", dayOff: true },
    { nameKey: "ukGoodFriday", date: addDays(easter, -2), emoji: "✝️", dayOff: true },
    { nameKey: "ukEasterMonday", date: addDays(easter, 1), emoji: "🐰", dayOff: true },
    // 1st Monday of May
    { nameKey: "ukEarlyMayBankHoliday", date: nthWeekdayOfMonth(year, 4, 1, 1), emoji: "🌸", dayOff: true },
    // Last Monday of May
    { nameKey: "ukSpringBankHoliday", date: lastWeekdayOfMonth(year, 4, 1), emoji: "🌼", dayOff: true },
    // Last Monday of August
    { nameKey: "ukSummerBankHoliday", date: lastWeekdayOfMonth(year, 7, 1), emoji: "☀️", dayOff: true },
    { nameKey: "ukChristmasDay", date: new Date(year, 11, 25), emoji: "🎄", dayOff: true },
    { nameKey: "ukBoxingDay", date: new Date(year, 11, 26), emoji: "🎁", dayOff: true },
  ];
}
