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
 * fixed days, Easter's computus (Gregorian and Julian), the `Intl` calendars
 * (chinese, islamic-umalqura, hebrew, persian), and one short table for
 * Diwali, whose Hindu lunisolar calendar `Intl` does not have.
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
   * The visitor waits for dusk on the first day (St Martin's lantern walk).
   * The festival itself — the wash, the dressing — is on all day.
   */
  visitorFrom?: "dusk";
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
};

/**
 * The festivals pre-ticked for a family in `country` (ISO 3166-1, or a region
 * code such as `DE-NI`, whose country counts). With no country -- a family
 * that hasn't picked a holiday region yet -- the ones pre-ticked in every
 * offered country: Christmas and New Year's Eve.
 */
export function commonFestivals(country: string | null | undefined): FestivalId[] {
  const cc = typeof country === "string" ? country.slice(0, 2).toUpperCase() : null;
  return FESTIVALS.filter((id) => {
    const where = COMMON[id];
    if (id === "easter") return cc === null ? false : !EASTER_ORTHODOX.has(cc);
    if (where === "all") return true;
    return cc !== null && where.has(cc);
  });
}

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

/** The `n`th given weekday (0 Sunday) of a month. */
function nthWeekday(year: number, month: number, dow: number, n: number): string {
  const first = iso(year, month, 1);
  return addDays(first, ((dow - weekday(first) + 7) % 7) + (n - 1) * 7);
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

/** Every Gregorian day from `from` to `to` that is `month`/`day` in `calendar`. */
function findIn(calendar: string, month: string, day: number, from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const c = inCalendar(d, calendar);
    if (c && c.month === month && c.day === day) out.push(d);
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

/* ---------------------------------------------------------------- windows */

const span = (start: string, days: number): FestivalWindow => ({ start, end: addDays(start, days - 1) });

/**
 * The windows of `id` that start in `year`, in the family's calendar days.
 * Usually one; an Islamic festival, eleven days earlier each year, falls
 * twice in a Gregorian year about every 33 years. Christmas starts in one
 * year and ends in the next. `country` matters only for Midsummer, whose eve
 * is a fixed day in the Baltics and the Friday between 19 and 25 June in
 * Sweden.
 */
export function festivalDates(id: FestivalId, year: number, country?: string | null): FestivalWindow[] {
  switch (id) {
    case "christmas":
      return [{ start: firstAdvent(year), end: iso(year + 1, 1, 6) }];
    case "new-years-eve":
      return [span(iso(year, 12, 31), 1)];
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
      if ((country ?? "").slice(0, 2).toUpperCase() === "SE") {
        // Midsummer Eve is the Friday between 19 and 25 June; the day is the Saturday.
        const jun19 = iso(year, 6, 19);
        return [span(addDays(jun19, (5 - weekday(jun19) + 7) % 7), 2)];
      }
      // Jaanipäev, Jāņi, Joninės: the eve on 23 June, the day on the 24th.
      return [span(iso(year, 6, 23), 2)];
    }
    case "lunar-new-year":
      // From the eve to the Lantern Festival, the 15th day.
      return findIn("chinese", "1", 1, iso(year, 1, 15), iso(year, 2, 25)).map((d) => ({ start: addDays(d, -1), end: addDays(d, 14) }));
    case "eid-al-fitr":
      // Shawwal 1, three days.
      return findIn("islamic-umalqura", "10", 1, iso(year, 1, 1), iso(year, 12, 31)).map((d) => span(d, 3));
    case "eid-al-adha":
      // Dhu al-Hijjah 10, four days.
      return findIn("islamic-umalqura", "12", 10, iso(year, 1, 1), iso(year, 12, 31)).map((d) => span(d, 4));
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
  }
}

/* ---------------------------------------------------------------- what's on now */

/** `now` in `timeZone` as a calendar date and minutes since midnight. */
export function familyClock(now: Date, timeZone?: string): { day: string; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    // An unknown zone: this device's own.
    return familyClock(now, undefined);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** When dusk is assumed without the weather's sunset: 17:00 (RFC-020 §3.3, St Martin's Day). */
export const DUSK_FALLBACK_MINUTES = 17 * 60;

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
  /** Whether the visitor may fly yet: false before dusk on a `visitorFrom: "dusk"` day. */
  visitorReady: boolean;
}

export interface ActiveOptions {
  /** The family's country (or region code): only Midsummer's dates depend on it. */
  country?: string | null;
  /** Dusk today in the family's zone, minutes since midnight (the weather's sunset); else DUSK_FALLBACK_MINUTES. */
  duskMinutes?: number | null;
}

const lengthOf = (w: FestivalWindow) =>
  Math.round((Date.parse(`${w.end}T12:00:00Z`) - Date.parse(`${w.start}T12:00:00Z`)) / 86_400_000) + 1;

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
  const { day, minutes } = familyClock(now, timeZone);
  const year = Number(day.slice(0, 4));
  let best: { id: FestivalId; window: FestivalWindow; length: number } | null = null;
  const dusk = options.duskMinutes ?? DUSK_FALLBACK_MINUTES;
  for (const id of FESTIVALS) {
    if (!chosen.includes(id)) continue;
    // A window that started last year can still be on (Christmas into January).
    for (const window of [...festivalDates(id, year - 1, options.country), ...festivalDates(id, year, options.country)]) {
      if (day < window.start || day > window.end) continue;
      const length = lengthOf(window);
      if (!best || length < best.length) best = { id, window, length };
    }
  }
  if (!best) return null;
  const waiting = best.window.visitorFrom === "dusk" && day === best.window.start && minutes < dusk;
  return { id: best.id, day, start: best.window.start, end: best.window.end, visitorReady: !waiting };
}
