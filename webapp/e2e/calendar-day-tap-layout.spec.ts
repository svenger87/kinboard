import { test, expect } from "@playwright/test";
import { establishSession } from "./session";

/**
 * A tap on the top of a day in the month view did nothing. Each day's
 * selection button sits behind the day's content, and the row with the date
 * number -- with the holiday dot beside it -- caught the tap without a handler
 * of its own. On a phone that row is the top 40% of every day, empty or not,
 * so picking a day could take a few tries.
 *
 * Which element a tap lands on is decided by the rendered page, so this
 * clicks the middle of the number with the raw mouse, as a finger would.
 * Playwright's own click() on the number would refuse instead: now that the
 * row lets taps through, the number never receives them -- which is the point.
 */
const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

test.describe("month view", () => {
  // Skipped without a stack, like the other layout specs.
  test.skip(!FAMILY_CODE, "needs a running stack");

  test("tapping a date's number selects that day", async ({ page }, testInfo) => {
    await establishSession(page, FAMILY_CODE, `Day tap ${testInfo.project.name}`);
    await page.goto("/calendar");
    // Today starts out selected, so use a day that is not today. The 15th and
    // the 16th appear once in any month grid: the leading days are the end of
    // the previous month, and the trailing days never get past the 14th.
    const day = new Date().getDate() === 15 ? "16" : "15";
    // In each day, the selection button is followed by the row with the number.
    const number = page.locator("button[aria-label] + div > span").filter({ hasText: new RegExp(`^${day}$`) });
    await expect(number).toHaveCount(1);
    const dayButton = number.locator("xpath=../../button");
    await expect(dayButton).not.toHaveAttribute("aria-pressed", "true");

    await number.scrollIntoViewIfNeeded();
    const box = await number.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(dayButton).toHaveAttribute("aria-pressed", "true");
  });
});
