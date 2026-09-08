import { test, expect } from "@playwright/test";
import { establishSession } from "./session";

/**
 * Two things only a rendered page can settle.
 *
 * The widget must be PRESENT when idle — the opposite of the media widget's
 * rule, and therefore the single most likely thing for someone to "fix" by
 * pattern-matching between the two. A timer has no origin but this screen, so
 * a widget that hides when idle can never start the thing it exists to show.
 *
 * And a finished timer must stay until somebody dismisses it: an alarm that
 * clears itself is not an alarm.
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";
const DEVICE_NAME = process.env.PLAYWRIGHT_DEVICE_NAME ?? "Timer Widget Test";

test.describe("the timer widget", () => {
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE to reach the dashboard");

  test("is present when no timer is running", async ({ page }) => {
    await establishSession(page, FAMILY_CODE, DEVICE_NAME);
    await page.goto("/");
    await page.waitForSelector(".hero-block", { timeout: 20_000 });
    await page.waitForTimeout(2500);
    // The presets are the whole point of the idle state: they are how a timer
    // gets started at all.
    await expect(page.getByRole("button", { name: "3 min" })).toBeVisible();
  });

  test("a started timer counts down, and a finished one stays until dismissed", async ({ page }) => {
    await establishSession(page, FAMILY_CODE, DEVICE_NAME);
    await page.goto("/");
    await page.waitForSelector(".hero-block", { timeout: 20_000 });
    await page.waitForTimeout(2500);

    // Start the shortest thing we can and let it elapse: a 3-minute preset is
    // too slow for a test, so drive the API directly with a 2-second duration.
    await page.evaluate(async () => {
      const raw = decodeURIComponent(
        document.cookie.split("; ").find((c) => c.startsWith("family-calendar-storage="))!.split("=")[1],
      );
      const familyId = JSON.parse(raw).state.family.id;
      await fetch("/api/timers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: familyId, label: "probe", duration_seconds: 2 }),
      });
    });

    await expect(page.getByText("probe")).toBeVisible({ timeout: 10_000 });
    // It rings, and then it waits.
    await expect(page.getByText("Time's up")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3000);
    await expect(page.getByText("Time's up")).toBeVisible();

    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText("probe")).toHaveCount(0, { timeout: 10_000 });
  });
});
