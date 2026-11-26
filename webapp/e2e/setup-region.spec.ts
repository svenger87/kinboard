import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FAMILY_STEPS, firstIncompleteStep } from "../src/lib/first-run";
import { codeOnly } from "./source-helpers";

const read = (p: string) => codeOnly(readFileSync(join(process.cwd(), p), "utf8"));

test("the region is the family's first step", () => {
  // The install's own steps (RFC-024 §8) come first, once, for its operator only.
  expect(FAMILY_STEPS[0]).toBe("region");
  const none = { has_holiday_region: false, has_people: false, has_calendar: false, has_home_assistant: false, has_weather_location: false };
  expect(firstIncompleteStep(none, false)).toBe("region");
  expect(read("src/app/setup/page.tsx")).toContain("firstIncompleteStep(state, installStepsDue(instance))");
  expect(read("src/app/join/page.tsx")).toContain('router.push("/setup")');
});

test("the step preselects from a timezone, never from the language", () => {
  const page = read("src/app/setup/region/page.tsx");
  expect(page).toContain("countryForTimeZone(");
  expect(page).toContain("resolvedOptions().timeZone");
  expect(page).not.toContain("useLocale");
  expect(page).toContain("saveRegion.mutateAsync(value)");
});

test("setup state reports a chosen region", () => {
  const route = read("src/app/api/setup/state/route.ts");
  expect(route).toContain('"holiday_region"');
  expect(route).toContain("has_holiday_region:");
});

test("nothing is guessed, and Next waits, until the family's timezone and region have loaded (final review #6)", () => {
  const page = read("src/app/setup/region/page.tsx");
  expect(page).toContain("const settled = !regionLoading && !zoneLoading;");
  expect(page).toMatch(/const guess = useMemo\(\(\) => \{\s*if \(!settled\) return null;/);
  expect(page).toMatch(/<WizardStepFooter[^>]*disabled=\{saveRegion\.isPending \|\| \(!settled && picked === null\)\}/);
});
