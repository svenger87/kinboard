import { expect, test } from "@playwright/test";
import { establishSession } from "./session";

const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");

test("optional dashboard, navigation and screensaver controls render", async ({ page }) => {
  await establishSession(page, familyCode!, "discussion-282-settings");

  await page.goto("/settings/widgets");
  const layoutSwitch = page.getByRole("switch", { name: /Kompaktes Home-Layout|Compact home layout/i });
  await expect(layoutSwitch).toBeVisible();
  await expect(layoutSwitch).not.toBeChecked();
  await layoutSwitch.click();
  await expect(layoutSwitch).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem("kinboard.home-layout"))).toBe("compact");
  await expect(page.getByText("Countdown", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: /Alle Schulstunden gleich groß|Show all classes equally/i })).toBeVisible();
  await expect(page.getByRole("switch", { name: /Nächsten Schultag anzeigen ab|Show next school day from/i })).toBeVisible();

  await page.goto("/");
  await expect(page.locator(".hero-block")).toHaveClass(/portrait:md:grid-cols-2/);

  await page.goto("/settings/navigation");
  await expect(page.getByRole("switch", { name: /Einstellungen nur als Zahnrad|Settings icon only/i })).toBeVisible();

  await page.goto("/settings/screensaver");
  await expect(page.getByRole("switch", { name: /Nachrichten anzeigen|Show news/i })).toBeVisible();
  await expect(page.getByRole("switch", { name: /Große Uhr und Termine|Large clock and events/i })).toBeVisible();
});
