import type { SignalSchoolBreak } from "@/lib/attention/types";
import { toLocalDateKey } from "@/lib/local-date";
import { schoolClosures } from "./adapter";
import type { Holiday } from "./types";

/**
 * Public holidays as one-day school breaks between `from` and `to` (local
 * `YYYY-MM-DD`, inclusive): RFC-014 §6.3. Computed when read, never stored.
 * `label` names each one in the family's language. The year after `to` is
 * read too, because a day off can be taken in the year before its holiday.
 */
export function publicHolidayBreaks(
  region: string,
  from: string,
  to: string,
  locale: string,
  label: (holiday: Holiday) => string,
): SignalSchoolBreak[] {
  const out: SignalSchoolBreak[] = [];
  const seen = new Set<string>();
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)) + 1; year++) {
    for (const { date, holiday } of schoolClosures(region, year, locale)) {
      const day = toLocalDateKey(date);
      if (day < from || day > to || seen.has(day)) continue;
      seen.add(day);
      out.push({ name: label(holiday), startsOn: day, endsOn: day, source: "public_holiday" });
    }
  }
  return out.sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}
