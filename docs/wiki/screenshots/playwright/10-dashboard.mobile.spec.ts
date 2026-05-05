import { test } from "@playwright/test";
import { killAnimations, setTheme, pinClockToSchoolDay, waitForReady, snap, expectAuthed } from "./helpers";

test.beforeEach(async ({ page }) => {
  await pinClockToSchoolDay(page);
  await setTheme(page);
  await killAnimations(page);
});

test("mobile dashboard", async ({ page }) => {
  await page.goto("/");
  await waitForReady(page);
  await expectAuthed(page);
  await snap(page, "dashboard", { mobile: true });
});
