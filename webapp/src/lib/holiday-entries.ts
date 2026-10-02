import { getHolidays, type Holiday } from "@/lib/holidays";
import { toLocalDateKey } from "@/lib/local-date";

/**
 * Holidays as the event lists show them (RFC-014): the Events widget, the
 * week overview and the screensaver. Two sources, both all-day:
 *
 * - the public holidays of the family's region, from lib/holidays, named in
 *   the UI language -- days off only. Observances (Mother's Day, Halloween)
 *   and the marked-but-worked days the calendar dots (Christmas Eve) are left
 *   out: a list of what is coming up is not the place for a day nobody has off.
 * - the family's school holidays from `school_holidays`, typed in or synced
 *   from OpenHolidays, as one entry per break however many days it spans.
 *   A row the family hid is never shown.
 *
 * Pure, so the rules are specced without a browser; useHolidayEntries wires
 * them to the settings and the rows.
 */

export type HolidayEntryKind = "public" | "school";

export interface HolidayEntry {
  /** Never a real event id: `holiday:public:<day>` or `holiday:school:<row id>`. */
  id: string;
  kind: HolidayEntryKind;
  /** The name to show, already in the language it is shown in. */
  title: string;
  /** A public holiday's emoji; null for a school break. */
  emoji: string | null;
  /** First and last day, local `YYYY-MM-DD`, inclusive. Equal for a one-day holiday. */
  startKey: string;
  endKey: string;
}

export const HOLIDAY_ENTRY_PREFIX = "holiday:";

/** The `school_holidays` columns the lists need. */
export interface SchoolHolidayRowLike {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  hidden?: boolean | null;
}

/** An event as the de-duplication needs it: what useEvents returns. */
export interface EventLike {
  title: string;
  start_at: string;
  all_day?: boolean | null;
  calendar?: { is_holidays?: boolean | null } | null;
}

/** Local midnight of a `YYYY-MM-DD` key. */
export function keyToDate(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * A name reduced to compare it with another source's: case, accents,
 * punctuation and spacing ignored. "Tag der Deutschen Einheit" and
 * "tag der deutschen einheit." are the same holiday; "1. Weihnachtstag" and
 * "Erster Weihnachtstag" are not, which is why a holiday calendar wins on
 * the date alone (withoutDuplicateHolidays).
 */
export function normalizeHolidayName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The region's public holidays that are days off, between two keys inclusive. */
export function publicHolidayEntries(
  region: string,
  fromKey: string,
  toKey: string,
  locale: string,
  label: (holiday: Holiday) => string,
): HolidayEntry[] {
  const out: HolidayEntry[] = [];
  const seen = new Set<string>();
  for (let year = Number(fromKey.slice(0, 4)); year <= Number(toKey.slice(0, 4)); year++) {
    for (const holiday of getHolidays(region, year, locale)) {
      if (!holiday.dayOff) continue;
      const key = toLocalDateKey(holiday.date);
      if (key < fromKey || key > toKey || seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `${HOLIDAY_ENTRY_PREFIX}public:${key}`,
        kind: "public",
        title: label(holiday),
        emoji: holiday.emoji || null,
        startKey: key,
        endKey: key,
      });
    }
  }
  return out;
}

/**
 * School breaks that overlap the range, hidden rows left out. A break the
 * family has twice -- typed in and synced, same name and days -- is listed
 * once.
 */
export function schoolHolidayEntries(
  rows: readonly SchoolHolidayRowLike[],
  fromKey: string,
  toKey: string,
): HolidayEntry[] {
  const out: HolidayEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.hidden) continue;
    const startKey = row.starts_on.slice(0, 10);
    const endKey = (row.ends_on || row.starts_on).slice(0, 10);
    if (endKey < fromKey || startKey > toKey || endKey < startKey) continue;
    const name = row.name.trim();
    if (!name) continue;
    const identity = `${normalizeHolidayName(name)}|${startKey}|${endKey}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push({
      id: `${HOLIDAY_ENTRY_PREFIX}school:${row.id}`,
      kind: "school",
      title: name,
      emoji: null,
      startKey,
      endKey,
    });
  }
  return out;
}

export interface HolidayEntryInput {
  /** `calendar_display.showHolidays`: off, nothing is listed. */
  showHolidays: boolean;
  /** The family's holiday region; null shows no public holidays (school breaks still show). */
  region: string | null;
  schoolRows: readonly SchoolHolidayRowLike[] | null | undefined;
  fromKey: string;
  toKey: string;
  locale: string;
  label: (holiday: Holiday) => string;
}

/** Every holiday entry in the range, sorted by first day, public before school on a tie. */
export function holidayEntries(input: HolidayEntryInput): HolidayEntry[] {
  if (!input.showHolidays || input.toKey < input.fromKey) return [];
  const pub = input.region
    ? publicHolidayEntries(input.region, input.fromKey, input.toKey, input.locale, input.label)
    : [];
  const school = schoolHolidayEntries(input.schoolRows ?? [], input.fromKey, input.toKey);
  return [...pub, ...school].sort(
    (a, b) => a.startKey.localeCompare(b.startKey) || (a.kind === b.kind ? 0 : a.kind === "public" ? -1 : 1),
  );
}

/**
 * Entries a calendar already shows, dropped -- the calendar's own event
 * stays, since that is the one the family subscribed to and can open.
 *
 * - A public holiday goes when a calendar marked as a holiday calendar
 *   (`is_holidays`, e.g. Google's "Holidays in Germany") has an event that
 *   day, whatever it is called: sources name the same day differently
 *   ("1. Weihnachtstag" / "Erster Weihnachtstag"), so names would double up.
 * - Any entry goes when an event on its first day has the same name, after
 *   normalizeHolidayName -- a school-holiday feed added as a calendar.
 */
export function withoutDuplicateHolidays(
  entries: readonly HolidayEntry[],
  events: readonly EventLike[] | null | undefined,
): HolidayEntry[] {
  if (!events || events.length === 0) return [...entries];
  const holidayCalendarDays = new Set<string>();
  const namedDays = new Set<string>();
  for (const event of events) {
    const day = toLocalDateKey(new Date(event.start_at));
    if (event.calendar?.is_holidays) holidayCalendarDays.add(day);
    namedDays.add(`${day}|${normalizeHolidayName(event.title)}`);
  }
  return entries.filter((entry) => {
    if (entry.kind === "public" && holidayCalendarDays.has(entry.startKey)) return false;
    return !namedDays.has(`${entry.startKey}|${normalizeHolidayName(entry.title)}`);
  });
}

/** True when the entry covers the day. */
export function entryCoversDay(entry: HolidayEntry, dayKey: string): boolean {
  return entry.startKey <= dayKey && dayKey <= entry.endKey;
}

/**
 * The day a list files the entry under: its first day, or `todayKey` for a
 * break already under way -- it is still on, so it belongs with today.
 */
export function entryListDay(entry: HolidayEntry, todayKey: string): Date {
  return keyToDate(entry.startKey < todayKey ? todayKey : entry.startKey);
}

/** Amber, the colour the calendar gives holidays (Tailwind amber-400). */
export const HOLIDAY_COLOR = "#fbbf24";

/** date-fns pattern for "Fri, Oct 24" in the UI language: the day a break ends. */
export function holidayEndPattern(locale: string): string {
  if (locale === "de") return "EEE d. MMM";
  if (locale === "en") return "EEE, MMM d";
  return "EEE d MMM";
}
