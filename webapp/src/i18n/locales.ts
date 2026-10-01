// Single source of truth for every locale Kinboard ships.
//
// To add a locale:
//   1. Add one entry below.
//   2. Add a `case` to getDateFnsLocale() in src/lib/date-fns-locale.ts
//      (date-fns Locale objects can't live here without pulling date-fns into
//      the client bundle).
//   3. Drop in messages/<code>.json — partial is fine, untranslated keys fall
//      back to English (see src/i18n/request.ts).
//
// Everything else — locale negotiation, both language switchers, and Intl
// date/number formatting — derives from this array automatically.
export const LOCALES = [
  { code: "en", label: "EN", native: "English", bcp47: "en-US" },
  { code: "de", label: "DE", native: "Deutsch", bcp47: "de-DE" },
  { code: "fr", label: "FR", native: "Français", bcp47: "fr-FR" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const SUPPORTED_LOCALES: readonly Locale[] = LOCALES.map((l) => l.code);

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "NEXT_LOCALE";

function isSupportedLocale(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * The locale a request is served in: the `NEXT_LOCALE` cookie when it names
 * a supported locale, else the first supported language in Accept-Language,
 * else English. `src/i18n/request.ts` uses it for pages; server routes that
 * put text into their JSON use it so the text matches the page around it.
 */
export function negotiateLocale(cookieValue: string | null | undefined, acceptLanguage: string | null): Locale {
  if (isSupportedLocale(cookieValue)) return cookieValue;
  if (!acceptLanguage) return DEFAULT_LOCALE;
  for (const part of acceptLanguage.toLowerCase().split(",")) {
    const tag = part.split(";")[0].trim();
    const match = LOCALES.find((l) => tag.startsWith(l.code));
    if (match) return match.code;
  }
  return DEFAULT_LOCALE;
}
