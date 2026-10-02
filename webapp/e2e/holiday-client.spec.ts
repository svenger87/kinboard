import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

test("the widget asks for a region only when the region is known to be unset, not when it failed to load", () => {
  const hook = read("src/hooks/use-holiday-region.ts");
  expect(hook).toContain("const { data, isLoading, isError } = useSetting");
  expect(hook).toContain("return { region: setting?.code ?? null, setting, isLoading, isError }");
  const widget = read("src/components/widgets/holiday-widget.tsx");
  expect(widget).toContain("const { region, isLoading, isError } = useHolidayRegion()");
  // The link to Settings -> Holidays is the only thing gated on a null region,
  // and it is gated on a read that succeeded.
  expect(widget.match(/region === null/g)).toHaveLength(1);
  expect(widget).toContain("{region === null && !isLoading && !isError && (");
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

/**
 * Why the browser alias above is safe: with setTimezone(undefined), the only
 * rules that still consult moment-timezone's zone data are the astronomical
 * and lunisolar ones (equinox/solstice, chinese/korean/vietnamese,
 * bengali-revised, jalaali) and any rule naming a zone ("... in Asia/Tokyo").
 * In the browser they would run against a moment-timezone with no zones and
 * could land on another day, while every Node spec still passed. So the
 * bundled data may use only the rule kinds checked to give the same dates
 * either way; a date-holidays bump that brings in another kind fails here,
 * next to the alias it would invalidate. (islamic and hebrew are table-based
 * and reach a zone only through caldate's `if (timezone)` branch.)
 */
test("the bundled holiday data has no rule that needs zone data (plan ruling 4)", () => {
  const requireHere = createRequire(join(process.cwd(), "package.json"));
  type Token = { fn?: string; timezone?: string };
  const Parser = requireHere("./node_modules/date-holidays-parser/lib/Parser.cjs") as new () => {
    parse(rule: string): Token[];
  };
  const data = JSON.parse(readFileSync(join(process.cwd(), "src/lib/holidays/data/holidays.json"), "utf8"));

  const kinds = new Map<string, number>();
  const zoned: string[] = [];
  let rules = 0;
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    const days = (node as { days?: unknown }).days;
    if (days && typeof days === "object") {
      for (const rule of Object.keys(days)) {
        rules++;
        for (const token of new Parser().parse(rule)) {
          if (token.fn) kinds.set(token.fn, (kinds.get(token.fn) ?? 0) + 1);
          if (token.timezone !== undefined) zoned.push(`${path}: ${rule}`);
        }
      }
    }
    for (const [key, child] of Object.entries(node)) if (key !== "days") walk(child, `${path}/${key}`);
  };
  walk(data, "");

  expect(rules).toBeGreaterThan(1000);
  expect(kinds.get("gregorian")).toBeGreaterThan(0);
  expect([...kinds.keys()].filter((fn) => !["gregorian", "easter", "julian", "islamic", "hebrew"].includes(fn))).toEqual([]);
  expect(zoned).toEqual([]);
});
