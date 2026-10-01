import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  negotiateLocale,
  type Locale,
} from "./locales";
import { deepMerge } from "./deep-merge";

// Re-exported for back-compat: existing consumers import these from
// "@/i18n/request". The canonical definitions now live in ./locales.
export { SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE };
export type { Locale };

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const locale: Locale = negotiateLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerStore.get("accept-language"),
  );

  // English is the base; overlay the active locale so any untranslated key
  // falls back to English instead of rendering as a missing-key error. This is
  // what lets community locales ship partial coverage.
  const base = (await import("../../messages/en.json")).default;
  if (locale === DEFAULT_LOCALE) return { locale, messages: base };

  const override = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages: deepMerge(base, override) };
});
