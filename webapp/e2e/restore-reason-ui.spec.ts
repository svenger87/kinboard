import { expect, test } from "@playwright/test";

/**
 * #458: a restore that the server refuses says why. The join page used to
 * show "is this a Kinboard backup file?" for every failure, while
 * /api/import answered with the reason (an unknown format, a table that
 * wouldn't insert, the size). Nothing is created: the file is refused before
 * a family exists.
 */

test.skip(!process.env.FAMILY_CODE, "needs a running stack");
test.use({ serviceWorkers: "block" });

test("a refused backup shows the server's reason", async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
  await page.goto("/join", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Create/ }).first().click({ timeout: 30_000 });

  const answered = page.waitForResponse((r) => r.url().includes("/api/import") && r.request().method() === "POST");
  await page.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: "kinboard-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "kinboard-export", version: 99, family: {}, data: {} })),
  });
  expect((await answered).status()).toBe(400);

  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Restore failed" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Not a Kinboard export");
});
