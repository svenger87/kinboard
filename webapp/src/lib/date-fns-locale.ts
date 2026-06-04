import { de, enUS, fr, type Locale as DateFnsLocale } from "date-fns/locale";

/**
 * Maps an app UI locale code (from next-intl) to the matching date-fns locale
 * for date/time formatting. Falls back to en-US for anything unrecognized.
 *
 * Centralized so adding a locale is a one-line change here instead of editing
 * every `locale === "de" ? de : enUS` site across the app.
 */
export function getDateFnsLocale(locale: string): DateFnsLocale {
  switch (locale) {
    case "de":
      return de;
    case "fr":
      return fr;
    default:
      return enUS;
  }
}
