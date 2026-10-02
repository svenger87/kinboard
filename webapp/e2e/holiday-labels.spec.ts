import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getHolidays, getObservances } from "../src/lib/holidays";
import { CURATED } from "../src/lib/holidays/curated";
import { holidayLabel, type HolidayTranslator } from "../src/lib/holidays/label";
import { subdivisionsOf } from "../src/lib/holidays/region";

/** RFC-014 §4.3: Kinboard's name first, then upstream in the UI language, English, native. */

const LOCALES = ["en", "de", "fr"] as const;
const messages = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(join(process.cwd(), `messages/${locale}.json`), "utf8")).holidays;
const translator = (locale: string): HolidayTranslator => {
  const table = messages(locale);
  return Object.assign((k: string) => table[k], { has: (k: string) => k in table });
};
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("every curated name has a translation in English, German and French", () => {
  for (const locale of LOCALES) {
    const table = messages(locale);
    for (const [country, curated] of Object.entries(CURATED)) {
      for (const { nameKey } of Object.values(curated.names)) {
        expect(table[nameKey], `${locale}: ${country} ${nameKey}`).toBeTruthy();
      }
    }
  }
});

test("every day DE, AT and CH show, in any state or canton, has a Kinboard name", () => {
  for (const country of ["DE", "AT", "CH"]) {
    for (const region of [country, ...subdivisionsOf(country).map((s) => `${country}-${s}`)]) {
      for (const year of [2026, 2027, 2028]) {
        for (const h of [...getHolidays(region, year), ...getObservances(region, year)]) {
          expect(h.nameKey, `${region} ${key(h.date)} ${h.name}`).not.toBe("");
        }
      }
    }
  }
});

test("a data-only country falls back to upstream names, then English", () => {
  const day = (locale: string, d: string) => getHolidays("PL", 2026, locale).find((h) => key(h.date) === d)!;
  expect(holidayLabel(day("de", "2026-01-01"), translator("de"))).toBe("Neujahr");
  expect(holidayLabel(day("fr", "2026-01-01"), translator("fr"))).toBe("Nouvel An");
  expect(holidayLabel(day("en", "2026-01-01"), translator("en"))).toBe("New Year's Day");
  // No German or French name upstream: English, as the RFC accepts.
  for (const locale of LOCALES) expect(holidayLabel(day(locale, "2026-05-03"), translator(locale))).toBe("Constitution Day");
  expect(day("de", "2026-05-03").nameKey).toBe("");
  expect(day("de", "2026-05-03").emoji).toBe("📅");
});

test("a curated holiday uses Kinboard's own words", () => {
  const imm = getHolidays("AT-9", 2026, "de").find((h) => key(h.date) === "2026-12-08")!;
  expect(imm.nameKey).toBe("mariaeEmpfaengnis");
  expect(holidayLabel(imm, translator("de"))).toBe("Mariä Empfängnis");
  expect(holidayLabel(imm, translator("fr"))).toBe("Immaculée Conception");
  const unity = getHolidays("DE-BY", 2026).find((h) => key(h.date) === "2026-10-03")!;
  expect(holidayLabel(unity, translator("en"))).toBe("German Unity Day");
});

test("every render site goes through holidayLabel", () => {
  for (const file of [
    "src/components/widgets/holiday-widget.tsx",
    "src/components/calendar/month-view.tsx",
    "src/components/calendar/week-view.tsx",
    "src/app/calendar/page.tsx",
  ]) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source, file).not.toMatch(/tHolidays\(\s*holiday\.nameKey\s*\)/);
    expect(source, file).toContain("holidayLabel(");
  }
});
