import { test, expect } from "@playwright/test";
import { establishSession } from "./session";

/**
 * Settings → Navigation → Icons only (#282): on the wall bar every entry right
 * of Home is a larger icon without its name, and the entries share one row
 * instead of scrolling. Home keeps its name, each icon keeps its name for
 * assistive tech and as a tooltip, and the switch is per device. Needs the
 * stack (FAMILY_CODE) and a dev server.
 */

const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");

test("icons only puts the whole wall bar in one row and keeps every entry named", async ({ page }) => {
  // A portrait wall screen at 100%: the bar is the wall bar, not the phone's.
  await page.setViewportSize({ width: 1080, height: 1920 });
  await establishSession(page, familyCode!, "nav-icons-only");
  await page.goto("/settings/navigation");
  await page.evaluate(() => localStorage.removeItem("kinboard.nav-icons-only"));
  await page.reload();

  const bar = page.locator("nav").filter({ has: page.locator(".overflow-x-auto") }).last();
  const scroller = bar.locator(".overflow-x-auto");
  const calendar = bar.locator('a[href="/calendar"]');
  await expect(calendar).toContainText(/Kalender|Calendar|Calendrier/);
  const overflowBefore = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);

  const toggle = page.getByRole("switch", { name: /Nur Symbole|Icons only|Icônes seules/ });
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem("kinboard.nav-icons-only"))).toBe("true");

  await expect(scroller).toHaveAttribute("data-icons-only", "");
  // No visible names right of Home, but each link is still named.
  await expect(calendar).not.toContainText(/Kalender|Calendar|Calendrier/);
  await expect(calendar).toHaveAccessibleName(/Kalender|Calendar|Calendrier/);
  await expect(bar.locator('a[href="/"]')).toContainText(/Home|Accueil/);
  // Larger icons, at least the 44px touch target, and one row when it fits.
  const icon = await calendar.locator("svg").first().boundingBox();
  expect(icon!.width).toBeGreaterThanOrEqual(24);
  const link = await calendar.boundingBox();
  expect(link!.width).toBeGreaterThanOrEqual(44);
  const entries = await scroller.locator("a").count();
  const overflowAfter = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflowAfter).toBeLessThan(Math.max(overflowBefore, 1));
  if (entries <= 18) expect(overflowAfter).toBeLessThanOrEqual(1);

  // The "Settings icon only" switch is implied while icons only is on.
  const settingsIcon = page.getByRole("switch", { name: /Einstellungen nur als Zahnrad|Settings icon only|Réglages : icône seule/ });
  await expect(settingsIcon).toBeChecked();
  await expect(settingsIcon).toBeDisabled();

  // Off again: names come back.
  await toggle.click();
  await expect(calendar).toContainText(/Kalender|Calendar|Calendrier/);
  await page.evaluate(() => localStorage.removeItem("kinboard.nav-icons-only"));
});
