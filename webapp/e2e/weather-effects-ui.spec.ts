import { test, expect, type Page } from "@playwright/test";
import { createThrowawayFamily, deleteThrowawayFamily, gotoAfterJoin } from "./throwaway-family";

/**
 * Weather effects on Home, end to end on a running stack, in a family of its
 * own: switched on in Settings -> Weather, a threshold kept in the family's
 * units, the Preview buttons, taps reaching what is under the effects, and
 * reduced motion. The rules are in weather-effects.spec.ts.
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

const overlay = (page: Page) => page.getByTestId("weather-effects");

/**
 * Where a tap would land, on a 6 x 6 grid over the whole screen: the points
 * that would hit an effect instead of the page (none, when nothing is in the
 * way), and how many points were checked.
 */
async function tapsBlocked(page: Page) {
  return page.evaluate(() => {
    const blocked: string[] = [];
    let checked = 0;
    for (let i = 1; i <= 6; i++) {
      for (let j = 1; j <= 6; j++) {
        const x = (window.innerWidth * i) / 7;
        const y = (window.innerHeight * j) / 7;
        const hit = document.elementFromPoint(x, y);
        checked += 1;
        if (hit?.closest('[data-testid="weather-effects"]')) blocked.push(`${Math.round(x)},${Math.round(y)}`);
      }
    }
    return { blocked, checked };
  });
}

test.describe("weather effects on Home", () => {
  test.skip(!FAMILY_CODE, "needs a running stack");
  test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  test.describe.configure({ timeout: 180_000 });

  test("switched on in settings, previewed on Home, and never in the way", async ({ page, baseURL }) => {
    const familyName = `probe-family-weather-${Date.now()}`;
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
    await page.goto("/join", { waitUntil: "domcontentloaded" });
    const familyId = await createThrowawayFamily(page, familyName);
    try {
      await gotoAfterJoin(page, "/settings/weather");
      const enabled = page.locator("#weather-effects-enabled");
      await expect(enabled).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
      await enabled.click();
      await expect(page.getByRole("radio", { name: "Subtle" })).toBeVisible();

      // A threshold, in the family's units, kept across a reload.
      const freezing = page.locator("#weather-effects-freezingAtC");
      await expect(freezing).toHaveValue("0");
      await freezing.fill("-3");
      const saved = page.waitForResponse((r) => r.url().includes("/api/settings") && r.request().method() === "PUT");
      await freezing.press("Enter");
      expect((await saved).ok()).toBe(true);
      await page.reload();
      await expect(page.locator("#weather-effects-enabled")).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
      await expect(page.locator("#weather-effects-freezingAtC")).toHaveValue("-3");

      // Preview, right here: snow over the settings page, still there seconds later, until Stop.
      await page.getByTestId("weather-effect-preview-snow").click();
      await expect(overlay(page)).toHaveAttribute("data-effects", "snow", { timeout: 10_000 });
      await expect(page.getByTestId("weather-effects-motion")).toHaveCount(1);
      await page.waitForTimeout(3_000);
      await expect(overlay(page)).toHaveAttribute("data-effects", "snow");
      expect(new URL(page.url()).pathname).toBe("/settings/weather");
      expect(await tapsBlocked(page)).toEqual({ blocked: [], checked: 36 });
      await page.getByTestId("weather-effect-preview-snow").click();
      await expect(overlay(page)).toHaveCount(0);

      // Frost and fog are still layers, and don't take taps either.
      await page.goto("/?weather-preview=freezing,fog,wind", { waitUntil: "domcontentloaded" });
      await expect(overlay(page)).toHaveAttribute("data-effects", "freezing,wind,fog", { timeout: 30_000 });
      // A preview opened on Home outlives taking the parameter out of the address.
      await page.waitForTimeout(3_000);
      await expect(overlay(page)).toHaveAttribute("data-effects", "freezing,wind,fog");
      expect(page.url()).not.toContain("weather-preview");
      await expect(page.locator(".weather-frost")).toHaveCount(1);
      await expect(page.locator(".weather-fog")).toHaveCount(1);
      expect(await tapsBlocked(page)).toEqual({ blocked: [], checked: 36 });

      // Reduced motion: the still layers stay, nothing moves.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/?weather-preview=snow,freezing,storm", { waitUntil: "domcontentloaded" });
      await expect(overlay(page)).toHaveAttribute("data-effects", "snow,storm,freezing", { timeout: 30_000 });
      await expect(page.locator(".weather-frost")).toHaveCount(1);
      await expect(page.getByTestId("weather-effects-motion")).toHaveCount(0);
      await expect(page.locator(".weather-storm")).toHaveCount(0);

      // The device's own switch (Settings -> Theme -> Animations), with the OS
      // asking for nothing: Reduced is the same still layers, Off draws none.
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(() => localStorage.setItem("kinboard_motion", "reduced"));
      await page.goto("/?weather-preview=snow,freezing,storm", { waitUntil: "domcontentloaded" });
      await expect(overlay(page)).toHaveAttribute("data-effects", "snow,storm,freezing", { timeout: 30_000 });
      await expect(page.locator(".weather-frost")).toHaveCount(1);
      await expect(page.getByTestId("weather-effects-motion")).toHaveCount(0);
      await expect(page.locator(".weather-storm")).toHaveCount(0);

      await page.evaluate(() => localStorage.setItem("kinboard_motion", "off"));
      await page.goto("/?weather-preview=snow,freezing,storm", { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".hero-block", { timeout: 30_000 });
      await page.waitForTimeout(3_000);
      await expect(overlay(page)).toHaveCount(0);
      await expect(page.locator(".weather-frost")).toHaveCount(0);
      await page.evaluate(() => localStorage.removeItem("kinboard_motion"));
    } finally {
      await deleteThrowawayFamily(page, familyId, familyName);
    }
  });

  test("without a reload: the rain comes on when the rainy slot begins, and a setting changed elsewhere arrives", async ({ page, baseURL }) => {
    const familyName = `probe-family-weather-live-${Date.now()}`;
    const t0 = Date.parse("2026-11-01T18:00:00Z");
    await page.clock.install({ time: t0 });
    // The weather and the forecast, answered here: dry now, a dry slot under way, 100% rain from three hours on.
    await page.route(/\/api\/weather(\?|$)/, (route) =>
      route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({
        temp: 15, feelsLike: 15, condition: "Clouds", conditionMain: "Clouds", conditionIcon: "04d", humidity: 60, windSpeed: 3, high: 17, low: 10, location: "Probe",
      }) }));
    await page.route(/\/api\/weather\/forecast/, (route) =>
      route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({
        location: "Probe", coords: { lat: 0, lon: 0 }, timezone: 0, daily: [],
        hourly: [0, 1, 2].map((k) => ({
          time: "00:00", temp: 15, condition: k === 0 ? "Clouds" : "Rain", conditionMain: k === 0 ? "Clouds" : "Rain", conditionIcon: "10d",
          precipProbability: k === 0 ? 10 : 100, windSpeed: 3, at: t0 - 60 * 60 * 1000 + k * 3 * 60 * 60 * 1000,
        })),
      }) }));
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
    await page.goto("/join", { waitUntil: "domcontentloaded" });
    const familyId = await createThrowawayFamily(page, familyName);
    const setEffects = (value: Record<string, unknown>) =>
      page.evaluate(async ({ familyId, value }) => {
        const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ family_id: familyId, key: "weather_effects", value }) });
        return res.ok;
      }, { familyId, value });
    try {
      expect(await setEffects({ enabled: true, intensity: "subtle", rainChanceAt: 50 })).toBe(true);
      await gotoAfterJoin(page, "/");
      // Under way: the dry slot (10%): no effects.
      await expect(page.locator("main")).toBeAttached();
      await page.waitForTimeout(2_000);
      await expect(overlay(page)).toHaveCount(0);
      // Two hours on, the 100% rain slot begins: rain, with no reload.
      await page.clock.fastForward("02:01:00");
      await expect(overlay(page)).toHaveAttribute("data-effects", "rain", { timeout: 10_000 });
      // Switched off on another screen: gone here within a minute.
      expect(await setEffects({ enabled: false })).toBe(true);
      await page.clock.fastForward("01:10");
      await expect(overlay(page)).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await deleteThrowawayFamily(page, familyId, familyName);
    }
  });
});
