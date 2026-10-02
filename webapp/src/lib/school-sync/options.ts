import {
  OPENHOLIDAYS_ORIGIN,
  fetchSchoolHolidayRows,
  getOpenHolidaysJson,
  syncWindow,
  type OpenHolidaysDeps,
} from "./openholidays";
import { applicableGroups, childrenReferenced, parseGroups, parseSubdivisions } from "./school-region";
import type { RegionOptions } from "./reconcile";

const DAY_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, now: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && now - hit.at < DAY_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: now, value });
  return value;
}

/** For the specs: forget everything cached. */
export function resetOptionsCache(): void {
  cache.clear();
}

/**
 * What a family in `country` can pick (RFC-014 §5.3): the top-level
 * subdivisions and, for `subdivision`, the children its rows are scoped to
 * (Graubünden's Regions) and the groups that apply. Fetched through the
 * sync's own checked path and cached for a day, so the picker costs
 * OpenHolidays a few requests a day per country, not one per click.
 */
export async function schoolRegionOptions(
  country: string,
  subdivision: string | null,
  language: string,
  deps: OpenHolidaysDeps & { now: () => Date },
): Promise<RegionOptions> {
  const now = deps.now().getTime();
  const lang = language.toUpperCase();
  const subdivisions = await cached(`subdivisions|${country}|${lang}`, now, async () =>
    parseSubdivisions(
      await getOpenHolidaysJson(`${OPENHOLIDAYS_ORIGIN}/Subdivisions?countryIsoCode=${country}&languageIsoCode=${lang}`, deps),
      language,
    ),
  );
  const groups = await cached(`groups|${country}|${lang}`, now, async () =>
    parseGroups(await getOpenHolidaysJson(`${OPENHOLIDAYS_ORIGIN}/Groups?countryIsoCode=${country}&languageIsoCode=${lang}`, deps), language),
  );
  const top = subdivisions.map(({ code, name }) => ({ code, name }));
  const parent = subdivision ? subdivisions.find((s) => s.code === subdivision) : undefined;
  if (!parent) return { subdivisions: top, children: [], groups: [] };

  const rows = await cached(`rows|${parent.code}|${lang}`, now, () =>
    fetchSchoolHolidayRows(
      { country, region: parent.code, group: null },
      syncWindow(new Date(now).toISOString().slice(0, 10)),
      language,
      deps,
    ),
  );
  const referenced = new Set(childrenReferenced(parent.code, rows));
  return {
    subdivisions: top,
    children: parent.children.filter((c) => referenced.has(c.code)),
    groups: applicableGroups(parent.code, groups).map(({ code, name }) => ({ code, name })),
  };
}
