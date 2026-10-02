import offered from "./data/offered.json";

/**
 * Where a family's holidays come from (RFC-014 §4.2): the `holiday_region`
 * setting, `{ code, chosen }`.
 */
export interface HolidayRegionSetting {
  /**
   * ISO 3166-2 (`DE-NI`, `AT-9`, `CH-ZH`, `GB-SCT`, `US-CA`) or a bare
   * country (`NL`). Null until someone picks one: no holidays are marked.
   */
  code: string | null;
  /** True once someone in the family picked or confirmed it; false for the migrated value. */
  chosen: boolean;
}

interface OfferedCountry {
  zones: string[];
  subdivisions: string[];
  /** OpenHolidays has school holidays for it (RFC-014 §4.3, §5.3). */
  openHolidays: boolean;
}

const COUNTRIES = (offered as { countries: Record<string, OfferedCountry> }).countries;

/** The offered countries (RFC-014 §4.3), generated -- the UI never hard-codes a list. */
export const OFFERED_COUNTRIES: readonly string[] = Object.keys(COUNTRIES).sort();

/** #319's five codes, as the regions they always meant. Accepted wherever a region is. */
export const LEGACY_REGIONS: Readonly<Record<string, string>> = Object.freeze({
  de: "DE-NI",
  uk: "GB-ENG",
  us: "US",
  nl: "NL",
  fr: "FR",
});

export interface ResolvedRegion {
  code: string;
  country: string;
  state: string | null;
}

const REGION_RE = /^([A-Z]{2})(?:-([A-Z0-9]{1,3}))?$/;

/**
 * A region code as the adapter needs it, or null when it is not offered.
 * State or canton level only: `DE-BY-A` (Augsburg) is a documented gap.
 */
export function resolveRegion(input: string | null | undefined): ResolvedRegion | null {
  if (typeof input !== "string") return null;
  const code = Object.prototype.hasOwnProperty.call(LEGACY_REGIONS, input) ? LEGACY_REGIONS[input] : input;
  const match = REGION_RE.exec(code);
  if (!match) return null;
  const country = match[1];
  const state = match[2] ?? null;
  const entry = COUNTRIES[country];
  if (!entry) return null;
  if (state !== null && !entry.subdivisions.includes(state)) return null;
  return { code, country, state };
}

export function isOfferedRegion(code: unknown): code is string {
  return typeof code === "string" && resolveRegion(code) !== null;
}

/** The states, cantons or nations offered for `country`; empty when it has none worth picking. */
export function subdivisionsOf(country: string): readonly string[] {
  return COUNTRIES[country]?.subdivisions ?? [];
}

export function regionCode(country: string, state: string | null): string {
  return state ? `${country}-${state}` : country;
}

/**
 * The stored setting, validated. Null when there is no usable object; a code
 * that is not offered reads as no region, so a stale or hand-edited row can
 * never pick holidays for somewhere Kinboard does not offer.
 */
export function parseRegionSetting(value: unknown): HolidayRegionSetting | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as { code?: unknown; chosen?: unknown };
  const resolved = typeof v.code === "string" ? resolveRegion(v.code) : null;
  const code = resolved?.code ?? null;
  return { code, chosen: v.chosen === true && code !== null };
}

const ZONE_TO_COUNTRY: ReadonlyMap<string, string> = new Map(
  Object.entries(COUNTRIES).flatMap(([country, { zones }]) => zones.map((zone) => [zone, country] as const)),
);

/** Does OpenHolidays carry school holidays for this country? False for GB, US and anything not offered. */
export function hasOpenHolidays(country: string): boolean {
  return COUNTRIES[country]?.openHolidays === true;
}

/** The country a timezone suggests, for the wizard's preselection; null when it suggests none. */
export function countryForTimeZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  return ZONE_TO_COUNTRY.get(zone) ?? null;
}

/**
 * The region a legacy `holiday_country` value meant (the migration's
 * mapping, for restores): `de`, nothing or anything unknown is
 * Niedersachsen, the only German list there was. Never chosen.
 */
export function legacyHolidayRegion(legacyCountry: unknown): HolidayRegionSetting {
  const code =
    typeof legacyCountry === "string" && Object.prototype.hasOwnProperty.call(LEGACY_REGIONS, legacyCountry)
      ? LEGACY_REGIONS[legacyCountry]
      : LEGACY_REGIONS.de;
  return { code, chosen: false };
}

/**
 * A backup's settings rows, with a `holiday_region` row added when it has
 * none -- a backup made before RFC-014 -- derived from its `holiday_country`.
 */
export function withHolidayRegion(rows: readonly unknown[], newId: () => string): unknown[] {
  const records = rows.filter(
    (r): r is Record<string, unknown> => typeof r === "object" && r !== null && !Array.isArray(r),
  );
  if (records.some((r) => r.key === "holiday_region")) return [...rows];
  const country = records.find((r) => r.key === "holiday_country")?.value;
  return [...rows, { id: newId(), key: "holiday_region", value: legacyHolidayRegion(country) }];
}
