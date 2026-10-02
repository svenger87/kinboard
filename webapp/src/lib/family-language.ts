import { createAdminClient } from "@/lib/supabase/server";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/i18n/locales";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { resolveRegion } from "@/lib/holidays/region";
import { familyHolidayRegion } from "@/lib/family-time";

/**
 * The language a region's country speaks, where Kinboard ships it. Small and
 * explicit on purpose: a country that is not here gets English.
 *
 * Switzerland is German: it is the majority language, and the cantons
 * OpenHolidays names in German are most of them. A French- or
 * Italian-speaking canton still gets German names until the family picks a
 * language; picking one always wins. Belgium and Luxembourg get French: of
 * the languages Kinboard ships, it is the one most of their families read
 * (Belgium's majority speaks Dutch, which Kinboard does not ship).
 */
export const COUNTRY_LANGUAGE: Readonly<Record<string, Locale>> = Object.freeze({
  DE: "de",
  AT: "de",
  LI: "de",
  CH: "de",
  FR: "fr",
  MC: "fr",
  LU: "fr",
  BE: "fr",
});

function isSupported(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** The language a holiday region's country suggests, or null when it suggests none Kinboard ships. */
export function regionLanguage(regionCode: string | null | undefined): Locale | null {
  const country = resolveRegion(regionCode)?.country;
  return (country && COUNTRY_LANGUAGE[country]) || null;
}

/**
 * The family's language for holiday and school data said on its behalf
 * (synced school-holiday names, public-holiday names, the region picker's
 * names, attention titles for assistants): the saved `locale` when it is
 * one Kinboard ships, else the language of the holiday region's country,
 * else English. The region counts whether or not it was chosen: a migrated
 * DE-NI is still a German family.
 *
 * Not for push: getFamilyLocale keeps its German fallback for the
 * notifications that always were German.
 */
export function resolveFamilyLanguage(savedLocale: unknown, regionCode: string | null | undefined): Locale {
  if (isSupported(savedLocale)) return savedLocale;
  return regionLanguage(regionCode) ?? DEFAULT_LOCALE;
}

/**
 * resolveFamilyLanguage, read from the family's settings. The region is only
 * read when no language is saved. Throws on a database error, so a caller
 * records it rather than naming things in a language nobody chose.
 */
export async function familyContentLanguage(
  familyId: string,
  db: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<Locale> {
  const { data, error } = await (db as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", SETTINGS_KEYS.locale)
    .maybeSingle();
  if (error) throw error;
  const saved = data?.value;
  if (isSupported(saved)) return saved;
  const region = await familyHolidayRegion(familyId, db);
  return resolveFamilyLanguage(saved, region?.code);
}
