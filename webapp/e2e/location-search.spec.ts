import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  formatPlace,
  photonSearchParams,
  placeFromPhoton,
  NEAR_SCALE,
  NEAR_ZOOM,
  type PhotonFeature,
  type PlaceAddress,
} from "../src/lib/location-search";
import { clearPhotonCache, photonBaseUrl, searchPhoton, DEFAULT_PHOTON_URL } from "../src/lib/photon-client";
import { codeOnly } from "./source-helpers";

/**
 * The calendar's Location field. It follows the family's settings -- where the
 * family is, the app's language, each address written the way its country
 * writes it -- and searches Photon through Kinboard's own /api/geocode rather
 * than Nominatim from the browser, which Nominatim's usage policy forbids for
 * search-as-you-type. No stack; location-autocomplete-ui.spec.ts looks at the
 * rendered field.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const ask = (extra: Partial<Parameters<typeof photonSearchParams>[0]> = {}) =>
  photonSearchParams({ query: "Main Street", limit: 5, language: "en", ...extra });

// ---- what Photon is asked for ----

test("where the family is leads the results without limiting them to it", () => {
  const params = ask({ near: { lat: 53.08, lon: 7.4 }, countryCode: "DE" });
  expect(params.get("lat")).toBe("53.08");
  expect(params.get("lon")).toBe("7.4");
  expect(params.get("zoom")).toBe(String(NEAR_ZOOM));
  expect(params.get("location_bias_scale")).toBe(String(NEAR_SCALE));
  // A bias, not a filter: the country is not sent when the place is known.
  expect(params.has("countrycode")).toBe(false);
});

test("with no weather location, the family's country limits the search, in either case", () => {
  expect(ask({ countryCode: "us" }).get("countrycode")).toBe("US");
  expect(ask({ countryCode: "GB", near: null }).get("countrycode")).toBe("GB");
});

test("no place and no country, or values that are not one: the whole world", () => {
  for (const countryCode of [undefined, null, "", "usa", "u", "1a", "  "]) {
    expect(ask({ countryCode }).has("countrycode"), String(countryCode)).toBe(false);
  }
  for (const near of [{ lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: Number.NaN, lon: 1 }]) {
    expect(ask({ near }).has("lat"), JSON.stringify(near)).toBe(false);
  }
});

test("names come in the app's language where Photon has them, and local names otherwise", () => {
  for (const language of ["en", "de", "fr"]) expect(ask({ language }).get("lang"), language).toBe(language);
  // Photon refuses a language it has no names in with a 400; "default" is each place's own.
  for (const language of ["es", "it", "nl", ""]) expect(ask({ language }).get("lang"), language).toBe("default");
});

test("the rest of the request is what Photon needs", () => {
  const params = ask();
  expect(params.get("q")).toBe("Main Street");
  expect(params.get("limit")).toBe("5");
});

// ---- Photon's answers, as the field lists them (real responses) ----

const feature = (properties: PhotonFeature["properties"], coordinates: [number, number] = [1, 2]): PhotonFeature => ({
  geometry: { coordinates },
  properties,
});
const OPERA = feature({ osm_type: "R", osm_id: 9596872, osm_key: "amenity", osm_value: "arts_centre", type: "house", housenumber: "2", name: "Sydney Opera House", street: "Macquarie Street", locality: "Quay Quarter", district: "Sydney", city: "Sydney", state: "New South Wales", country: "Australia", postcode: "2000", countrycode: "AU" }, [151.2151234, -33.857198]);
const WHITE_HOUSE = feature({ osm_type: "R", osm_id: 19761182, osm_key: "office", osm_value: "government", type: "house", housenumber: "1600", name: "White House", street: "Pennsylvania Avenue Northwest", district: "Ward 2", city: "Washington", state: "District of Columbia", country: "United States", postcode: "20500", countrycode: "US" });
const KAUFLAND = feature({ osm_type: "W", osm_id: 771724189, osm_key: "shop", osm_value: "supermarket", type: "house", housenumber: "39 - 45", name: "Kaufland", street: "Deverweg", locality: "Untenende", district: "Papenburg", city: "Papenburg", county: "Landkreis Emsland", state: "Niedersachsen", country: "Deutschland", postcode: "26871", countrycode: "DE" });
const HOUSE = feature({ osm_type: "W", osm_id: 1003878674, osm_key: "building", osm_value: "yes", type: "house", housenumber: "5", street: "Hauptstraße", district: "Stapelmoor", city: "Weener", county: "Landkreis Leer", state: "Niedersachsen", country: "Deutschland", postcode: "26826", countrycode: "DE" });
const PARIS = feature({ osm_type: "R", osm_id: 71525, osm_key: "place", osm_value: "city", type: "city", name: "Paris", state: "Île-de-France", country: "France", countrycode: "FR" });
const DOWNING = feature({ osm_type: "R", osm_id: 1879842, osm_key: "office", osm_value: "government", type: "house", housenumber: "10", name: "10 Downing Street", street: "Downing Street", locality: "Westminster", district: "Covent Garden", city: "London", state: "England", country: "United Kingdom", postcode: "SW1A 2AA", countrycode: "GB" });
const SPRINGFIELD = feature({ osm_type: "R", osm_id: 126326, osm_key: "place", osm_value: "city", type: "city", name: "Springfield", county: "Sangamon", state: "Illinois", country: "United States", countrycode: "US" });

const short = (f: PhotonFeature) => {
  const place = placeFromPhoton(f)!;
  return formatPlace(place.address, place.display_name);
};

test("a place with a name of its own leads with it, then its address the country's way", () => {
  expect(short(OPERA)).toBe("Sydney Opera House, 2 Macquarie Street, Sydney, NSW 2000");
  expect(short(WHITE_HOUSE)).toBe("White House, 1600 Pennsylvania Avenue Northwest, Washington, DC 20500");
  expect(short(KAUFLAND)).toBe("Kaufland, Deverweg 39 - 45, 26871 Papenburg");
});

test("a plain address reads as before, and a name that is the address is not written twice", () => {
  expect(short(HOUSE)).toBe("Hauptstraße 5, 26826 Weener");
  expect(short(DOWNING)).toBe("10 Downing Street, London SW1A 2AA");
});

test("a town found as itself reads as the town", () => {
  expect(short(SPRINGFIELD)).toBe("Springfield, IL");
  expect(short(PARIS)).toBe("Paris");
});

test("each result has a stable id, its position, and a full line with every part once", () => {
  const opera = placeFromPhoton(OPERA)!;
  expect(opera.place_id).toBe("R9596872");
  expect([opera.lat, opera.lon]).toEqual(["-33.857198", "151.2151234"]);
  expect(opera.display_name).toBe("Sydney Opera House, Macquarie Street 2, Sydney, 2000 Sydney, New South Wales, Australia");
  expect(placeFromPhoton(PARIS)!.display_name).toBe("Paris, Île-de-France, France");
  // No position, nothing to list.
  expect(placeFromPhoton({ properties: { name: "Nowhere" } })).toBeNull();
});

test("a state only Photon's name says is turned into its code, and an unknown one is left out", () => {
  expect(placeFromPhoton(WHITE_HOUSE)!.address?.["ISO3166-2-lvl4"]).toBe("US-DC");
  expect(placeFromPhoton(KAUFLAND)!.address?.["ISO3166-2-lvl4"]).toBeUndefined();
  expect(short(feature({ ...WHITE_HOUSE.properties, state: "Atlantis" }))).toBe("White House, 1600 Pennsylvania Avenue Northwest, Washington 20500");
});

// ---- Kinboard's side of the request ----

function fakeFetch(features: PhotonFeature[] = [OPERA], status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ type: "FeatureCollection", features }), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("Kinboard says who it is, which a browser could not", async () => {
  clearPhotonCache();
  const { impl, calls } = fakeFetch();
  await searchPhoton(ask({ query: "opera" }), impl);
  expect(new Headers(calls[0].init?.headers).get("user-agent")).toMatch(/^Kinboard \(\+https:\/\/github\.com\/svenger87\/kinboard\)$/);
  expect(calls[0].url.startsWith(`${DEFAULT_PHOTON_URL}/api/?`)).toBe(true);
});

test("a search repeated within a day is answered from the cache, and after a day asked again", async () => {
  clearPhotonCache();
  const { impl, calls } = fakeFetch();
  const t0 = 1_000_000;
  const first = await searchPhoton(ask({ query: "opera" }), impl, t0);
  const again = await searchPhoton(ask({ query: "opera" }), impl, t0 + 60_000);
  expect(again).toEqual(first);
  expect(calls).toHaveLength(1);
  await searchPhoton(ask({ query: "opera" }), impl, t0 + 25 * 60 * 60 * 1000);
  expect(calls).toHaveLength(2);
});

test("two screens asking the same thing at once share one request", async () => {
  clearPhotonCache();
  const { impl, calls } = fakeFetch();
  await Promise.all([searchPhoton(ask({ query: "same" }), impl), searchPhoton(ask({ query: "same" }), impl)]);
  expect(calls).toHaveLength(1);
});

test("a refusal from Photon is an error, and is not cached", async () => {
  clearPhotonCache();
  const bad = fakeFetch([], 503);
  await expect(searchPhoton(ask({ query: "down" }), bad.impl)).rejects.toThrow(/503/);
  const good = fakeFetch();
  await searchPhoton(ask({ query: "down" }), good.impl);
  expect(good.calls).toHaveLength(1);
});

test("PHOTON_URL points it at another Photon; anything that is not an http(s) URL is ignored", () => {
  expect(photonBaseUrl(undefined)).toBe(DEFAULT_PHOTON_URL);
  expect(photonBaseUrl("  ")).toBe(DEFAULT_PHOTON_URL);
  expect(photonBaseUrl("http://photon:2322/")).toBe("http://photon:2322");
  expect(photonBaseUrl("ftp://photon")).toBe(DEFAULT_PHOTON_URL);
  expect(photonBaseUrl("not a url")).toBe(DEFAULT_PHOTON_URL);
});

// ---- how a result reads ----

const address = (a: PlaceAddress): PlaceAddress => a;

test("a German address reads as it always did", () => {
  const hamburg = address({ house_number: "5", road: "Hauptstraße", city: "Hamburg", postcode: "20095", country_code: "de" });
  expect(formatPlace(hamburg, "full name")).toBe("Hauptstraße 5, 20095 Hamburg");
  // A result that does not say which country it is in keeps that order too.
  expect(formatPlace({ ...hamburg, country_code: undefined }, "full name")).toBe("Hauptstraße 5, 20095 Hamburg");
});

test("a US address reads number first, with the state before the postcode", () => {
  expect(
    formatPlace(
      address({ house_number: "123", road: "Main Street", city: "Springfield", state: "Illinois", "ISO3166-2-lvl4": "US-IL", postcode: "62701", country_code: "us" }),
      "full name",
    ),
  ).toBe("123 Main Street, Springfield, IL 62701");
});

test("Canada and Australia write the state or province the same way", () => {
  expect(
    formatPlace(address({ house_number: "100", road: "Queen Street West", city: "Toronto", "ISO3166-2-lvl4": "CA-ON", postcode: "M5H 2N2", country_code: "ca" }), "x"),
  ).toBe("100 Queen Street West, Toronto, ON M5H 2N2");
  expect(
    formatPlace(address({ house_number: "1", road: "Macquarie Street", city: "Sydney", "ISO3166-2-lvl4": "AU-NSW", postcode: "2000", country_code: "au" }), "x"),
  ).toBe("1 Macquarie Street, Sydney, NSW 2000");
});

test("Britain writes the postcode after the town, with no state", () => {
  expect(
    formatPlace(address({ house_number: "10", road: "Downing Street", city: "London", state: "England", postcode: "SW1A 2AA", country_code: "gb" }), "x"),
  ).toBe("10 Downing Street, London SW1A 2AA");
});

test("France writes the number first and the postcode before the town", () => {
  expect(
    formatPlace(address({ house_number: "5", road: "Avenue Anatole France", city: "Paris", postcode: "75007", country_code: "fr" }), "x"),
  ).toBe("5 Avenue Anatole France, 75007 Paris");
});

test("what is missing is left out, not written as a gap", () => {
  // No state code in the result: the postcode follows the town.
  expect(formatPlace(address({ house_number: "123", road: "Main Street", city: "Springfield", postcode: "62701", country_code: "us" }), "x")).toBe(
    "123 Main Street, Springfield 62701",
  );
  // No house number, no postcode.
  expect(formatPlace(address({ road: "Main Street", city: "Springfield", "ISO3166-2-lvl4": "US-IL", country_code: "us" }), "x")).toBe(
    "Main Street, Springfield, IL",
  );
  // A town on its own, as a search for a city gives.
  expect(formatPlace(address({ city: "Portland", state: "Oregon", "ISO3166-2-lvl4": "US-OR", country_code: "us" }), "x")).toBe("Portland, OR");
  expect(formatPlace(address({ city: "Hamburg", country_code: "de" }), "x")).toBe("Hamburg");
  // A village or a town is named as a city is.
  expect(formatPlace(address({ road: "Dorfstraße", village: "Kleindorf", postcode: "12345", country_code: "de" }), "x")).toBe("Dorfstraße, 12345 Kleindorf");
});

test("a result with no street or town is written as OpenStreetMap's own name for it", () => {
  expect(formatPlace(undefined, "Some Park, Somewhere")).toBe("Some Park, Somewhere");
  expect(formatPlace(address({ country: "United States", country_code: "us" }), "United States")).toBe("United States");
});

test("a state code that is not one is not written", () => {
  for (const code of ["US", "US-", "US-illinois", "US-ABCD"]) {
    expect(
      formatPlace(address({ road: "Main Street", city: "Springfield", "ISO3166-2-lvl4": code, country_code: "us" }), "x"),
      code,
    ).toBe("Main Street, Springfield");
  }
});

// ---- the wiring ----

test("the browser asks Kinboard, never a geocoder directly, and has no German left", () => {
  const hook = codeOnly(read("src/hooks/use-location-search.ts"));
  expect(hook).toContain("fetch(`/api/geocode?${params}`");
  expect(hook).not.toMatch(/nominatim|photon\.komoot/i);
  expect(hook).not.toMatch(/countryCode\s*=\s*["']de["']/);
  expect(hook).not.toContain("Suche fehlgeschlagen");
  // One request per pause: no second, worldwide search.
  expect(hook.match(/fetch\(/g)).toHaveLength(1);
  // The address is written by the shared formatter.
  expect(hook).toContain("formatPlace(location.address, location.display_name)");
});

test("the search route is behind the session and rate-limited, so it is no open proxy", () => {
  const route = codeOnly(read("src/app/api/geocode/route.ts"));
  expect(route).toMatch(/requireSession\(request\)/);
  expect(route).toMatch(/if \(!auth\.ok\) return auth\.response;/);
  expect(route).toMatch(/hitLimit\(`geocode:\$\{auth\.session\.sessionId\}`/);
});

test("the field leans towards the weather location the family set, never the weather widget's Hamburg fallback", () => {
  const field = codeOnly(read("src/components/location-autocomplete.tsx"));
  expect(field).toContain("useSetting<WeatherLocation | null>(SETTINGS_KEYS.weatherLocation, null)");
  expect(field).not.toContain("useWeatherLocation(");
  // And it credits OpenStreetMap, as its licence asks.
  expect(field).toContain('t("attribution")');
});
