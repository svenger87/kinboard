import { expect, test, type Page } from "@playwright/test";
import { establishSession } from "./session";

/**
 * The Weather card on Home, against a stubbed provider (no API key needed,
 * and the figures are known): what it shows at night, on a phone, while it
 * loads, when a refresh fails, and what it asks the server for. Needs
 * FAMILY_CODE (a running stack).
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
// The PWA service worker answers fetches before page.route sees them.
test.use({ serviceWorkers: "block" });
const DEVICE = "weather-card-ui";

const NIGHT = {
  temp: -3, feelsLike: -8, condition: "Clear", conditionMain: "Clear", conditionIcon: "01n", humidity: 88,
  windSpeed: 14, location: "Garmisch-Partenkirchen", high: 0, low: -5, visibility: 10, sunrise: "07:41",
  sunset: "16:22", timezoneOffset: 3600, units: "metric",
};
const FORECAST = {
  location: "Garmisch-Partenkirchen", coords: { lat: 47.5, lon: 11.1 }, timezone: 3600, units: "metric", hourly: [],
  daily: [0, -2, -12, -11, -1, 3].map((max, i) => ({
    date: `2026-11-${23 + i}`, dayName: i === 0 ? "Today" : `Day ${i}`, tempMax: max, tempMin: max - 9,
    condition: "Snow", conditionMain: "Snow", conditionIcon: "13d", humidity: 80, windSpeed: 10,
    precipProbability: [0, 80, 0, 35, 100, 5][i], rainAmount: 0, snowAmount: 0,
  })),
};

/** Stubs the provider; `current` decides each /api/weather answer. Returns hit counters. */
async function stub(page: Page, current: () => { status: number; json: unknown } = () => ({ status: 200, json: NIGHT })) {
  const hits = { weather: 0, forecast: 0, map: 0, cities: 0 };
  await page.route(/\/api\/weather\/forecast\?/, (r) => { hits.forecast++; return r.fulfill({ json: FORECAST }); });
  await page.route(/\/api\/weather\?/, (r) => { hits.weather++; const a = current(); return r.fulfill({ status: a.status, json: a.json }); });
  await page.route(/\/api\/weather\/map\?/, (r) => { hits.map++; return r.fulfill({ json: { center: { lat: 47.5, lon: 11.1 }, zoom: 7, layers: { precipitation: "/x", clouds: "/x", temperature: "/x", wind: "/x", pressure: "/x" }, baseLayer: "/x", attribution: "" } }); });
  await page.route(/\/api\/cities\?/, (r) => { hits.cities++; return r.fulfill({ json: [{ lat: 47.5, lon: 11.1 }] }); });
  return hits;
}

const card = (page: Page) => page.locator("[role=button]", { has: page.locator("h3", { hasText: /^Weather$/ }) });

async function openHome(page: Page) {
  await establishSession(page, familyCode!, DEVICE);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(card(page).getByText("Day 1", { exact: true })).toBeVisible({ timeout: 60_000 });
}

test("a clear night shows a moon, not a sun", async ({ page }) => {
  await stub(page);
  await openHome(page);
  await expect(card(page).locator("svg.lucide-moon")).toHaveCount(1);
  await expect(card(page).locator("svg.lucide-sun")).toHaveCount(0);
});

for (const [label, width, height] of [["a phone", 390, 844], ["a laptop", 1440, 900]] as const) {
  test(`on ${label}, a long place name and frost keep the card on one line each`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await stub(page);
    await openHome(page);
    const shape = await card(page).evaluate((el) => {
      const box = el.getBoundingClientRect();
      // Lines of text in an element, from its height: one line is under two font sizes tall.
      // (Not Range.getClientRects: WebKit reports the clipped tail of an ellipsis as a line of its own.)
      const lines = (node: Element) => {
        const style = getComputedStyle(node);
        const inner = node.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
        return Math.max(1, Math.ceil(inner / (1.9 * parseFloat(style.fontSize))));
      };
      const textEl = (text: string) =>
        [...el.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent === text)!;
      // The "0° / -5°" pair beside the temperature, and the place badge.
      let highLow: Element = textEl("-5°");
      while (!highLow.textContent!.includes("/")) highLow = highLow.parentElement!;
      const badge = textEl("Garmisch-Partenkirchen").closest("div")!;
      const overflow = [...el.querySelectorAll("*")]
        .filter((child) => {
          const r = child.getBoundingClientRect();
          return r.width > 0 && (r.right > box.right + 0.5 || r.left < box.left - 0.5);
        })
        .map((child) => child.tagName);
      return { highLow: lines(highLow), badge: lines(badge), overflow };
    });
    expect(shape.overflow, "elements past the card's edge").toEqual([]);
    // It broke onto three lines ("0°" / "/" / "-5°") on a laptop, and the badge onto two.
    expect(shape.highLow, "lines in the high/low pair").toBe(1);
    expect(shape.badge, "lines in the place badge").toBe(1);
  });
}

test("a configured home never flashes the 'not set up' prompt while it loads", async ({ page }) => {
  await stub(page);
  // Watches the whole load, from the first DOM node on.
  await page.addInitScript(() => {
    (window as unknown as { sawSetup: boolean }).sawSetup = false;
    new MutationObserver(() => {
      if (document.body?.innerText.includes("Weather not set up")) (window as unknown as { sawSetup: boolean }).sawSetup = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await openHome(page);
  expect(await page.evaluate(() => (window as unknown as { sawSetup: boolean }).sawSetup)).toBe(false);
});

test("a refresh that fails keeps the last reading and says from when", async ({ page }) => {
  await page.clock.install();
  let fail = false;
  await stub(page, () => (fail ? { status: 500, json: { error: "Failed to fetch weather data" } } : { status: 200, json: NIGHT }));
  await openHome(page);
  fail = true;
  // The next refresh (10 minutes) and its two retries.
  await page.clock.runFor(11 * 60_000);
  await page.clock.runFor(60_000);
  await expect(page.getByTestId("weather-stale")).toBeVisible({ timeout: 15_000 });
  await expect(card(page).getByText("-3°", { exact: true })).toBeVisible();
  await expect(page.getByText("Weather not available")).toHaveCount(0);
});

test("the map's setup is fetched when the dialog opens, not with Home", async ({ page }) => {
  const hits = await stub(page);
  await openHome(page);
  await page.waitForTimeout(2_000);
  expect(hits.map + hits.cities, "map requests before opening").toBe(0);
  await card(page).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => hits.map, { timeout: 15_000 }).toBeGreaterThan(0);
});
