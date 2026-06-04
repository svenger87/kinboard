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
