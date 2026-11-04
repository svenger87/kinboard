/**
 * Festivals on Home and the screensaver (RFC-020): which festivals there are,
 * the days each one is decorated, which are pre-ticked in which country, and
 * which one is on right now. Pure, and the same in the browser and on the
 * server; the scene that draws them is components/weather-effects.tsx, the
 * setting is lib/festival-settings.ts.
 *
 * The dates come from here, not from the holiday region data (RFC-020 §3):
 * the region data has no Lunar New Year, Diwali or Hanukkah, and a family in
 * Hamburg may celebrate Eid. Every rule is computed without a network call:
 * fixed days, Easter's computus (Gregorian and Julian), weekday rules, the
 * `Intl` calendars (hebrew, persian), and tables where those won't do: the
 * Chinese and Umm al-Qura days, which `Intl` gets a day wrong in some years,
 * Diwali and Holi, whose Hindu lunisolar calendar `Intl` does not have, and
 * the per-country days (national days, Mother's and Father's Day), each
 * checked against the region data or a published table by
 * e2e/festivals.spec.ts, and every year to 2045 against calendar libraries
 * that don't use ICU by e2e/festival-reference-dates.spec.ts.
 *
 * A day is the family's day: `activeFestival` takes the family's time zone,
 * so a wall display in Berlin and a phone in New York agree on when Christmas
 * starts in that family's house.
 */

import { addDays } from "@/lib/local-date";

export const FESTIVALS = [
  "christmas",
  "new-years-eve",
  "easter",
  "orthodox-easter",
  "halloween",
  "dia-de-muertos",
  "thanksgiving",
  "carnival",
  "st-nicholas",
  "st-martin",
  "st-patricks",
  "midsummer",
  "lunar-new-year",
  "eid-al-fitr",
  "eid-al-adha",
  "hanukkah",
  "passover",
  "nowruz",
  "diwali",
  "valentines",
  // §3.3's kits, beyond §3.1's table.
  "yalda",
  "three-kings",
  "orthodox-christmas",
  "ramadan",
  "purim",
  "holi",
  "kings-day",
  "mothers-day",
  "fathers-day",
  "dragon-boat",
  "national-day",
  "mid-autumn",
  "sukkot",
] as const;
export type FestivalId = (typeof FESTIVALS)[number];

export function isFestival(v: unknown): v is FestivalId {
  return typeof v === "string" && (FESTIVALS as readonly string[]).includes(v);
}

/** The days a festival is decorated, first and last, as `YYYY-MM-DD` in the family's zone. */
export interface FestivalWindow {
  start: string;
  end: string;
  /**
   * When the visitor may fly (§3.3). `dusk`: from dusk on the first day (St
   * Martin's lantern walk; a national day's fireworks in the evening).
   * `midnight`: from the family's midnight into the last day (New Year's
   * Eve's fireworks), and in the last minutes before it, so the first rocket
   * goes up on the stroke. The festival itself -- the wash, the dressing -- is
   * on all day.
   */
  visitorFrom?: "dusk" | "midnight";
  /** The last day ends this many minutes after its midnight, not at its end: New Year's Eve, at 00:30. */
  endsAt?: number;
  /** Dusk, when the weather has no sunset: Ramadan's evening is 18:00 (§3.3), the others' 17:00. */
  duskFallback?: number;
}

/* ---------------------------------------------------------------- the pre-tick table (§3.1) */

/** The 38 countries Kinboard offers (RFC-014), as lib/holidays/data/offered.json lists them. */
const EASTER_ORTHODOX = new Set(["RS", "BG", "RO", "MD", "BY"]);

/**
 * The festivals common across a whole country: pre-ticked for a family there
 * (the owner's rule, RFC-020 §3.1). Reviewed whenever a region is added; a
 * spec holds it against the offered list. A religious or cultural festival
 * common only to a community within a country (Eid, Hanukkah, Diwali, Lunar
 * New Year...) is never assumed: a family ticks it.
 *
 * Mother's and Father's Day are never pre-ticked either, though every
 * country keeps them: which parents a family has is the family's to say.
 */
const COMMON: Readonly<Record<FestivalId, ReadonlySet<string> | "all">> = {
  christmas: "all",
  "new-years-eve": "all",
  // All but the five Orthodox countries, which get Orthodox Easter instead.
  easter: "all",
  "orthodox-easter": EASTER_ORTHODOX,
  halloween: new Set(["US", "GB", "IE"]),
  "dia-de-muertos": new Set(["MX"]),
  thanksgiving: new Set(["US"]),
  carnival: new Set(["BR"]),
  "st-nicholas": new Set(["NL", "BE", "LU", "DE", "AT", "CH", "CZ", "SK", "PL"]),
  "st-martin": new Set(["DE", "NL", "AT", "CH"]),
  "st-patricks": new Set(["IE"]),
  midsummer: new Set(["SE", "EE", "LV", "LT"]),
  "lunar-new-year": new Set(),
  "eid-al-fitr": new Set(),
  "eid-al-adha": new Set(),
  hanukkah: new Set(),
  passover: new Set(),
  nowruz: new Set(),
  diwali: new Set(),
  valentines: new Set(),
  yalda: new Set(),
  // Día de Reyes: the parade on the eve, the presents in the morning (§3.3: ES, MX).
  "three-kings": new Set(["ES", "MX"]),
  // Where Christmas Day is 7 January in law, as the region data has it. Bulgaria
  // and Romania keep the revised Julian calendar: their Christmas is 25 December.
  "orthodox-christmas": new Set(["RS", "MD", "BY"]),
  ramadan: new Set(),
  purim: new Set(),
  holi: new Set(),
  "kings-day": new Set(["NL"]),
  "mothers-day": new Set(),
  "fathers-day": new Set(),
  "dragon-boat": new Set(),
  // Every country with a national day of its own (NATIONAL_DAY).
  "national-day": "all",
  "mid-autumn": new Set(),
  sukkot: new Set(),
};

/**
 * The festivals pre-ticked for a family in `country` (ISO 3166-1, or a region
 * code such as `DE-NI`, whose country counts). With no country -- a family
 * that hasn't picked a holiday region yet -- the ones pre-ticked in every
 * offered country: Christmas and New Year's Eve.
 */
export function commonFestivals(country: string | null | undefined): FestivalId[] {
  const cc = countryOf(country);
  return FESTIVALS.filter((id) => {
    const where = COMMON[id];
    if (id === "easter") return cc === null ? false : !EASTER_ORTHODOX.has(cc);
    if (id === "national-day") return cc !== null && cc in NATIONAL_DAY;
    if (where === "all") return true;
    return cc !== null && where.has(cc);
  });
}

/** The country of a region code (`DE-NI` is DE), upper-case, or null. */
const countryOf = (country: string | null | undefined): string | null =>
  typeof country === "string" && country.length >= 2 ? country.slice(0, 2).toUpperCase() : null;

/* ---------------------------------------------------------------- per-country days */

/**
 * Each offered country's national day, `MM-DD` (§3.3: fireworks in the
 * evening). From the region data: e2e/festivals.spec.ts finds each one there,
 * on the day or the day it moves to. Not here: Great Britain, which keeps none;
 * Ireland, whose day is St Patrick's; the Netherlands, whose is King's Day.
 * Mexico's begins on the eve, with the Grito and its fireworks on the night of
 * the 15th.
 */
export const NATIONAL_DAY: Readonly<Record<string, string>> = {
  AD: "09-08",
  AL: "11-28",
  AT: "10-26",
  BE: "07-21",
  BG: "03-03",
  BR: "09-07",
  BY: "07-03",
  CH: "08-01",
  CZ: "10-28",
  DE: "10-03",
  EE: "02-24",
  ES: "10-12",
  FR: "07-14",
  HR: "05-30",
  HU: "08-20",
  IT: "06-02",
  // The Staatsfeiertag. The region data leaves it out (it has Liechtenstein's
  // church holidays only), so the spec lets this one through by name.
  LI: "08-15",
  LT: "02-16",
  LU: "06-23",
  LV: "11-18",
  MC: "11-19",
  MD: "08-27",
  MT: "09-21",
  MX: "09-16",
  PL: "11-11",
  PT: "06-10",
  RO: "12-01",
  RS: "02-15",
  SE: "06-06",
  SI: "06-25",
  // 1 January, the Day of the Establishment of the Slovak Republic: after New Year's Eve's fireworks.
  SK: "01-01",
  SM: "09-03",
  US: "07-04",
  VA: "02-11",
  ZA: "04-27",
};

/**
 * A day as a rule: a fixed `MM-DD`, the `n`th (or, with -1, the last) given
 * weekday of a month, or so many days from Western Easter.
 */
type DayRule =
  | { fixed: string }
  | { month: number; weekday: number; nth: number }
  | { easter: number }
  // France's Mother's Day: the last Sunday of May, or the first of June when that is Pentecost.
  | { lastSundayOfMayUnlessPentecost: true };

const SUN = 0;
const SECOND_SUNDAY_OF_MAY: DayRule = { month: 5, weekday: SUN, nth: 2 };
const THIRD_SUNDAY_OF_JUNE: DayRule = { month: 6, weekday: SUN, nth: 3 };
const ST_JOSEPH: DayRule = { fixed: "03-19" };
const WOMENS_DAY: DayRule = { fixed: "03-08" };

/**
 * Mother's Day by country (§3.3: "else a per-country rule"). From Wikipedia's
 * table of dates by country (read 2026-11-03), and the region data for the US,
 * which has it. Where the table names International Women's Day, that is the
 * day. Monaco, San Marino and the Vatican aren't in the table: they follow
 * France and Italy, whose calendars they share. No country: the second Sunday
 * of May, the most common rule.
 */
export const MOTHERS_DAY: Readonly<Record<string, DayRule>> = {
  AD: { month: 5, weekday: SUN, nth: 1 },
  AL: WOMENS_DAY,
  AT: SECOND_SUNDAY_OF_MAY,
  BE: SECOND_SUNDAY_OF_MAY,
  BG: WOMENS_DAY,
  BR: SECOND_SUNDAY_OF_MAY,
  BY: WOMENS_DAY,
  CH: SECOND_SUNDAY_OF_MAY,
  CZ: SECOND_SUNDAY_OF_MAY,
  DE: SECOND_SUNDAY_OF_MAY,
  EE: SECOND_SUNDAY_OF_MAY,
  ES: { month: 5, weekday: SUN, nth: 1 },
  FR: { lastSundayOfMayUnlessPentecost: true },
  // Mothering Sunday, the fourth Sunday of Lent: three weeks before Easter.
  GB: { easter: -21 },
  HR: SECOND_SUNDAY_OF_MAY,
  HU: { month: 5, weekday: SUN, nth: 1 },
  IE: { easter: -21 },
  IT: SECOND_SUNDAY_OF_MAY,
  LI: SECOND_SUNDAY_OF_MAY,
  LT: { month: 5, weekday: SUN, nth: 1 },
  LU: { month: 6, weekday: SUN, nth: 2 },
  LV: SECOND_SUNDAY_OF_MAY,
  MC: { lastSundayOfMayUnlessPentecost: true },
  MD: WOMENS_DAY,
  MT: SECOND_SUNDAY_OF_MAY,
  MX: { fixed: "05-10" },
  NL: SECOND_SUNDAY_OF_MAY,
  PL: { fixed: "05-26" },
  PT: { month: 5, weekday: SUN, nth: 1 },
  RO: { month: 5, weekday: SUN, nth: 1 },
  RS: WOMENS_DAY,
  SE: { month: 5, weekday: SUN, nth: -1 },
  SI: { fixed: "03-25" },
  SK: SECOND_SUNDAY_OF_MAY,
  SM: SECOND_SUNDAY_OF_MAY,
  US: SECOND_SUNDAY_OF_MAY,
  VA: SECOND_SUNDAY_OF_MAY,
  ZA: SECOND_SUNDAY_OF_MAY,
};

/**
 * Father's Day by country, from the same table (Wikipedia, read 2026-11-03)
 * and the region data for the US. Moldova and Serbia aren't in the table and
 * keep no common day: none there. Monaco, San Marino and the Vatican follow
 * France and Italy. No country: the third Sunday of June, the most common.
 */
export const FATHERS_DAY: Readonly<Record<string, DayRule | null>> = {
  AD: ST_JOSEPH,
  AL: THIRD_SUNDAY_OF_JUNE,
  AT: { month: 6, weekday: SUN, nth: 2 },
  BE: { month: 6, weekday: SUN, nth: 2 },
  BG: { fixed: "12-26" },
  BR: { month: 8, weekday: SUN, nth: 2 },
  BY: { fixed: "10-21" },
  CH: { month: 6, weekday: SUN, nth: 1 },
  CZ: THIRD_SUNDAY_OF_JUNE,
  // Vatertag is Ascension Day, Easter + 39.
  DE: { easter: 39 },
  EE: { month: 11, weekday: SUN, nth: 2 },
  ES: ST_JOSEPH,
  FR: THIRD_SUNDAY_OF_JUNE,
  GB: THIRD_SUNDAY_OF_JUNE,
  HR: ST_JOSEPH,
  HU: THIRD_SUNDAY_OF_JUNE,
  IE: THIRD_SUNDAY_OF_JUNE,
  IT: ST_JOSEPH,
  LI: ST_JOSEPH,
  LT: { month: 6, weekday: SUN, nth: 1 },
  LU: { month: 10, weekday: SUN, nth: 1 },
  LV: { month: 9, weekday: SUN, nth: 2 },
  MC: THIRD_SUNDAY_OF_JUNE,
  MD: null,
  MT: THIRD_SUNDAY_OF_JUNE,
  MX: THIRD_SUNDAY_OF_JUNE,
  NL: THIRD_SUNDAY_OF_JUNE,
  PL: { fixed: "06-23" },
  PT: ST_JOSEPH,
  RO: { month: 5, weekday: SUN, nth: 2 },
  RS: null,
  SE: { month: 11, weekday: SUN, nth: 2 },
  SI: THIRD_SUNDAY_OF_JUNE,
  SK: THIRD_SUNDAY_OF_JUNE,
  SM: ST_JOSEPH,
  US: THIRD_SUNDAY_OF_JUNE,
  VA: ST_JOSEPH,
  ZA: THIRD_SUNDAY_OF_JUNE,
};

/* ---------------------------------------------------------------- date rules */

const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The weekday of a calendar date: 0 Sunday ... 6 Saturday. */
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** Easter Sunday, Gregorian (the anonymous Gregorian algorithm, "Meeus/Jones/Butcher"). */
export function westernEaster(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/**
 * Easter Sunday by the Julian computus (Meeus), as a Gregorian date: the
 * Julian calendar runs 13 days behind from 1900 to 2099.
 */
export function orthodoxEaster(year: number): string {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const drift = Math.floor(year / 100) - Math.floor(year / 400) - 2;
  return addDays(iso(year, month, day), drift);
}

/** The first Sunday of Advent: the fourth Sunday before Christmas, 27 Nov to 3 Dec. */
export function firstAdvent(year: number): string {
  const nov27 = iso(year, 11, 27);
  return addDays(nov27, (7 - weekday(nov27)) % 7);
}

/** The `n`th given weekday (0 Sunday) of a month; `n` -1 is the last. */
function nthWeekday(year: number, month: number, dow: number, n: number): string {
  if (n < 0) {
    const next = iso(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1);
    const last = addDays(next, -1);
    return addDays(last, -((weekday(last) - dow + 7) % 7));
  }
  const first = iso(year, month, 1);
  return addDays(first, ((dow - weekday(first) + 7) % 7) + (n - 1) * 7);
}

/** Julian 25 December as a Gregorian date: 7 January from 1901 to 2100. */
export function orthodoxChristmas(year: number): string {
  // The Julian calendar's lag on 25 December of the year before.
  const y = year - 1;
  const drift = Math.floor(y / 100) - Math.floor(y / 400) - 2;
  return addDays(iso(y, 12, 25), drift);
}

/** A per-country day rule in `year`. */
function onDay(rule: DayRule, year: number): string {
  if ("fixed" in rule) return `${year}-${rule.fixed}`;
  if ("easter" in rule) return addDays(westernEaster(year), rule.easter);
  if ("lastSundayOfMayUnlessPentecost" in rule) {
    const last = nthWeekday(year, 5, SUN, -1);
    return last === addDays(westernEaster(year), 49) ? addDays(last, 7) : last;
  }
  return nthWeekday(year, rule.month, rule.weekday, rule.nth);
}

/* ---------------------------------------------------------------- Intl calendars (§3.1) */

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * A Gregorian day in another calendar: its month (a number, or for the
 * Hebrew calendar its English name) and day of the month. `null` where the
 * browser has no such calendar: a missing calendar silently gives no
 * festival, never an error (RFC-020 §3.1 asks for WebKit to be checked).
 */
function inCalendar(day: string, calendar: string): { month: string; day: number } | null {
  let f = formatters.get(calendar);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(`en-US-u-ca-${calendar}`, {
        timeZone: "UTC",
        month: calendar === "hebrew" ? "long" : "numeric",
        day: "numeric",
      });
    } catch {
      return null;
    }
    if (f.resolvedOptions().calendar !== calendar) return null;
    formatters.set(calendar, f);
  }
  const parts = f.formatToParts(new Date(`${day}T12:00:00Z`));
  const month = parts.find((p) => p.type === "month")?.value;
  const d = Number(parts.find((p) => p.type === "day")?.value);
  return month && Number.isFinite(d) ? { month, day: d } : null;
}

/** Every Gregorian day from `from` to `to` that is `month` (or one of `month`)/`day` in `calendar`. */
function findIn(calendar: string, month: string | readonly string[], day: number, from: string, to: string): string[] {
  const months = typeof month === "string" ? [month] : month;
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const c = inCalendar(d, calendar);
    if (c && months.includes(c.month) && c.day === day) out.push(d);
  }
  return out;
}

/**
 * Diwali's main day (Lakshmi Puja), which `Intl` cannot compute: its
 * `indian` calendar is the solar Śaka one, not the Hindu lunisolar calendar
 * (RFC-020 §3.2). A spec fails once fewer than two years are left in it, so
 * it is topped up long before it runs out.
 */
export const DIWALI: Readonly<Record<number, string>> = {
  2026: "2026-11-08",
  2027: "2027-10-29",
  2028: "2028-10-17",
  2029: "2029-11-05",
  2030: "2030-10-26",
  2031: "2031-11-14",
  2032: "2032-11-02",
  2033: "2033-10-22",
  2034: "2034-11-10",
  2035: "2035-10-30",
  2036: "2036-10-19",
};

/**
 * Holi, the day of colours (Rangwali Holi, the day after Holika Dahan): the
 * same lunisolar calendar as Diwali, so a table too, with the same reminder.
 * Checked on 2026-11-03 against prokerala, calendarlabs, publicholidays.in
 * and officeholidays; 2029 and 2030 against prokerala's table alone. Some
 * states keep it a day earlier in some years (2026), and one source has 2027
 * a day later: the window takes in the eve, so the colours are up either way.
 */
export const HOLI: Readonly<Record<number, string>> = {
  2026: "2026-03-04",
  2027: "2027-03-22",
  2028: "2028-03-11",
  2029: "2029-03-01",
  2030: "2030-03-20",
};

/**
 * The Chinese and the Islamic (Umm al-Qura) calendars' days, as tables: the
 * browsers' `Intl` calendars get some of them a day wrong. ICU puts Lunar
 * New Year 2027 on 7 February and 2030 on 2 February, where the new moon
 * falls minutes either side of Beijing's midnight (published: 6 and 3
 * February), and its islamic-umalqura drifts a day from the published Umm
 * al-Qura tables from 2031 (Ramadan 1453 on 16 December, published 15). An
 * older browser on a wall display may hold older ICU data again. Written by
 * scripts/festival-reference-dates.py from lunardate (the Hong Kong
 * Observatory's tables) and hijridate (Umm al-Qura as published), spot-checked
 * against published calendars on 2026-11-04. Many families keep the Islamic
 * days by the moon's sighting, a day either side; the windows are wide
 * enough that the decorations are up either way. A spec fails two years
 * before a table runs out.
 */
/** The first day of the first month. */
export const LUNAR_NEW_YEAR: readonly string[] = [
  "2026-02-17", "2027-02-06", "2028-01-26", "2029-02-13", "2030-02-03",
  "2031-01-23", "2032-02-11", "2033-01-31", "2034-02-19", "2035-02-08",
  "2036-01-28", "2037-02-15", "2038-02-04", "2039-01-24", "2040-02-12",
  "2041-02-01", "2042-01-22", "2043-02-10", "2044-01-30", "2045-02-17",
];

/** The fifth day of the fifth month. */
export const DRAGON_BOAT: readonly string[] = [
  "2026-06-19", "2027-06-09", "2028-05-28", "2029-06-16", "2030-06-05",
  "2031-06-24", "2032-06-12", "2033-06-01", "2034-06-20", "2035-06-10",
  "2036-05-30", "2037-06-18", "2038-06-07", "2039-05-27", "2040-06-14",
  "2041-06-03", "2042-06-22", "2043-06-11", "2044-05-31", "2045-06-19",
];

/** The fifteenth day of the eighth month. */
export const MID_AUTUMN: readonly string[] = [
  "2026-09-25", "2027-09-15", "2028-10-03", "2029-09-22", "2030-09-12",
  "2031-10-01", "2032-09-19", "2033-09-08", "2034-09-27", "2035-09-16",
  "2036-10-04", "2037-09-24", "2038-09-13", "2039-10-02", "2040-09-20",
  "2041-09-10", "2042-09-28", "2043-09-17", "2044-10-05", "2045-09-25",
];

/** Ramadan 1. Some years have two. */
export const RAMADAN: readonly string[] = [
  "2026-02-18", "2027-02-08", "2028-01-28", "2029-01-16", "2030-01-05",
  "2030-12-26", "2031-12-15", "2032-12-04", "2033-11-23", "2034-11-12",
  "2035-11-01", "2036-10-20", "2037-10-10", "2038-09-30", "2039-09-19",
  "2040-09-07", "2041-08-28", "2042-08-17", "2043-08-06", "2044-07-26",
  "2045-07-15",
];

/** Shawwal 1. Some years have two. */
export const EID_AL_FITR: readonly string[] = [
  "2026-03-20", "2027-03-09", "2028-02-26", "2029-02-14", "2030-02-04",
  "2031-01-24", "2032-01-14", "2033-01-02", "2033-12-23", "2034-12-12",
  "2035-12-01", "2036-11-19", "2037-11-08", "2038-10-29", "2039-10-19",
  "2040-10-07", "2041-09-26", "2042-09-15", "2043-09-04", "2044-08-24",
  "2045-08-14",
];

/** Dhu al-Hijjah 10. */
export const EID_AL_ADHA: readonly string[] = [
  "2026-05-27", "2027-05-16", "2028-05-05", "2029-04-24", "2030-04-13",
  "2031-04-02", "2032-03-22", "2033-03-11", "2034-03-01", "2035-02-18",
  "2036-02-07", "2037-01-26", "2038-01-16", "2039-01-05", "2039-12-26",
  "2040-12-14", "2041-12-04", "2042-11-23", "2043-11-12", "2044-10-31",
  "2045-10-21",
];

/** The days of `table` in `year`. */
const inYear = (table: readonly string[], year: number) => table.filter((d) => d.startsWith(`${year}-`));

/* ---------------------------------------------------------------- windows */

const span = (start: string, days: number): FestivalWindow => ({ start, end: addDays(start, days - 1) });

/**
 * The windows of `id` that start in `year`, in the family's calendar days.
 * Usually one; an Islamic festival, eleven days earlier each year, falls
 * twice in a Gregorian year about every 33 years. Christmas starts in one
 * year and ends in the next. `country` matters for the per-country days:
 * Midsummer (a fixed eve in the Baltics, the Friday between 19 and 25 June in
 * Sweden), the national day, and Mother's and Father's Day.
 */
export function festivalDates(id: FestivalId, year: number, country?: string | null): FestivalWindow[] {
  const cc = countryOf(country);
  switch (id) {
    case "christmas":
      return [{ start: firstAdvent(year), end: iso(year + 1, 1, 6) }];
    case "new-years-eve":
      // The day, and the first half hour of the next: the fireworks are at the family's midnight.
      return [{ start: iso(year, 12, 31), end: iso(year + 1, 1, 1), endsAt: 30, visitorFrom: "midnight" }];
    case "easter": {
      const sunday = westernEaster(year);
      return [{ start: addDays(sunday, -7), end: addDays(sunday, 1) }];
    }
    case "orthodox-easter": {
      const sunday = orthodoxEaster(year);
      return [{ start: addDays(sunday, -7), end: addDays(sunday, 1) }];
    }
    case "halloween":
      return [{ start: iso(year, 10, 24), end: iso(year, 10, 31) }];
    case "dia-de-muertos":
      return [{ start: iso(year, 10, 31), end: iso(year, 11, 2) }];
    case "thanksgiving":
      // The fourth Thursday of November and its weekend.
      return [span(nthWeekday(year, 11, 4, 4), 4)];
    case "carnival": {
      // The week up to Shrove Tuesday, Easter - 47 days (Ash Wednesday is - 46).
      const shroveTuesday = addDays(westernEaster(year), -47);
      return [{ start: addDays(shroveTuesday, -6), end: shroveTuesday }];
    }
    case "st-nicholas":
      return [{ start: iso(year, 12, 5), end: iso(year, 12, 6) }];
    case "st-martin":
      return [{ ...span(iso(year, 11, 11), 1), visitorFrom: "dusk" }];
    case "st-patricks":
      return [span(iso(year, 3, 17), 1)];
    case "midsummer": {
      if (cc === "SE") {
        // Midsummer Eve is the Friday between 19 and 25 June; the day is the Saturday.
        const jun19 = iso(year, 6, 19);
        return [span(addDays(jun19, (5 - weekday(jun19) + 7) % 7), 2)];
      }
      // Jaanipäev, Jāņi, Joninės: the eve on 23 June, the day on the 24th.
      return [span(iso(year, 6, 23), 2)];
    }
    case "lunar-new-year":
      // From the eve to the Lantern Festival, the 15th day.
      return inYear(LUNAR_NEW_YEAR, year).map((d) => ({ start: addDays(d, -1), end: addDays(d, 14) }));
    case "eid-al-fitr":
      // Shawwal 1, three days.
      return inYear(EID_AL_FITR, year).map((d) => span(d, 3));
    case "eid-al-adha":
      // Dhu al-Hijjah 10, four days.
      return inYear(EID_AL_ADHA, year).map((d) => span(d, 4));
    case "hanukkah":
      // Kislev 25, eight nights.
      return findIn("hebrew", "Kislev", 25, iso(year, 11, 20), iso(year, 12, 31)).map((d) => span(d, 8));
    case "passover":
      // Nisan 15, eight days.
      return findIn("hebrew", "Nisan", 15, iso(year, 3, 20), iso(year, 4, 30)).map((d) => span(d, 8));
    case "nowruz":
      // Farvardin 1, with its eve and the days after.
      return findIn("persian", "1", 1, iso(year, 3, 18), iso(year, 3, 24)).map((d) => ({ start: addDays(d, -1), end: addDays(d, 3) }));
    case "diwali": {
      // Five days: two before the main day, two after.
      const main = DIWALI[year];
      return main ? [{ start: addDays(main, -2), end: addDays(main, 2) }] : [];
    }
    case "valentines":
      return [span(iso(year, 2, 14), 1)];
    case "yalda":
      // The longest night: the evening of Azar 30, the last of autumn.
      return findIn("persian", "9", 30, iso(year, 12, 18), iso(year, 12, 23)).map((d) => span(d, 1));
    case "three-kings":
      // The parade on the evening of the 5th, the presents on the morning of the 6th.
      return [{ start: iso(year, 1, 5), end: iso(year, 1, 6) }];
    case "orthodox-christmas":
      return [span(orthodoxChristmas(year), 1)];
    case "ramadan":
      // Ramadan 1 to the day before Eid al-Fitr; the dressing only after sunset (§3.3).
      return inYear(RAMADAN, year).map((first) => {
        const eid = EID_AL_FITR.find((d) => d > first) ?? addDays(first, 30);
        return { start: first, end: addDays(eid, -1), duskFallback: 18 * 60 };
      });
    case "purim":
      // Adar 14, or Adar II 14 in a leap year (Adar I is the one added).
      return findIn("hebrew", ["Adar", "Adar II"], 14, iso(year, 2, 15), iso(year, 3, 31)).map((d) => span(d, 1));
    case "holi": {
      // The colours day and its eve, Holika Dahan.
      const day = HOLI[year];
      return day ? [{ start: addDays(day, -1), end: day }] : [];
    }
    case "kings-day": {
      // 27 April, or the 26th when the 27th is a Sunday.
      const day = iso(year, 4, 27);
      return [span(weekday(day) === 0 ? addDays(day, -1) : day, 1)];
    }
    case "mothers-day":
      return [span(onDay((cc && MOTHERS_DAY[cc]) || SECOND_SUNDAY_OF_MAY, year), 1)];
    case "fathers-day": {
      const rule = cc && cc in FATHERS_DAY ? FATHERS_DAY[cc] : THIRD_SUNDAY_OF_JUNE;
      return rule ? [span(onDay(rule, year), 1)] : [];
    }
    case "dragon-boat":
      // The fifth day of the fifth month.
      return inYear(DRAGON_BOAT, year).map((d) => span(d, 1));
    case "national-day": {
      const day = cc ? NATIONAL_DAY[cc] : undefined;
      if (!day) return [];
      // Mexico's Grito is the night before.
      const start = cc === "MX" ? addDays(`${year}-${day}`, -1) : `${year}-${day}`;
      return [{ start, end: `${year}-${day}`, visitorFrom: "dusk" }];
    }
    case "mid-autumn":
      // The full moon of the eighth month.
      return inYear(MID_AUTUMN, year).map((d) => span(d, 1));
    case "sukkot":
      // Tishri 15, seven days.
      return findIn("hebrew", "Tishri", 15, iso(year, 9, 15), iso(year, 10, 25)).map((d) => span(d, 7));
  }
}

/* ---------------------------------------------------------------- what's on now */

/** `now` in `timeZone` as a calendar date, minutes since midnight, and the seconds past that minute. */
function clockIn(now: Date, timeZone?: string): { day: string; minutes: number; seconds: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch (e) {
    // An unknown zone: this device's own. (An invalid date has no zone to fall back to.)
    if (timeZone === undefined) throw e;
    return clockIn(now, undefined);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    seconds: Number(get("second")) + (now.getTime() % 1000) / 1000,
  };
}

/** `now` in `timeZone` as a calendar date and minutes since midnight. */
export function familyClock(now: Date, timeZone?: string): { day: string; minutes: number } {
  const { day, minutes } = clockIn(now, timeZone);
  return { day, minutes };
}

/** When dusk is assumed without the weather's sunset: 17:00 (RFC-020 §3.3, St Martin's Day). */
export const DUSK_FALLBACK_MINUTES = 17 * 60;

/**
 * How long before the family's midnight a `midnight` visitor is ready: the
 * scene is set up and waiting (ActiveFestival.visitorIn), so the first rocket
 * goes up on the stroke rather than at the next minute's tick.
 */
export const MIDNIGHT_RUN_UP_MINUTES = 5;

/** A sunset as the weather shows it ("16:42", "4:42 PM") as minutes since midnight, or null. */
export function parseClockTime(text: string | null | undefined): number | null {
  const m = /(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])?/.exec(text ?? "");
  if (!m) return null;
  let h = Number(m[1]) % 24;
  if (m[3]) h = (h % 12) + (/^p/i.test(m[3]) ? 12 : 0);
  return h * 60 + Number(m[2]);
}

export interface ActiveFestival {
  id: FestivalId;
  /** The family's today, `YYYY-MM-DD`. */
  day: string;
  /** The window it is in. */
  start: string;
  end: string;
  /** Today's place in the window: 0 on its first day. */
  dayIndex: number;
  /** The window's length in days. */
  days: number;
  /** Minutes since the family's midnight. */
  minutes: number;
  /** Past dusk today: the weather's sunset, else the window's fallback (17:00; Ramadan 18:00). */
  afterDusk: boolean;
  /**
   * Whether the visitor may fly yet: false before dusk on a `visitorFrom:
   * "dusk"` day, and outside the run-up to and the time after a `midnight`.
   */
  visitorReady: boolean;
  /**
   * Milliseconds from `now` to the visitor's moment, the family's midnight,
   * for a `midnight` window (negative once it has passed); null for the rest.
   * The same moment however often it's worked out, so the scene waiting for
   * it is never restarted.
   */
  visitorIn: number | null;
}

export interface ActiveOptions {
  /** The family's country (or region code): the per-country days depend on it. */
  country?: string | null;
  /** Dusk today in the family's zone, minutes since midnight (the weather's sunset); else the window's fallback. */
  duskMinutes?: number | null;
}

const lengthOf = (w: FestivalWindow) =>
  Math.round((Date.parse(`${w.end}T12:00:00Z`) - Date.parse(`${w.start}T12:00:00Z`)) / 86_400_000) + 1;

/** Whether `day` at `minutes` is inside the window: its days, and on the last one, up to `endsAt`. */
const inWindow = (w: FestivalWindow, day: string, minutes: number) =>
  day >= w.start && day <= w.end && !(day === w.end && w.endsAt !== undefined && minutes >= w.endsAt);

/**
 * The festival on at `now` in the family's zone, of those `chosen`, or null.
 *
 * When two overlap (Hanukkah in Advent, St Nicholas in Advent, New Year's Eve
 * in Christmas's last days) the shorter one wins on its own days: it sets the
 * wash, the dressing and the visitor, and the longer one comes back after
 * (RFC-020 §2.4). Two of the same length: the one earlier in FESTIVALS.
 */
export function activeFestival(
  now: Date,
  chosen: readonly FestivalId[],
  timeZone?: string,
  options: ActiveOptions = {},
): ActiveFestival | null {
  const { day, minutes, seconds } = clockIn(now, timeZone);
  const year = Number(day.slice(0, 4));
  let best: { id: FestivalId; window: FestivalWindow; length: number } | null = null;
  for (const id of FESTIVALS) {
    if (!chosen.includes(id)) continue;
    // A window that started last year can still be on (Christmas into January).
    for (const window of [...festivalDates(id, year - 1, options.country), ...festivalDates(id, year, options.country)]) {
      if (!inWindow(window, day, minutes)) continue;
      const length = lengthOf(window);
      if (!best || length < best.length) best = { id, window, length };
    }
  }
  if (!best) return null;
  const { window } = best;
  const dusk = options.duskMinutes ?? window.duskFallback ?? DUSK_FALLBACK_MINUTES;
  let visitorReady = true;
  let visitorIn: number | null = null;
  if (window.visitorFrom === "dusk") visitorReady = !(day === window.start && minutes < dusk);
  if (window.visitorFrom === "midnight") {
    // Ready on the last day (after the midnight), and in the last minutes of the day before, waiting for it.
    const eve = day === addDays(window.end, -1);
    visitorReady = day === window.end || (eve && minutes >= 24 * 60 - MIDNIGHT_RUN_UP_MINUTES);
    const sinceMidnight = (minutes * 60 + seconds) * 1000;
    visitorIn = day === window.end ? 0 - Math.round(sinceMidnight) : eve ? Math.round(86_400_000 - sinceMidnight) : null;
  }
  return {
    id: best.id,
    day,
    start: window.start,
    end: window.end,
    dayIndex: lengthOf({ start: window.start, end: day }) - 1,
    days: best.length,
    minutes,
    afterDusk: minutes >= dusk,
    visitorReady,
    visitorIn,
  };
}
