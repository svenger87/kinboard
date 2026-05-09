/**
 * French public holidays (jours fériés).
 * nameKeys map to the `holidays` translation namespace.
 */

import type { Holiday } from "./types";
import { computeEaster, addDays } from "./utils";

export function getFrHolidays(year: number): Holiday[] {
  const easter = computeEaster(year);

  return [
    { nameKey: "frJourDelan", date: new Date(year, 0, 1), emoji: "🎆" },
    { nameKey: "frLundiDePaques", date: addDays(easter, 1), emoji: "🐰" },
    { nameKey: "frFeteDuTravail", date: new Date(year, 4, 1), emoji: "🛠️" },
    { nameKey: "frVictoire1945", date: new Date(year, 4, 8), emoji: "🕊️" },
    { nameKey: "frAscension", date: addDays(easter, 39), emoji: "⛅" },
    { nameKey: "frLundiDePentecote", date: addDays(easter, 50), emoji: "🕊️" },
    { nameKey: "frFeteNationale", date: new Date(year, 6, 14), emoji: "🇫🇷" },
    { nameKey: "frAssomption", date: new Date(year, 7, 15), emoji: "⛪" },
    { nameKey: "frToussaint", date: new Date(year, 10, 1), emoji: "🕯️" },
    { nameKey: "frArmistice", date: new Date(year, 10, 11), emoji: "🎖️" },
    { nameKey: "frNoel", date: new Date(year, 11, 25), emoji: "🎄" },
  ];
}
