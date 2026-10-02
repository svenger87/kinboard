/**
 * #319's observedDays, frozen as the oracle for the weekday a day off is
 * taken on (RFC-014 §4.6). Do not edit: it is what the adapter is checked
 * against.
 */
import type { Holiday } from "./types";
import { addDays } from "./utils";

const isWeekend = (date: Date): boolean => date.getDay() === 0 || date.getDay() === 6;
const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function oracleObservedDays(country: string, holidays: readonly Holiday[]): Map<Holiday, Date> {
  const observed = new Map<Holiday, Date>();
  if (country === "us") {
    for (const holiday of holidays) {
      if (!holiday.dayOff) continue;
      if (holiday.date.getDay() === 6) observed.set(holiday, addDays(holiday.date, -1));
      else if (holiday.date.getDay() === 0) observed.set(holiday, addDays(holiday.date, 1));
    }
  } else if (country === "uk") {
    const taken = holidays.filter((h) => h.dayOff && !isWeekend(h.date)).map((h) => h.date);
    for (const holiday of [...holidays].sort((a, b) => a.date.getTime() - b.date.getTime())) {
      if (!holiday.dayOff || !isWeekend(holiday.date)) continue;
      let day = addDays(holiday.date, 1);
      while (isWeekend(day) || taken.some((t) => sameDay(t, day))) day = addDays(day, 1);
      taken.push(day);
      observed.set(holiday, day);
    }
  }
  return observed;
}
