/**
 * Dutch public holidays. Days off are those the Algemene termijnenwet lists:
 * Good Friday is not among them, and Easter and Whit Sunday only as Sundays.
 * Whether a job gives each one off is up to the employment contract (CAO).
 * nameKeys map to the `holidays` translation namespace.
 */

import type { Holiday } from "./types";
import { computeEaster, addDays } from "./utils";

export function getNlHolidays(year: number): Holiday[] {
  const easter = computeEaster(year);
  // King's Day is 27 April, but moves to Saturday the 26th when the 27th is
  // a Sunday: 2025, 2031, 2036.
  const kingsDay = new Date(year, 3, 27);
  if (kingsDay.getDay() === 0) kingsDay.setDate(26);
  // Liberation Day is a holiday every year, but most CAOs give it off only in
  // a lustrum year (2025, 2030, ...), so only those count as a day off.
  const liberationDayOff = year % 5 === 0;

  return [
    { nameKey: "nlNieuwjaarsdag", date: new Date(year, 0, 1), emoji: "🎆", dayOff: true },
    { nameKey: "nlGoedeVrijdag", date: addDays(easter, -2), emoji: "✝️", dayOff: false },
    { nameKey: "nlEerstePaasdag", date: easter, emoji: "🐣", dayOff: false },
    { nameKey: "nlTweedePaasdag", date: addDays(easter, 1), emoji: "🐰", dayOff: true },
    { nameKey: "nlKoningsdag", date: kingsDay, emoji: "🇳🇱", dayOff: true },
    { nameKey: "nlBevrijdingsdag", date: new Date(year, 4, 5), emoji: "🕊️", dayOff: liberationDayOff },
    { nameKey: "nlHemelvaartsdag", date: addDays(easter, 39), emoji: "⛅", dayOff: true },
    { nameKey: "nlEerstePinksterdag", date: addDays(easter, 49), emoji: "🕊️", dayOff: false },
    { nameKey: "nlTweedePinksterdag", date: addDays(easter, 50), emoji: "🕊️", dayOff: true },
    { nameKey: "nlEersteKerstdag", date: new Date(year, 11, 25), emoji: "🎄", dayOff: true },
    { nameKey: "nlTweedeKerstdag", date: new Date(year, 11, 26), emoji: "🎁", dayOff: true },
  ];
}
