import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as holidays from "../src/lib/holidays";
import { codeOnly } from "./source-helpers";

const read = (p: string) => codeOnly(readFileSync(join(process.cwd(), p), "utf8"));

test("Settings → Holidays exists and holds the region picker and the school-holiday card", () => {
  const page = read("src/app/settings/holidays/page.tsx");
  expect(page).toContain("<HolidayRegionPicker");
  expect(page).toContain("<SchoolHolidaysCard");
  expect(page).toContain("useSaveHolidayRegion()");
  expect(page).not.toContain("useUpdateSetting");
  expect(read("src/app/settings/page.tsx")).toContain('href: "/settings/holidays"');
});

test("holiday_region has one writer, which takes the family from the session and records the choice", () => {
  const route = read("src/app/api/holidays/region/route.ts");
  expect(route).toContain("requireSession(request)");
  expect(route).toContain("auth.session.familyId");
  expect(route).not.toMatch(/body\??\.family_id/);
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
