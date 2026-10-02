import Holidays, { type HolidayKind } from "date-holidays-parser";
import { differenceInCalendarDays } from "date-fns";
import data from "./data/holidays.json";
import type { Holiday } from "./types";
import { resolveRegion } from "./region";
import { CURATED } from "./curated";
import { overrideFor, PUBLIC_HOLIDAYS_KEEP_SCHOOL_OPEN } from "./overrides";

/**
 * date-holidays, mapped onto #319's concepts (RFC-014 §4.4). Synchronous and
 * memoised, so the calendar and the widget keep calling it on render, on the
 * client, exactly as they called the hand-written lists.
 */

/** One date-holidays day for a region and year, mapped. */
export interface MappedDay {
  holiday: Holiday;
  englishName: string;
  type: HolidayKind;
  /** Returned by getHolidays: the calendar marks it. */
  inCalendar: boolean;
  /** Returned by getObservances: only the countdown lists it. */
  isObservance: boolean;
}

export interface RegionYear {
  /** Every day of the year that is not a substitute, mapped; flags say who shows it. */
  days: MappedDay[];
  /** date-holidays' "(substitute day)" entries: the weekday a holiday is taken instead. */
  substitutes: { englishName: string; date: Date }[];
}

const SUBSTITUTE_SUFFIX = / \(substitute day\)$/;

/**
 * The memo caches below live as long as the server process. The Integration
 * API's `/schedule?day=` lets a token holder ask for any year, and each new
 * one would add an entry for good, so the two keyed by something a caller
 * picks are capped: past the cap the oldest entry goes. A dropped entry is
 * only recomputed.
 */
export const MAX_CACHED_YEARS = 500;
export const MAX_CACHED_PARSERS = 200;

function remember<K, V>(cache: Map<K, V>, key: K, value: V, max: number): void {
  // A Map iterates in insertion order: re-inserting moves the key to the end.
  if (cache.has(key)) cache.delete(key);
  else if (cache.size >= max) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
}

/** For the specs: how many entries the capped caches hold. */
export function cachedSizes(): { years: number; parsers: number } {
  return { years: years.size, parsers: parsers.size };
}

const parsers = new Map<string, Holidays>();

function parser(country: string, state: string | null, languages: string[]): Holidays {
  const key = `${country}|${state ?? ""}|${languages.join(",")}`;
  let p = parsers.get(key);
  if (!p) {
    p = state
      ? new Holidays(data, country, state, { languages })
      : new Holidays(data, country, { languages });
    // Local dates only. The parser otherwise defaults to the country's first
    // timezone and runs every date through moment-timezone, which is both a
    // timezone dependency §4.1 forbids and ~730 KB the browser need not load.
    p.setTimezone(undefined);
    remember(parsers, key, p, MAX_CACHED_PARSERS);
  }
  return p;
}

/** "2026-12-24 14:00:00" as local midnight of 24 December 2026. Never h.start. */
export function localDay(dateString: string): Date {
  const [y, m, d] = dateString.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

const SUNDAY_PROBE = Array.from({ length: 28 }, (_, i) => 2001 + i);
const sundayNames = new Map<string, ReadonlySet<string>>();

/**
 * Is this holiday only ever a Sunday -- Easter, Whit Sunday, the Swiss
 * Bettag? Probed over a full 28-year weekday cycle; two occurrences at
 * least, so a one-off that lands on a Sunday does not count (plan ruling 11).
 * The 28 years are parsed once per region, for every name at once.
 */
function alwaysSunday(country: string, state: string | null, englishName: string): boolean {
  const key = `${country}|${state ?? ""}`;
  let names = sundayNames.get(key);
  if (!names) {
    const p = parser(country, state, ["en"]);
    const seen = new Map<string, { count: number; allSunday: boolean }>();
    for (const y of SUNDAY_PROBE) {
      for (const h of p.getHolidays(y)) {
        if (h.substitute) continue;
        const entry = seen.get(h.name) ?? { count: 0, allSunday: true };
        entry.count += 1;
        entry.allSunday &&= localDay(h.date).getDay() === 0;
        seen.set(h.name, entry);
      }
    }
    names = new Set([...seen].filter(([, e]) => e.count >= 2 && e.allSunday).map(([name]) => name));
    sundayNames.set(key, names);
  }
  return names.has(englishName);
}

const years = new Map<string, RegionYear>();

/**
 * A region's year, mapped. Null for a region Kinboard does not offer --
 * which callers treat as "no holidays", never as somebody else's.
 * `locale` only changes `holiday.name`.
 */
export function regionYear(region: string, year: number, locale: string = "en"): RegionYear | null {
  const resolved = resolveRegion(region);
  if (!resolved) return null;
  const cacheKey = `${resolved.code}|${year}|${locale}`;
  const cached = years.get(cacheKey);
  if (cached) {
    // Most recently used goes last, so the cap drops years nobody asks for.
    remember(years, cacheKey, cached, MAX_CACHED_YEARS);
    return cached;
  }

  const { country, state } = resolved;
  const english = parser(country, state, ["en"]).getHolidays(year);
  const shown = locale === "en" ? english : parser(country, state, [locale, "en"]).getHolidays(year);
  const displayName = new Map(shown.map((h) => [`${h.date}|${h.rule}`, h.name]));
  const curated = CURATED[country];

  const days: MappedDay[] = [];
  const substitutes: RegionYear["substitutes"] = [];
  for (const h of english) {
    if (h.substitute) {
      substitutes.push({ englishName: h.name.replace(SUBSTITUTE_SUFFIX, ""), date: localDay(h.date) });
      continue;
    }
    const date = localDay(h.date);
    const override = overrideFor(country, h.name);
    const marked =
      curated !== undefined && (h.type === "school" || curated.marked.includes(h.name) || override?.marked === true);
    const inCalendar = h.type === "public" || marked;
    const isObservance = !inCalendar && curated !== undefined && curated.observances.includes(h.name);

    let dayOff = h.type === "public" && !(date.getDay() === 0 && alwaysSunday(country, state, h.name));
    if (override?.dayOff !== undefined) {
      dayOff = typeof override.dayOff === "function" ? override.dayOff(year) : override.dayOff;
    }
    if (isObservance) dayOff = false;

    const names = curated?.names[h.name];
    days.push({
      englishName: h.name,
      type: h.type,
      inCalendar,
      isObservance,
      holiday: {
        nameKey: names?.nameKey ?? "",
        name: displayName.get(`${h.date}|${h.rule}`) ?? h.name,
        date,
        emoji: names?.emoji ?? "📅",
        dayOff,
      },
    });
  }

  const result: RegionYear = { days, substitutes };
  remember(years, cacheKey, result, MAX_CACHED_YEARS);
  return result;
}

/**
 * The weekday each day off in `holidays` (all of `year`) is taken on instead,
 * from date-holidays' substitute days: a US federal holiday on a Saturday on
 * the Friday before, a UK bank holiday on a weekend on the next free weekday.
 * Searched in the years either side too, so New Year's Day 2028 pairs with
 * Friday 31 December 2027. Replaces #319's hand-coded observedDays.
 */
export function observedDays(
  region: string,
  year: number,
  holidays: readonly Holiday[],
  locale: string = "en",
): Map<Holiday, Date> {
  const out = new Map<Holiday, Date>();
  const current = regionYear(region, year, locale);
  if (!current) return out;
  const englishOf = new Map(current.days.map((d) => [d.holiday, d.englishName]));
  const substitutes = [year - 1, year, year + 1].flatMap((y) => regionYear(region, y, locale)?.substitutes ?? []);
  for (const holiday of holidays) {
    if (!holiday.dayOff) continue;
    const name = englishOf.get(holiday);
    if (name === undefined) continue;
    const sub = substitutes.find(
      (s) => s.englishName === name && Math.abs(differenceInCalendarDays(s.date, holiday.date)) <= 7,
    );
    if (sub) out.set(holiday, sub.date);
  }
  return out;
}

const stateNames = new Map<string, Record<string, string>>();

/** State/canton names as date-holidays gives them in `locale` ("Kanton Zürich", "Wien"). */
export function subdivisionNames(country: string, locale: string): Record<string, string> {
  const key = `${country}|${locale}`;
  let names = stateNames.get(key);
  if (!names) {
    names = new Holidays(data).getStates(country, locale) ?? {};
    stateNames.set(key, names);
  }
  return names;
}

/**
 * The word date-holidays puts in front of a state's name: "Kanton Zürich",
 * "Canton d'Uri", "Canton of Bern", "Hansestadt Bremen", "Land Salzburg",
 * "Département Moselle". Sorted with it, every canton starts with the same
 * word, so the list is out of order ("Canton d'Uri" before "Canton de Bâle")
 * and a select's type-to-search finds nothing.
 */
const STATE_PREFIX =
  /^(?:(?:Kanton|Canton (?:of|des|de|du)|Hansestadt|Land|Département(?: et région d'outre-mer)?)\s+|Canton d['’])/u;

/** "Kanton Zürich" → "Zürich". A name that is only the prefix is kept as it is. */
export function subdivisionLabel(name: string): string {
  const stripped = name.replace(STATE_PREFIX, "");
  return stripped.length > 0 ? stripped : name;
}

/** `states` of `country` (pass `subdivisionsOf(country)`), named in `locale` without the prefix, in that locale's alphabetical order. */
export function subdivisionOptions(
  country: string,
  states: readonly string[],
  locale: string,
): { code: string; name: string }[] {
  const names = subdivisionNames(country, locale);
  return states
    .map((code) => ({ code, name: names[code] ? subdivisionLabel(names[code]) : code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/**
 * The days a region has no school because of a public holiday (RFC-014
 * §6.3): every day off, the weekday a day off is taken instead, and every
 * date-holidays `school` day (Buß- und Bettag in Bavaria, Good Friday in the
 * Netherlands), shown on the calendar or not. None in the US.
 */
export function schoolClosures(region: string, year: number, locale: string = "en"): { date: Date; holiday: Holiday }[] {
  const resolved = resolveRegion(region);
  if (!resolved || PUBLIC_HOLIDAYS_KEEP_SCHOOL_OPEN.includes(resolved.country)) return [];
  const current = regionYear(region, year, locale);
  if (!current) return [];
  const out: { date: Date; holiday: Holiday }[] = [];
  for (const day of current.days) {
    if (day.holiday.dayOff || day.type === "school") out.push({ date: day.holiday.date, holiday: day.holiday });
  }
  const daysOff = current.days.filter((d) => d.holiday.dayOff).map((d) => d.holiday);
  for (const [holiday, date] of observedDays(region, year, daysOff, locale)) out.push({ date, holiday });
  return out;
}
