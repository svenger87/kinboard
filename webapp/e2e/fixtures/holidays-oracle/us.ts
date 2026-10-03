/**
 * US federal public holidays.
 * nameKeys map to the `holidays` translation namespace.
 */

import type { Holiday } from "./types";
import { computeEaster, nthWeekdayOfMonth, lastWeekdayOfMonth } from "./utils";

export function getUsHolidays(year: number): Holiday[] {
  return [
    { nameKey: "usNewYearsDay", date: new Date(year, 0, 1), emoji: "🎆", dayOff: true },
    // 3rd Monday of January
    { nameKey: "usMlkDay", date: nthWeekdayOfMonth(year, 0, 1, 3), emoji: "✊", dayOff: true },
    // 3rd Monday of February
    { nameKey: "usPresidentsDay", date: nthWeekdayOfMonth(year, 1, 1, 3), emoji: "🎩", dayOff: true },
    // Last Monday of May
    { nameKey: "usMemorialDay", date: lastWeekdayOfMonth(year, 4, 1), emoji: "🎖️", dayOff: true },
    { nameKey: "usJuneteenth", date: new Date(year, 5, 19), emoji: "✊", dayOff: true },
    { nameKey: "usIndependence", date: new Date(year, 6, 4), emoji: "🎇", dayOff: true },
    // 1st Monday of September
    { nameKey: "usLaborDay", date: nthWeekdayOfMonth(year, 8, 1, 1), emoji: "🛠️", dayOff: true },
    // 2nd Monday of October
    { nameKey: "usColumbus", date: nthWeekdayOfMonth(year, 9, 1, 2), emoji: "⚓", dayOff: true },
    { nameKey: "usVeterans", date: new Date(year, 10, 11), emoji: "🎖️", dayOff: true },
    // 4th Thursday of November
    { nameKey: "usThanksgiving", date: nthWeekdayOfMonth(year, 10, 4, 4), emoji: "🦃", dayOff: true },
    { nameKey: "usChristmas", date: new Date(year, 11, 25), emoji: "🎄", dayOff: true },
  ];
}

/**
 * US days that are celebrated but not federal holidays -- most people work
 * them. The holiday countdown lists them beside the federal holidays; the
 * calendar marks federal holidays only.
 */
export function getUsObservances(year: number): Holiday[] {
  return [
    { nameKey: "usValentinesDay", date: new Date(year, 1, 14), emoji: "💝", dayOff: false },
    { nameKey: "usStPatricksDay", date: new Date(year, 2, 17), emoji: "☘️", dayOff: false },
    { nameKey: "usEaster", date: computeEaster(year), emoji: "🐣", dayOff: false },
    // 2nd Sunday of May
    { nameKey: "usMothersDay", date: nthWeekdayOfMonth(year, 4, 0, 2), emoji: "💐", dayOff: false },
    // 3rd Sunday of June
    { nameKey: "usFathersDay", date: nthWeekdayOfMonth(year, 5, 0, 3), emoji: "👔", dayOff: false },
    { nameKey: "usHalloween", date: new Date(year, 9, 31), emoji: "🎃", dayOff: false },
    { nameKey: "usChristmasEve", date: new Date(year, 11, 24), emoji: "🎅", dayOff: false },
    { nameKey: "usNewYearsEve", date: new Date(year, 11, 31), emoji: "🥂", dayOff: false },
  ];
}
