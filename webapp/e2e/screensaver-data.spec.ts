import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/**
 * The screensaver's data comes from one hook, so the widgets that show the
 * same content read the same values. Source guard: the component must use the
 * hook and not derive the data itself again.
 */

const component = readFileSync("src/components/screensaver.tsx", "utf8");
const hookPath = "src/hooks/use-screensaver-data.ts";

test("the screensaver reads its data from useScreensaverData", () => {
  expect(component).toMatch(/import \{[^}]*useScreensaverData[^}]*\} from "@\/hooks\/use-screensaver-data"/);
  expect(component).toMatch(/useScreensaverData\(/);
});

test("the component no longer defines the birthday helpers", () => {
  expect(component).not.toMatch(/function getNextBirthday/);
  expect(component).not.toMatch(/function getDaysUntilBirthday/);
  expect(component).not.toMatch(/function parseBirthdayDate/);
  expect(component).not.toMatch(/function formatEventTime/);
});

test("the hook file exports the helpers and the hook", () => {
  expect(existsSync(hookPath)).toBe(true);
  const hook = readFileSync(hookPath, "utf8");
  for (const name of [
    "parseBirthdayDate",
    "getNextBirthday",
    "getDaysUntilBirthday",
    "calculateUpcomingAge",
    "formatEventTime",
    "useScreensaverData",
  ]) {
    expect(hook).toMatch(new RegExp(`export function ${name}\\b`));
  }
});
