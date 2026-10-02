import { entryCoversDay, keyToDate, type HolidayEntry } from "@/lib/holiday-entries";

/**
 * School breaks on the calendar page: the month grid's band, the week view's
 * all-day strip and the day panel's badge.
 *
 * The entries come from useHolidayEntries -- the source the widgets use, with
 * its switch (`calendar_display.showHolidays`), its hidden-row filter and its
 * de-duplication against a calendar that already lists the break -- and only
 * the school ones are taken: the public holidays already have their dots.
 */

export interface SchoolBreakDay {
  entry: HolidayEntry;
  /** The break's first day. */
  first: boolean;
  /** The break's last day. */
  last: boolean;
}

/** The school entries of a holiday-entry list. */
export function schoolBreaks(entries: readonly HolidayEntry[]): HolidayEntry[] {
  return entries.filter((entry) => entry.kind === "school");
}

/** The breaks that cover `dayKey`, earliest first. */
export function schoolBreaksOn(entries: readonly HolidayEntry[], dayKey: string): SchoolBreakDay[] {
  return entries
    .filter((entry) => entry.kind === "school" && entryCoversDay(entry, dayKey))
    .sort((a, b) => a.startKey.localeCompare(b.startKey) || a.title.localeCompare(b.title))
    .map((entry) => ({ entry, first: entry.startKey === dayKey, last: entry.endKey === dayKey }));
}

/**
 * "12.–24. Okt." / "Oct 12 – 24" / "12–24 oct.": the days a break covers, in
 * the UI language. One day is one date; a break across New Year carries the
 * years, which is what Intl's range format does by itself.
 */
export function schoolBreakRange(entry: Pick<HolidayEntry, "startKey" | "endKey">, locale: string): string {
  const format = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const start = keyToDate(entry.startKey);
  const end = keyToDate(entry.endKey);
  return entry.startKey === entry.endKey ? format.format(start) : format.formatRange(start, end);
}

/** "Herbstferien · 12.–24. Okt." */
export function schoolBreakText(entry: HolidayEntry, locale: string): string {
  return `${entry.title} · ${schoolBreakRange(entry, locale)}`;
}
