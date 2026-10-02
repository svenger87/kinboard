import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { holidaysByDay } from "../src/lib/calendar-markers";
import { SETTINGS_KEYS } from "../src/lib/settings-keys";
import { codeOnly } from "./source-helpers";

const read = (p: string) => codeOnly(readFileSync(join(process.cwd(), p), "utf8"));

test("the widget and the calendar read holiday_region, never holiday_country or a default country", () => {
  for (const file of ["src/components/widgets/holiday-widget.tsx", "src/app/calendar/page.tsx"]) {
    const source = read(file);
    expect(source, file).toContain("useHolidayRegion()");
    expect(source, file).not.toContain("holiday_country");
    expect(source, file).not.toContain("holidayCountry");
    expect(source, file).not.toContain("DEFAULT_COUNTRY");
  }
  expect("holidayCountry" in SETTINGS_KEYS).toBe(false);
});

test("the calendar asks for holidays in the UI language, and for none without a region", () => {
  const page = read("src/app/calendar/page.tsx");
  expect(page).toContain("holidaysByDay(holidayRegion, new Date(dateRange.start), new Date(dateRange.end), locale)");
  expect(page.match(/holidayRegion \? getHolidays\(holidayRegion, displayDate\.getFullYear\(\), locale\) : \[\]/g)).toHaveLength(2);
});

test("holidaysByDay takes a region and a locale", () => {
  const june = holidaysByDay("DE-BY", new Date(2026, 5, 1), new Date(2026, 5, 30), "de");
  expect(june.get("2026-06-04")?.name).toBe("Fronleichnam");
  expect(holidaysByDay("DE-NI", new Date(2026, 5, 1), new Date(2026, 5, 30)).has("2026-06-04")).toBe(false);
});

test("the browser build gets moment-timezone without its zone data (plan ruling 4)", () => {
  const config = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");
  expect(config).toMatch(/"moment-timezone":\s*\{\s*browser:\s*"\.\/node_modules\/moment-timezone\/moment-timezone\.js"\s*\}/);
  const adapter = read("src/lib/holidays/adapter.ts");
  expect(adapter).toContain("p.setTimezone(undefined)");
});
