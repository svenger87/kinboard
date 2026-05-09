/**
 * US federal public holidays.
 * nameKeys map to the `holidays` translation namespace.
 */

import type { Holiday } from "./types";
import { nthWeekdayOfMonth, lastWeekdayOfMonth } from "./utils";

export function getUsHolidays(year: number): Holiday[] {
  return [
    { nameKey: "usNewYearsDay", date: new Date(year, 0, 1), emoji: "🎆" },
    // 3rd Monday of January
    { nameKey: "usMlkDay", date: nthWeekdayOfMonth(year, 0, 1, 3), emoji: "✊" },
    // 3rd Monday of February
    { nameKey: "usPresidentsDay", date: nthWeekdayOfMonth(year, 1, 1, 3), emoji: "🇺🇸" },
    // Last Monday of May
    { nameKey: "usMemorialDay", date: lastWeekdayOfMonth(year, 4, 1), emoji: "🎖️" },
    { nameKey: "usJuneteenth", date: new Date(year, 5, 19), emoji: "✊" },
    { nameKey: "usIndependence", date: new Date(year, 6, 4), emoji: "🎇" },
    // 1st Monday of September
    { nameKey: "usLaborDay", date: nthWeekdayOfMonth(year, 8, 1, 1), emoji: "🛠️" },
    // 2nd Monday of October
    { nameKey: "usColumbus", date: nthWeekdayOfMonth(year, 9, 1, 2), emoji: "⚓" },
    { nameKey: "usVeterans", date: new Date(year, 10, 11), emoji: "🎖️" },
    // 4th Thursday of November
    { nameKey: "usThanksgiving", date: nthWeekdayOfMonth(year, 10, 4, 4), emoji: "🦃" },
    { nameKey: "usChristmas", date: new Date(year, 11, 25), emoji: "🎄" },
  ];
}
