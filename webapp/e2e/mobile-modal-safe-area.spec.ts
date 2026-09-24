import { expect, test } from "@playwright/test";
import { establishSession } from "./session";

const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "needs FAMILY_CODE and a running stack");

test("task dialog fits notched portrait and short landscape screens", async ({ page }) => {
  await establishSession(page, familyCode!, "modal-safe-area-test");
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/todos");
  await page.evaluate(() => {
    const root = document.documentElement;
    root.style.setProperty("--modal-safe-top", "52px");
    root.style.setProperty("--modal-safe-bottom", "34px");
    root.style.setProperty("--modal-safe-left", "44px");
    root.style.setProperty("--modal-safe-right", "0px");
  });

  await page.getByRole("button", { name: /Neue Aufgabe|New task/i }).click();
  const dialog = page.getByRole("dialog", { name: /Neue Aufgabe erstellen|Create new task/i });
  await expect(dialog).toBeVisible();

  async function expectSafeBounds(width: number, height: number, horizontalInset: number, verticalInset: number) {
    await expect(async () => {
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(horizontalInset - 1);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - horizontalInset + 1);
      expect(bounds!.y).toBeGreaterThanOrEqual(verticalInset - 1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height - verticalInset + 1);
    }).toPass({ timeout: 10_000 });
  }

  await expectSafeBounds(390, 700, 44, 52);
  const scroll = await dialog.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return { top: element.scrollTop, hidden: element.scrollHeight - element.clientHeight };
  });
  expect(scroll.hidden, "the long form should scroll within the dialog").toBeGreaterThan(0);
  expect(scroll.top).toBeGreaterThan(0);
  await expect(dialog.getByRole("button", { name: /Aufgabe erstellen|Create task/i })).toBeVisible();

  await page.setViewportSize({ width: 844, height: 390 });
  await expectSafeBounds(844, 390, 44, 52);
});
