import { test } from "@playwright/test";
import { killAnimations, setTheme, pinClockToSchoolDay, waitForReady, snap, expectAuthed } from "./helpers";

test.beforeEach(async ({ page }) => {
  await pinClockToSchoolDay(page);
  await setTheme(page);
  await killAnimations(page);
});

test("dashboard hero shot", async ({ page }) => {
  await page.goto("/");
  await waitForReady(page);
  await expectAuthed(page);
  await snap(page, "dashboard-portrait");
});

test("dashboard with widgets visible (full page)", async ({ page }) => {
  await page.goto("/");
  await waitForReady(page);
  await expectAuthed(page);
  await snap(page, "dashboard-portrait-full", { fullPage: true });
});
