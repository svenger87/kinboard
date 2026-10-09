import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { establishSession } from "./session";

/**
 * The Location field in the calendar's event dialog: places near the family
 * first (the weather location), the family's country when there is none, the
 * app's language, and each result written the way its country writes an
 * address, led by the place's own name. The search goes to Kinboard's own
 * /api/geocode (Photon behind a cache), never to a geocoder from the browser.
 *
 * Kinboard's search route is stubbed (the answers are known and CI needs no
 * internet) and so are the reads of the family's weather location and holiday
 * region, so the shared family is not changed. Needs FAMILY_CODE (a running
 * stack).
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
// The PWA service worker answers fetches before page.route sees them.
test.use({ serviceWorkers: "block" });
// One device for the file, joined once (see session.ts).
test.describe.configure({ mode: "serial" });
const DEVICE = "location-autocomplete-ui";

type Locale = "en" | "de";
const newEventLabel = (locale: Locale) =>
  (JSON.parse(readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8")) as { calendar: { newEventButton: string } })
    .calendar.newEventButton;

/** Results as /api/geocode returns them (lib/location-search.ts placeFromPhoton). */
const SPRINGFIELD = {
  place_id: "N1", lat: "39.79", lon: "-89.64",
  display_name: "Main Street 123, 62701 Springfield, Illinois, United States",
  address: { road: "Main Street", house_number: "123", city: "Springfield", state: "Illinois", "ISO3166-2-lvl4": "US-IL", postcode: "62701", country: "United States", country_code: "us" },
};
const HAMBURG = {
  place_id: "N2", lat: "53.55", lon: "10.0",
  display_name: "Hauptstraße 5, 20095 Hamburg, Deutschland",
  address: { road: "Hauptstraße", house_number: "5", city: "Hamburg", postcode: "20095", country: "Deutschland", country_code: "de" },
};
const KAUFLAND = {
  place_id: "W771724189", lat: "53.08", lon: "7.38",
  display_name: "Kaufland, Deverweg 39 - 45, Papenburg, 26871 Papenburg, Niedersachsen, Deutschland",
  address: { name: "Kaufland", road: "Deverweg", house_number: "39 - 45", city: "Papenburg", postcode: "26871", state: "Niedersachsen", country: "Deutschland", country_code: "de" },
};

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };

/** Answer Kinboard's place search, record what it was asked, and fail on any geocoder asked directly. */
async function stubSearch(page: Page, answer: (ask: Record<string, string>) => unknown[]) {
  const asked: Record<string, string>[] = [];
  const direct: string[] = [];
  await page.route(/\/api\/geocode\?/, (route: Route) => {
    const ask = Object.fromEntries(new URL(route.request().url()).searchParams);
    asked.push(ask);
    return route.fulfill({ json: { results: answer(ask) } });
  });
  await page.route(/nominatim\.openstreetmap\.org|photon\.komoot\.io/, (route: Route) => {
    direct.push(route.request().url());
    return route.abort();
  });
  return { asked, direct };
}

/** A family setting, answered on its read (null: never set). */
async function stubSetting(page: Page, key: string, value: unknown) {
  await page.route(new RegExp(`/rest/v1/settings\\?.*key=eq\\.${key}`), (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const wantsObject = (route.request().headers()["accept"] ?? "").includes("pgrst.object");
    if (value === null) {
      return wantsObject
        ? route.fulfill({ status: 406, headers: CORS, contentType: "application/json", body: JSON.stringify({ code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "no rows" }) })
        : route.fulfill({ json: [], headers: CORS });
    }
    const row = { value };
    return wantsObject
      ? route.fulfill({ headers: CORS, contentType: "application/vnd.pgrst.object+json", body: JSON.stringify(row) })
      : route.fulfill({ json: [row], headers: CORS });
  });
}

/** Where the family lives (Settings → Holidays). */
const stubRegion = (page: Page, code: string | null) =>
  stubSetting(page, "holiday_region", code ? { code, chosen: true } : null);
/** Where the family is (Settings → Weather). */
const stubWeather = (page: Page, location: unknown) => stubSetting(page, "weather_location", location);

/** Open the new-event dialog on the calendar and give back its Location field. */
async function openLocationField(page: Page, locale: Locale) {
  const base = test.info().project.use.baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  await establishSession(page, familyCode!, DEVICE);
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
  await page.goto("/calendar", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: newEventLabel(locale), exact: true }).filter({ visible: true }).first().click({ timeout: 30_000 });
  const field = page.locator("#location");
  await expect(field).toBeVisible({ timeout: 15_000 });
  return field;
}

test("a family's weather location leads the search, in the app's language, and an address reads the US way", async ({ page }) => {
  await stubRegion(page, "US-IL");
  await stubWeather(page, { type: "coordinates", lat: 39.8, lon: -89.65 });
  const { asked, direct } = await stubSearch(page, () => [SPRINGFIELD]);
  const field = await openLocationField(page, "en");

  await field.fill("Main Street");
  await expect.poll(() => asked.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(asked[0]).toMatchObject({ q: "Main Street", lang: "en", lat: "39.8", lon: "-89.65" });

  const option = page.getByRole("button", { name: /123 Main Street, Springfield, IL 62701/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText("Main Street 123, 62701 Springfield, Illinois");
  // OpenStreetMap is credited under the suggestions.
  await expect(page.getByText(/OpenStreetMap/)).toBeVisible();

  await option.click();
  await expect(field).toHaveValue("123 Main Street, Springfield, IL 62701");
  // One request per pause in typing, and none to a geocoder from the browser.
  await page.waitForTimeout(1_000);
  expect(asked).toHaveLength(1);
  expect(direct).toEqual([]);
});

test("a place with a name of its own leads with it, and the app's German is asked for", async ({ page }) => {
  await stubRegion(page, "DE-NI");
  await stubWeather(page, { type: "city", city: "Papenburg" });
  const { asked } = await stubSearch(page, () => [KAUFLAND, HAMBURG]);
  const field = await openLocationField(page, "de");

  await field.fill("Kaufland");
  await expect.poll(() => asked.length, { timeout: 15_000 }).toBeGreaterThan(0);
  // A weather location given as a town is sent as the town; the server locates it.
  expect(asked[0]).toMatchObject({ lang: "de", near: "Papenburg" });
  expect(asked[0]).not.toHaveProperty("lat");
  await expect(page.getByRole("button", { name: /Kaufland, Deverweg 39 - 45, 26871 Papenburg/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Hauptstraße 5, 20095 Hamburg/ })).toBeVisible();
});

test("with no weather location, the family's country is searched", async ({ page }) => {
  await stubRegion(page, "US-IL");
  await stubWeather(page, null);
  const { asked } = await stubSearch(page, () => [SPRINGFIELD]);
  const field = await openLocationField(page, "en");

  await field.fill("Main Street");
  await expect.poll(() => asked.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(asked[0]).toMatchObject({ country: "US", lang: "en" });
  // Not the weather widget's own fallback, Hamburg.
  expect(asked[0]).not.toHaveProperty("near");
  expect(asked[0]).not.toHaveProperty("lat");
});

test("with neither, the whole world is searched, not Germany", async ({ page }) => {
  await stubRegion(page, null);
  await stubWeather(page, null);
  const { asked } = await stubSearch(page, () => [SPRINGFIELD]);
  const field = await openLocationField(page, "en");

  await field.fill("Main Street");
  await expect.poll(() => asked.length, { timeout: 15_000 }).toBeGreaterThan(0);
  for (const key of ["country", "near", "lat"]) expect(asked[0]).not.toHaveProperty(key);
  await expect(page.getByRole("button", { name: /123 Main Street, Springfield, IL 62701/ })).toBeVisible();
});
