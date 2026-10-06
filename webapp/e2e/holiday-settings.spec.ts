import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as holidays from "../src/lib/holidays";
import { subdivisionLabel, subdivisionOptions } from "../src/lib/holidays/adapter";
import { OFFERED_COUNTRIES, subdivisionsOf } from "../src/lib/holidays/region";
import { codeOnly } from "./source-helpers";
import { SETTINGS_ENTRIES } from "../src/lib/settings-search/registry";

const read = (p: string) => codeOnly(readFileSync(join(process.cwd(), p), "utf8"));

test("Settings → Holidays exists and holds the region picker and the school-holiday card", () => {
  const page = read("src/app/settings/holidays/page.tsx");
  expect(page).toContain("<HolidayRegionPicker");
  expect(page).toContain("<SchoolHolidaysCard");
  expect(page).toContain("useSaveHolidayRegion()");
  expect(page).not.toContain("useUpdateSetting");
  // The settings menu is drawn from the registry's menu entries.
  expect(
    SETTINGS_ENTRIES.some((e) => e.href === "/settings/holidays" && e.menu && !e.anchor),
  ).toBe(true);
});

test("holiday_region has one route devices write it through, which takes the family from the session and records the choice", () => {
  const route = read("src/app/api/holidays/region/route.ts");
  expect(route).toContain("requireSession(request)");
  expect(route).toContain("auth.session.familyId");
  expect(route).not.toMatch(/body\??\.family_id/);
  // Every spelling, not just body.family_id: destructuring, bracket access,
  // the query string. Task 13 extends this handler.
  expect(route).not.toMatch(
    /\bfamily_?[iI]d\b[^\n]*\b(body|searchParams|nextUrl)\b|\b(body|searchParams|nextUrl)\b[^\n]*\bfamily_?[iI]d\b/,
  );
  // family_id only ever as the column written, with the session's value;
  // never as a string key (body["family_id"], searchParams.get("family_id")).
  const writes = route.replace('onConflict: "family_id,key"', "");
  expect((writes.match(/\bfamily_id\b/g) ?? []).length).toBe((writes.match(/\bfamily_id: familyId\b/g) ?? []).length);
  expect(route).not.toMatch(/["'`]family_?[iI]d["'`]/);
  // familyId is declared once, from the session, and never destructured.
  expect(route.match(/\b(?:const|let|var)\s+familyId\b[^;]*;/g)).toEqual(["const familyId = auth.session.familyId;"]);
  expect(route).not.toMatch(/\{[^{}]*\bfamily_?[iI]d\b[^{}]*\}\s*=/);
  expect(route).toContain("resolveRegion(");
  expect(route).toMatch(/\{ code: resolved\.code, chosen: true \}/);
  const settings = read("src/app/api/settings/route.ts");
  expect(settings).toMatch(/\[SETTINGS_KEYS\.holidayRegion\]: "\/api\/holidays\/region"/);
});

test("the country picker is filled from the generated list, never from the UI locale", () => {
  const picker = read("src/components/settings/holiday-region-picker.tsx");
  expect(picker).toContain("OFFERED_COUNTRIES");
  expect(picker).toContain("subdivisionsOf(");
  expect(picker).not.toMatch(/"(DE|AT|CH|US|GB|NL|FR)"/); // no hard-coded country codes
});

test("Language no longer picks a country, and Schedule only links to the card", () => {
  const language = read("src/app/settings/language/page.tsx");
  expect(language).not.toContain("holiday_country");
  expect(language).not.toContain("COUNTRIES");
  expect(language).toContain('href="/settings/holidays"');
  const schedule = read("src/app/settings/schedule/page.tsx");
  expect(schedule).not.toContain("useSchoolHolidays");
  expect(schedule).not.toContain("holidayDialogOpen");
  expect(schedule).toContain('href="/settings/holidays"');
  expect("DEFAULT_COUNTRY" in holidays).toBe(false);
});

test("the school-holiday card moved unchanged", () => {
  const card = read("src/components/settings/school-holidays-card.tsx");
  for (const piece of [
    'useTranslations("settings.schedule")',
    "useSchoolHolidays()",
    "useCreateSchoolHoliday()",
    "useUpdateSchoolHoliday()",
    "useDeleteSchoolHoliday()",
    'toast.error(t("toastHolidaySaveFailed"))',
    'toast.error(t("toastHolidayDeleteFailed"))',
    "holidayForm.endsOn >= holidayForm.startsOn",
  ]) expect(card, piece).toContain(piece);
  expect(existsSync(join(process.cwd(), "src/app/settings/holidays/page.tsx"))).toBe(true);
});

test("saving a region refreshes the query useHolidayRegion reads, so this device updates at once", () => {
  const hook = read("src/hooks/use-holiday-region.ts");
  expect(hook).toContain("useSetting<unknown>(SETTINGS_KEYS.holidayRegion, null)");
  expect(hook).toContain('queryKeys.settings(family?.id ?? "", SETTINGS_KEYS.holidayRegion)');
  const queries = read("src/hooks/use-supabase-queries.ts");
  expect(queries).toMatch(
    /export function useSetting<T>\(key: string[^)]*\) \{[\s\S]*?queryKey: queryKeys\.settings\(family\?\.id \?\? "", key\)/,
  );
});

test("states and cantons are listed by their own name, alphabetically, in every UI language", () => {
  // date-holidays names every canton "Kanton …" / "Canton de …", which made
  // the list start with the same word 26 times, sorted d' before de, and left
  // type-to-search nothing to find.
  for (const locale of ["en", "de", "fr"]) {
    for (const country of OFFERED_COUNTRIES) {
      const options = subdivisionOptions(country, subdivisionsOf(country), locale);
      const names = options.map((o) => o.name);
      expect(names, `${locale} ${country}`).toEqual([...names].sort((a, b) => a.localeCompare(b, locale)));
      for (const name of names) {
        expect(name, `${locale} ${country}`).not.toMatch(/^(Kanton|Canton|Hansestadt|Land|Département) /);
        expect(name, `${locale} ${country}`).not.toMatch(/^Canton d['’]/);
      }
    }
  }
  const fr = subdivisionOptions("CH", subdivisionsOf("CH"), "fr").map((o) => o.name);
  expect(fr.slice(0, 4)).toEqual([
    "Appenzell Rhodes-Extérieures",
    "Appenzell Rhodes-Intérieures",
    "Argovie",
    "Bâle-Campagne",
  ]);
  expect(fr.indexOf("Grisons")).toBeLessThan(fr.indexOf("Jura"));
  expect(fr.indexOf("Uri")).toBeGreaterThan(fr.indexOf("Thurgovie"));
  const de = subdivisionOptions("CH", subdivisionsOf("CH"), "de").map((o) => o.name);
  expect(de.find((n) => n.startsWith("G"))).toBe("Genf");
  expect(de.at(-1)).toBe("Zürich");
  expect(subdivisionOptions("DE", subdivisionsOf("DE"), "de").map((o) => o.name).slice(0, 4)).toEqual([
    "Baden-Württemberg",
    "Bayern",
    "Berlin",
    "Brandenburg",
  ]);
  // A word that only starts like a prefix is not one.
  expect(subdivisionLabel("Landes")).toBe("Landes");
  expect(subdivisionLabel("Kantonsrat")).toBe("Kantonsrat");
});

test("the preview asks for more than five days, so five days off remain after the filter", () => {
  const page = read("src/app/settings/holidays/page.tsx");
  expect(page).toMatch(/nextHolidays\(region, new Date\(today\), (\d+), locale\)\.filter\(\(h\) => h\.dayOff\)\.slice\(0, 5\)/);
  const asked = Number(/nextHolidays\(region, new Date\(today\), (\d+)/.exec(page)![1]);
  expect(asked).toBeGreaterThan(5);
  // Lower Austria from 1 Nov 2026: Leopold and Christmas Eve are marked, not
  // off, and used to push Christmas out of a five-row list.
  const rows = holidays
    .nextHolidays("AT-3", new Date(2026, 10, 1), asked, "en")
    .filter((h) => h.dayOff)
    .slice(0, 5);
  expect(rows).toHaveLength(5);
  expect(rows.map((h) => `${h.date.getMonth() + 1}-${h.date.getDate()}`)).toContain("12-25");
});

test("saving a region shows the stored row at once and stays pending until the refetch lands", () => {
  const hook = read("src/hooks/use-holiday-region.ts");
  expect(hook).toContain("queryClient.setQueryData(queryKey, region)");
  expect(hook).toContain("return queryClient.invalidateQueries({ queryKey })");
});
