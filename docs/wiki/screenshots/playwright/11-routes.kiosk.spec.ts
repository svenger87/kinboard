import { test } from "@playwright/test";
import { killAnimations, setTheme, pinClockToSchoolDay, waitForReady, snap, expectAuthed } from "./helpers";

test.beforeEach(async ({ page }) => {
  await pinClockToSchoolDay(page);
  await setTheme(page);
  await killAnimations(page);
});

const ROUTES: Array<{ path: string; name: string }> = [
  { path: "/calendar",        name: "calendar-month-view" },
  { path: "/shopping",        name: "shopping-list-mixed" },
  { path: "/recipes",         name: "recipes-library" },
  { path: "/meals",           name: "meals-week-board" },
  { path: "/todos",           name: "todos-overview" },
  { path: "/notes",           name: "notes-page" },
  { path: "/birthdays",       name: "birthdays-year-ring" },
  { path: "/schedule",        name: "schedule-week-grid" },
  { path: "/home-automation", name: "home-automation-rooms" },
  { path: "/energy",          name: "energy-flow-diagram" },
  { path: "/cameras",         name: "cameras-grid" },
];

for (const r of ROUTES) {
  test(`${r.path} → ${r.name}.png`, async ({ page }) => {
    await page.goto(r.path);
    await waitForReady(page);
    await expectAuthed(page);
    await snap(page, r.name);
  });
}
