import { LOCALES, DEFAULT_LOCALE } from "./locales";

const BCP47: Record<string, string> = Object.fromEntries(
  LOCALES.map((l) => [l.code, l.bcp47])
);
const DEFAULT_BCP47 = BCP47[DEFAULT_LOCALE];

/**
 * Maps an app UI locale code (from next-intl) to its BCP-47 tag for
 * `Intl` / `toLocaleString` / `toLocaleDateString`. Falls back to the default
 * locale's tag for anything unrecognized.
 */
export function getIntlLocale(locale: string): string {
  return BCP47[locale] ?? DEFAULT_BCP47;
}
