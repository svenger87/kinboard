/**
 * German public holidays (Niedersachsen) with Easter-based movable feasts.
 * nameKeys map to the `holidays` translation namespace.
 */

import type { Holiday } from "./types";
import { computeEaster, addDays } from "./utils";

export function getDeHolidays(year: number): Holiday[] {
  const easter = computeEaster(year);

  return [
    { nameKey: "neujahr", date: new Date(year, 0, 1), emoji: "🎆" },
    { nameKey: "karfreitag", date: addDays(easter, -2), emoji: "✝️" },
    { nameKey: "ostersonntag", date: easter, emoji: "🐣" },
    { nameKey: "ostermontag", date: addDays(easter, 1), emoji: "🐰" },
    { nameKey: "tagDerArbeit", date: new Date(year, 4, 1), emoji: "🛠️" },
    { nameKey: "christiHimmelfahrt", date: addDays(easter, 39), emoji: "⛅" },
    { nameKey: "pfingstsonntag", date: addDays(easter, 49), emoji: "🕊️" },
    { nameKey: "pfingstmontag", date: addDays(easter, 50), emoji: "🕊️" },
    { nameKey: "tagDerDeutschenEinheit", date: new Date(year, 9, 3), emoji: "🇩🇪" },
    { nameKey: "reformationstag", date: new Date(year, 9, 31), emoji: "📜" },
    { nameKey: "heiligabend", date: new Date(year, 11, 24), emoji: "🎄" },
    { nameKey: "weihnachten1", date: new Date(year, 11, 25), emoji: "🎁" },
    { nameKey: "weihnachten2", date: new Date(year, 11, 26), emoji: "🎁" },
    { nameKey: "silvester", date: new Date(year, 11, 31), emoji: "🎇" },
  ];
}
