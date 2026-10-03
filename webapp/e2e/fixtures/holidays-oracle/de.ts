/**
 * German public holidays (Niedersachsen) with Easter-based movable feasts.
 * Easter and Whit Sunday are not statutory holidays in Niedersachsen, and
 * Christmas Eve and New Year's Eve are not holidays anywhere in Germany:
 * marked, not days off.
 * nameKeys map to the `holidays` translation namespace.
 */

import type { Holiday } from "./types";
import { computeEaster, addDays } from "./utils";

export function getDeHolidays(year: number): Holiday[] {
  const easter = computeEaster(year);

  return [
    { nameKey: "neujahr", date: new Date(year, 0, 1), emoji: "🎆", dayOff: true },
    { nameKey: "karfreitag", date: addDays(easter, -2), emoji: "✝️", dayOff: true },
    { nameKey: "ostersonntag", date: easter, emoji: "🐣", dayOff: false },
    { nameKey: "ostermontag", date: addDays(easter, 1), emoji: "🐰", dayOff: true },
    { nameKey: "tagDerArbeit", date: new Date(year, 4, 1), emoji: "🛠️", dayOff: true },
    { nameKey: "christiHimmelfahrt", date: addDays(easter, 39), emoji: "⛅", dayOff: true },
    { nameKey: "pfingstsonntag", date: addDays(easter, 49), emoji: "🕊️", dayOff: false },
    { nameKey: "pfingstmontag", date: addDays(easter, 50), emoji: "🕊️", dayOff: true },
    { nameKey: "tagDerDeutschenEinheit", date: new Date(year, 9, 3), emoji: "🤝", dayOff: true },
    { nameKey: "reformationstag", date: new Date(year, 9, 31), emoji: "📜", dayOff: true },
    { nameKey: "heiligabend", date: new Date(year, 11, 24), emoji: "🎄", dayOff: false },
    { nameKey: "weihnachten1", date: new Date(year, 11, 25), emoji: "🎁", dayOff: true },
    { nameKey: "weihnachten2", date: new Date(year, 11, 26), emoji: "🎁", dayOff: true },
    { nameKey: "silvester", date: new Date(year, 11, 31), emoji: "🎇", dayOff: false },
  ];
}
