import { expect, test } from "@playwright/test";
import { establishSession } from "./session";

/**
 * Settings → Screensaver → Preview: the screensaver comes up at once on this
 * screen and ends the way waking from the real one does — a key or a touch
 * ends it, but a tap on a news item opens the news window and keeps it up
 * (data-no-wake, wakesScreen). Needs the stack (FAMILY_CODE) and a dev server
 * (PLAYWRIGHT_BASE_URL); news is stubbed.
 */

const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode || !process.env.PLAYWRIGHT_BASE_URL, "needs FAMILY_CODE, PLAYWRIGHT_BASE_URL and a running stack");
test.use({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });

const TITLE = "Preview probe headline";

test("the preview shows the screensaver, a news tap keeps it, a key ends it", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route(/\/api\/news(\?|$)/, (route) =>
    route.fulfill({
      json: {
        news: [{ title: TITLE, link: "https://example.org/news/preview", pubDate: new Date().toUTCString(), description: "Probe.", category: "Lokal", source: "e2e", sourceName: "E2E" }],
      },
    }),
  );
  await establishSession(page, familyCode!, "e2e-screensaver-preview");
  await page.goto("/settings/screensaver", { waitUntil: "domcontentloaded" });
  const button = page.locator("#screensaver-preview");
  await expect(button).toBeVisible({ timeout: 60_000 });
  const clock = page.getByTestId("screensaver-clock-digits");
  await expect(clock).toHaveCount(0);

  await button.click();
  await expect(clock).toBeVisible({ timeout: 15_000 });

  // A tap on a news item opens it and leaves the preview up.
  await page.getByRole("button", { name: new RegExp(TITLE) }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: TITLE });
  await expect(dialog).toBeVisible();
  await expect(clock).toBeVisible();
  await dialog.click({ position: { x: 8, y: 8 } });
  await expect(dialog).toHaveCount(0);
  await expect(clock).toBeVisible();

  // A key ends it, like waking from the real one.
  await page.locator("body").press("a");
  await expect(clock).toHaveCount(0);
  await expect(button).toBeVisible();
});
