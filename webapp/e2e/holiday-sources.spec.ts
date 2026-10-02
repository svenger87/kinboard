import { test, expect } from "@playwright/test";
import { getHolidays, getObservances, nextHolidays } from "../src/lib/holidays";
import { getDeHolidays } from "./fixtures/holidays-oracle/de";
import { getFrHolidays } from "./fixtures/holidays-oracle/fr";
import { getNlHolidays } from "./fixtures/holidays-oracle/nl";
import { getUkHolidays } from "./fixtures/holidays-oracle/uk";
import { getUsHolidays } from "./fixtures/holidays-oracle/us";
import { oracleObservedDays } from "./fixtures/holidays-oracle/observed";

/**
 * RFC-014 §4.6: the date-holidays adapter must reproduce #319's hand-written
 * lists for every year 2020-2035 -- dates, dayOff and the weekday a day off
 * is taken -- or list the difference here with its reason. Every date is a
 * local calendar day: run this file under TZ=UTC, Europe/Berlin,
 * America/Los_Angeles and Pacific/Auckland.
 */

const key = (date: Date | null) =>
  date && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const ORACLE = { de: getDeHolidays, fr: getFrHolidays, nl: getNlHolidays, uk: getUkHolidays, us: getUsHolidays } as const;
type Legacy = keyof typeof ORACLE;
const LEGACY = Object.keys(ORACLE) as Legacy[];
const YEARS = Array.from({ length: 16 }, (_, i) => 2020 + i);

/** Every way the adapter departs from #319 in 2020-2035, and why. date-holidays is right in each. */
const EXPECTED_DIFFERENCES: Record<string, string> = {
  "uk 2020-05-04 only-oracle": "VE Day 2020: the Early May bank holiday moved to Friday 8 May by proclamation",
  "uk 2020-05-08 only-adapter": "VE Day 2020, the moved Early May bank holiday",
  "uk 2022-05-30 only-oracle": "2022: the Spring bank holiday moved to Thursday 2 June for the Platinum Jubilee",
  "uk 2022-06-02 only-adapter": "the moved Spring bank holiday, 2022",
  "uk 2022-06-03 only-adapter": "Platinum Jubilee bank holiday, 2022",
  "uk 2022-09-19 only-adapter": "State funeral of Queen Elizabeth II, 2022",
  "uk 2023-05-08 only-adapter": "Coronation of King Charles III, 2023",
  "us 2020-06-19 only-oracle": "Juneteenth became a federal holiday in 2021",
};

function differences(code: Legacy, year: number): string[] {
  const adapter = new Map(getHolidays(code, year).map((h) => [key(h.date)!, h]));
  const oracle = new Map(ORACLE[code](year).map((h) => [key(h.date)!, h]));
  const out: string[] = [];
  for (const [day, h] of oracle) {
    const a = adapter.get(day);
    if (!a) out.push(`${code} ${day} only-oracle`);
    else if (a.dayOff !== h.dayOff) out.push(`${code} ${day} dayOff`);
    else if (a.nameKey !== h.nameKey) out.push(`${code} ${day} nameKey ${a.nameKey} != ${h.nameKey}`);
  }
  for (const day of adapter.keys()) if (!oracle.has(day)) out.push(`${code} ${day} only-adapter`);
  return out;
}

test("the adapter reproduces #319 for 2020-2035, apart from the listed differences", () => {
  const found = LEGACY.flatMap((code) => YEARS.flatMap((year) => differences(code, year)));
  expect(found.sort()).toEqual(Object.keys(EXPECTED_DIFFERENCES).sort());
});

test("the weekday a day off is taken matches #319 for 2020-2035", () => {
  for (const code of LEGACY) {
    for (const year of YEARS) {
      const adapter = nextHolidays(code, new Date(year, 0, 1), 200)
        .filter((h) => h.date.getFullYear() === year && h.observed !== null)
        .map((h) => `${key(h.date)}>${key(h.observed)}`)
        .sort();
      const oracle = [...oracleObservedDays(code, ORACLE[code](year))]
        .map(([h, d]) => `${key(h.date)}>${key(d)}`)
        .sort();
      expect(adapter, `${code} ${year}`).toEqual(oracle);
    }
  }
});

test("a holiday that is always a Sunday is marked but not a day off, with no override", () => {
  // NL Easter and Whit Sunday are `public` in date-holidays; so is the Swiss Bettag.
  const nl = new Map(getHolidays("NL", 2026).map((h) => [key(h.date), h.dayOff]));
  expect(nl.get("2026-04-05")).toBe(false);
  expect(nl.get("2026-05-24")).toBe(false);
  const zh = new Map(getHolidays("CH-ZH", 2026).map((h) => [key(h.date), h.dayOff]));
  expect(zh.get("2026-09-20")).toBe(false);
  // A fixed date that happens to be a Sunday stays a day off, as in #319.
  const at = new Map(getHolidays("AT-9", 2026).map((h) => [key(h.date), h.dayOff]));
  expect(at.get("2026-11-01")).toBe(true);
});

test("states and cantons get their own days (RFC-014 §12)", () => {
  const days = (region: string, year: number) => new Map(getHolidays(region, year).map((h) => [key(h.date), h.dayOff]));
  expect(days("DE-BY", 2026).get("2026-06-04")).toBe(true); // Fronleichnam
  expect(days("DE-NI", 2026).has("2026-06-04")).toBe(false);
  expect(days("DE-SN", 2026).get("2026-11-18")).toBe(true); // Buß- und Bettag, a day off in Saxony
  expect(days("DE-BY", 2026).get("2026-11-18")).toBe(false); // a school day off in Bavaria, marked, worked
  expect(days("DE-NI", 2026).has("2026-11-18")).toBe(false); // an observance in Niedersachsen: not shown
  expect(days("DE-BE", 2027).get("2027-03-08")).toBe(true); // Frauentag
  expect(days("AT-9", 2026).get("2026-12-08")).toBe(true); // Mariä Empfängnis
  expect(days("CH-VD", 2026).get("2026-09-21")).toBe(true); // Lundi du Jeûne
});

/**
 * AT and CH have no #319 oracle. These were checked against the Austrian
 * federal calendar and the Zürich, Vaud and Ticino cantonal calendars when
 * written; date-holidays' `optional`/`bank` days are marked, not off (§4.4).
 * [day, dayOff] for everything getHolidays returns.
 */
const SPOT: Record<string, Record<number, [string, boolean][]>> = {
  "AT-9": {
    2026: [["01-01", true], ["01-06", true], ["04-05", false], ["04-06", true], ["05-01", true], ["05-14", true], ["05-24", false], ["05-25", true], ["06-04", true], ["08-15", true], ["10-26", true], ["11-01", true], ["11-15", false], ["12-08", true], ["12-24", false], ["12-25", true], ["12-26", true], ["12-31", false]],
    2027: [["01-01", true], ["01-06", true], ["03-28", false], ["03-29", true], ["05-01", true], ["05-06", true], ["05-16", false], ["05-17", true], ["05-27", true], ["08-15", true], ["10-26", true], ["11-01", true], ["11-15", false], ["12-08", true], ["12-24", false], ["12-25", true], ["12-26", true], ["12-31", false]],
  },
  "CH-ZH": {
    2026: [["01-01", true], ["01-02", false], ["04-03", true], ["04-05", false], ["04-06", true], ["05-01", true], ["05-14", true], ["05-24", false], ["05-25", true], ["08-01", true], ["09-14", false], ["09-20", false], ["12-25", true], ["12-26", true]],
    2027: [["01-01", true], ["01-02", false], ["03-26", true], ["03-28", false], ["03-29", true], ["05-01", true], ["05-06", true], ["05-16", false], ["05-17", true], ["08-01", true], ["09-13", false], ["09-19", false], ["12-25", true], ["12-26", true]],
  },
  "CH-VD": {
    2026: [["01-01", true], ["01-02", true], ["04-03", true], ["04-05", false], ["04-06", true], ["05-14", true], ["05-24", false], ["05-25", true], ["08-01", true], ["09-20", false], ["09-21", true], ["12-25", true]],
    2027: [["01-01", true], ["01-02", true], ["03-26", true], ["03-28", false], ["03-29", true], ["05-06", true], ["05-16", false], ["05-17", true], ["08-01", true], ["09-19", false], ["09-20", true], ["12-25", true]],
  },
  "CH-TI": {
    2026: [["01-01", true], ["01-02", false], ["01-06", true], ["03-19", true], ["04-05", false], ["04-06", true], ["05-01", true], ["05-14", true], ["05-24", false], ["05-25", true], ["06-04", true], ["06-29", true], ["08-01", true], ["08-15", true], ["09-20", false], ["11-01", true], ["12-08", true], ["12-25", true], ["12-26", true]],
    2027: [["01-01", true], ["01-02", false], ["01-06", true], ["03-19", true], ["03-28", false], ["03-29", true], ["05-01", true], ["05-06", true], ["05-16", false], ["05-17", true], ["05-27", true], ["06-29", true], ["08-01", true], ["08-15", true], ["09-19", false], ["11-01", true], ["12-08", true], ["12-25", true], ["12-26", true]],
  },
};

test("Austria and Switzerland, spot-checked for 2026-2027", () => {
  for (const [region, years] of Object.entries(SPOT)) {
    for (const [year, expected] of Object.entries(years)) {
      const actual = getHolidays(region, Number(year)).map((h) => [key(h.date)!.slice(5), h.dayOff]);
      expect(actual, `${region} ${year}`).toEqual(expected);
    }
  }
});

test("Liberation Day is a day off only in a lustrum year, by override (RFC-014 §4.5)", () => {
  const liberation = (year: number) => getHolidays("NL", year).find((h) => key(h.date) === `${year}-05-05`)!;
  for (const year of [2025, 2030, 2035]) expect(liberation(year).dayOff, `${year}`).toBe(true);
  for (const year of [2026, 2027, 2031]) expect(liberation(year).dayOff, `${year}`).toBe(false);
});

test("a data-only country shows public holidays only, and no observances", () => {
  const pl = getHolidays("PL", 2026);
  expect(pl.some((h) => key(h.date) === "2026-05-03")).toBe(true); // Constitution Day
  expect(pl.every((h) => h.dayOff || h.date.getDay() === 0)).toBe(true);
  expect(getObservances("PL", 2026)).toEqual([]);
});

test("an unknown region has no holidays rather than someone else's", () => {
  expect(getHolidays("JP", 2026)).toEqual([]);
  expect(getHolidays("DE-BY-A", 2026)).toEqual([]);
  expect(nextHolidays("XX", new Date(2026, 9, 1), 3)).toEqual([]);
});

test("names follow the UI language, with English and then the native name behind it", () => {
  const de = getHolidays("AT-9", 2026, "de").find((h) => key(h.date) === "2026-12-08")!;
  expect(de.name).toBe("Mariä Empfängnis");
  const fr = getHolidays("AT-9", 2026, "fr").find((h) => key(h.date) === "2026-05-01")!;
  expect(fr.name).toBe("Staatsfeiertag"); // no French or English name upstream: the native one
});
