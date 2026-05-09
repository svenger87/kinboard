/**
 * Dutch public holidays.
 * nameKeys map to the `holidays` translation namespace.
 */

import type { Holiday } from "./types";
import { computeEaster, addDays } from "./utils";

export function getNlHolidays(year: number): Holiday[] {
  const easter = computeEaster(year);

  return [
    { nameKey: "nlNieuwjaarsdag", date: new Date(year, 0, 1), emoji: "🎆" },
    { nameKey: "nlGoedeVrijdag", date: addDays(easter, -2), emoji: "✝️" },
    { nameKey: "nlEerstePaasdag", date: easter, emoji: "🐣" },
    { nameKey: "nlTweedePaasdag", date: addDays(easter, 1), emoji: "🐰" },
    { nameKey: "nlKoningsdag", date: new Date(year, 3, 27), emoji: "🇳🇱" },
    { nameKey: "nlBevrijdingsdag", date: new Date(year, 4, 5), emoji: "🕊️" },
    { nameKey: "nlHemelvaartsdag", date: addDays(easter, 39), emoji: "⛅" },
    { nameKey: "nlEerstePinksterdag", date: addDays(easter, 49), emoji: "🕊️" },
    { nameKey: "nlTweedePinksterdag", date: addDays(easter, 50), emoji: "🕊️" },
    { nameKey: "nlEersteKerstdag", date: new Date(year, 11, 25), emoji: "🎄" },
    { nameKey: "nlTweedeKerstdag", date: new Date(year, 11, 26), emoji: "🎁" },
  ];
}
