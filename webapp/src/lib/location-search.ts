/**
 * The Location field's place search and how a result reads.
 *
 * The search is Photon (https://photon.komoot.io, komoot, Apache 2.0): the
 * same OpenStreetMap data as Nominatim, but built for search-as-you-type,
 * which the Nominatim usage policy forbids on its public instance. Requests go
 * through Kinboard's own /api/geocode, which caches them and identifies
 * Kinboard, rather than from the browser.
 *
 * Results lean towards where the family is (the weather location) without
 * being limited to it: nearby places come first, and a famous place elsewhere
 * still shows. Names come back in the app's language, and an address is written
 * the way its own country writes it.
 */

/** The parts of a place the short form uses (Nominatim's `address` names). */
export interface PlaceAddress {
  /** The place's own name when it is somewhere rather than an address: "Sydney Opera House". */
  name?: string;
  road?: string;
  house_number?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country?: string;
  /** ISO 3166-1 alpha-2, lower case: "us". */
  country_code?: string;
  /** ISO 3166-2 of the state or province: "US-IL". */
  "ISO3166-2-lvl4"?: string;
}

/** The languages Photon's public data has names in; anything else gets each place's local name. */
export const PHOTON_LANGUAGES = ["en", "de", "fr"] as const;

export interface LocationSearchOptions {
  query: string;
  limit: number;
  /** The app's language (`en`, `de`, `fr`, ...). One Photon has no names in gets local names. */
  language: string;
  /** Where the family is: nearby places first, the rest of the world after. */
  near?: { lat: number; lon: number } | null;
  /**
   * ISO 3166-1 alpha-2 in either case, used only when `near` is unknown: a
   * family that never set a weather location is still searched in its own
   * country rather than the whole world. Not two letters: ignored.
   */
  countryCode?: string | null;
}

const COUNTRY_CODE = /^[A-Za-z]{2}$/;

/**
 * How strongly nearness wins over a place's prominence (Photon's
 * `location_bias_scale`, 0..1, default 0.4) and how wide "near" is (`zoom`,
 * default 12). Checked against live results: at the defaults "Aldi" from
 * Papenburg put Lingen's before Papenburg's own; at these a family's own town
 * comes first and "Eiffel Tower" is still Paris.
 */
export const NEAR_ZOOM = 13;
export const NEAR_SCALE = 0.25;

/** The query Photon is sent. */
export function photonSearchParams({ query, limit, language, near, countryCode }: LocationSearchOptions): URLSearchParams {
  const lang = (PHOTON_LANGUAGES as readonly string[]).includes(language) ? language : "default";
  const params = new URLSearchParams({ q: query, limit: String(limit), lang });
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lon) && Math.abs(near.lat) <= 90 && Math.abs(near.lon) <= 180) {
    params.set("lat", String(near.lat));
    params.set("lon", String(near.lon));
    params.set("zoom", String(NEAR_ZOOM));
    params.set("location_bias_scale", String(NEAR_SCALE));
  } else if (countryCode && COUNTRY_CODE.test(countryCode)) {
    params.set("countrycode", countryCode.toUpperCase());
  }
  return params;
}

/** One Photon result (GeoJSON feature), the parts read here. */
export interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    locality?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    countrycode?: string;
  };
}

/** A search result as the Location field lists it. */
export interface LocationResult {
  /** Stable per place: OpenStreetMap's type and id. */
  place_id: string;
  lat: string;
  lon: string;
  /** The full line under the short form: every part Photon gave, once each. */
  display_name: string;
  address?: PlaceAddress;
}

/**
 * Photon names only the state ("Illinois"); the short form of a US, Canadian
 * or Australian address wants its code ("IL"). The codes are ISO 3166-2's.
 */
const STATE_CODES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  us: {
    Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
    Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
    Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
    Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE",
    Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI",
    "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA",
    Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "Puerto Rico": "PR",
  },
  ca: {
    Alberta: "AB", "British Columbia": "BC", Manitoba: "MB", "New Brunswick": "NB", "Newfoundland and Labrador": "NL",
    "Northwest Territories": "NT", "Nova Scotia": "NS", Nunavut: "NU", Ontario: "ON", "Prince Edward Island": "PE",
    Quebec: "QC", Québec: "QC", Saskatchewan: "SK", Yukon: "YT",
  },
  au: {
    "Australian Capital Territory": "ACT", "New South Wales": "NSW", "Northern Territory": "NT", Queensland: "QLD",
    "South Australia": "SA", Tasmania: "TAS", Victoria: "VIC", "Western Australia": "WA",
  },
};

/**
 * Where a name is an address part rather than the place itself: a street, a
 * town, a region, or a building with no name of its own.
 */
const NOT_A_PLACE_KEYS = new Set(["place", "highway", "boundary", "landuse"]);

/** A Photon result as the Location field lists it; null for one with no position. */
export function placeFromPhoton(feature: PhotonFeature): LocationResult | null {
  const p = feature.properties ?? {};
  const [lon, lat] = feature.geometry?.coordinates ?? [];
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  const country = p.countrycode?.toLowerCase();
  const stateCode = country && p.state ? STATE_CODES[country]?.[p.state] : undefined;
  const isPlace = Boolean(p.name) && !NOT_A_PLACE_KEYS.has(p.osm_key ?? "") && p.name !== p.street && p.name !== p.city;

  const address: PlaceAddress = {
    ...(isPlace ? { name: p.name } : {}),
    road: p.street,
    house_number: p.housenumber,
    // A town found as itself carries its name, not a `city`: "Springfield, IL".
    city: p.city ?? (p.osm_key === "place" ? p.name : undefined),
    county: p.county,
    state: p.state,
    postcode: p.postcode,
    country: p.country,
    country_code: country,
    ...(stateCode ? { "ISO3166-2-lvl4": `${country!.toUpperCase()}-${stateCode}` } : {}),
  };

  const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(" ") : undefined;
  const town = [p.postcode, p.city].filter(Boolean).join(" ") || undefined;
  const parts = [p.name, street, p.district, town, p.state, p.country].filter((part): part is string => Boolean(part));
  const display_name = parts.filter((part, i) => parts.indexOf(part) === i).join(", ");

  return {
    place_id: `${p.osm_type ?? "?"}${p.osm_id ?? `${lat},${lon}`}`,
    lat: String(lat),
    lon: String(lon),
    display_name,
    address,
  };
}

interface AddressStyle {
  /** "123 Main Street" rather than "Hauptstraße 5". */
  numberFirst: boolean;
  /** Before the city ("20095 Hamburg") or after it ("London SW1A 2AA"). */
  postcode: "before" | "after";
  /** The state or province code between the city and the postcode: "Springfield, IL 62701". */
  stateCode: boolean;
}

/** How most of Europe writes it, and what a result with no known country gets. */
const DEFAULT_STYLE: AddressStyle = { numberFirst: false, postcode: "before", stateCode: false };

const NORTH_AMERICAN_STYLE: AddressStyle = { numberFirst: true, postcode: "after", stateCode: true };
const BRITISH_STYLE: AddressStyle = { numberFirst: true, postcode: "after", stateCode: false };

const STYLES: Readonly<Record<string, AddressStyle>> = {
  us: NORTH_AMERICAN_STYLE,
  ca: NORTH_AMERICAN_STYLE,
  au: NORTH_AMERICAN_STYLE,
  gb: BRITISH_STYLE,
  ie: BRITISH_STYLE,
  nz: BRITISH_STYLE,
  fr: { numberFirst: true, postcode: "before", stateCode: false },
};

/** "US-IL" is "CA"; nothing when the result has no state or province. */
function stateCodeOf(address: PlaceAddress): string | null {
  const code = address["ISO3166-2-lvl4"]?.split("-")[1];
  return code && /^[A-Z0-9]{1,3}$/.test(code) ? code : null;
}

/**
 * A result as one short line, the way the place's own country writes it:
 * "Hauptstraße 5, 20095 Hamburg", "5 Rue de Rivoli, 75001 Paris",
 * "123 Main Street, Springfield, IL 62701", "10 Downing Street, London SW1A 2AA".
 * A place with a name of its own (a shop, a landmark, an office) leads with it.
 * A result with no street or town is written as its name, or its full line.
 */
export function formatPlace(address: PlaceAddress | undefined, displayName: string): string {
  if (!address) return displayName;
  const style = STYLES[address.country_code?.toLowerCase() ?? ""] ?? DEFAULT_STYLE;
  const parts: string[] = [];

  if (address.road) {
    const number = address.house_number;
    parts.push(number ? (style.numberFirst ? `${number} ${address.road}` : `${address.road} ${number}`) : address.road);
  }

  const city = address.city || address.town || address.village || address.municipality;
  if (city) {
    const postcode = address.postcode;
    if (style.postcode === "before") {
      parts.push(postcode ? `${postcode} ${city}` : city);
    } else {
      const state = style.stateCode ? stateCodeOf(address) : null;
      const town = state ? `${city}, ${state}` : city;
      parts.push(postcode ? `${town} ${postcode}` : town);
    }
  }

  if (parts.length === 0) return address.name ?? displayName;
  // A place that has a name of its own leads with it: "Sydney Opera House,
  // 2 Macquarie Street, Sydney, NSW 2000", not just the street it is on --
  // unless the name is the address ("10 Downing Street").
  const name = address.name && !parts.includes(address.name) ? address.name : null;
  return (name ? [name, ...parts] : parts).join(", ");
}
