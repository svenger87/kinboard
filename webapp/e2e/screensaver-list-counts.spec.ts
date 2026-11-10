import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { DEFAULT_SCREENSAVER_SETTINGS, screensaverListCount } from "../src/types/screensaver";

/**
 * How many events and birthdays the screensaver lists, and whether it lists
 * birthdays at all (#282). A family that never set them sees what it saw
 * before: four events, three birthdays.
 */

test("a stored count is used only when it is a whole number from 1 to 5", () => {
  for (const n of [1, 2, 3, 4, 5]) expect(screensaverListCount(n, 4)).toBe(n);
  for (const bad of [undefined, null, 0, 6, -1, 2.5, "3", NaN, Infinity]) expect(screensaverListCount(bad, 4), String(bad)).toBe(4);
});

test("the defaults are what the screensaver showed before", () => {
  expect(DEFAULT_SCREENSAVER_SETTINGS).toMatchObject({ eventCount: 4, showBirthdays: true, birthdayCount: 3 });
});

test("the screensaver cuts both lists at the family's counts and can leave birthdays out", () => {
  const saver = readFileSync("src/components/screensaver.tsx", "utf8");
  expect(saver).toContain("screensaverListCount(screensaverSettings.eventCount, 4)");
  expect(saver).toContain("screensaverListCount(screensaverSettings.birthdayCount, 3)");
  expect(saver).toContain(".slice(0, eventCount)");
  expect(saver).toContain(".slice(0, birthdayCount)");
  expect(saver).toMatch(/if \(!birthdays \|\| !showBirthdays\) return \[\];/);
  // No fixed list length left behind.
  expect(saver).not.toMatch(/\.slice\(0, [34]\);\n\s+\}, \[(events|birthdays)/);
});
