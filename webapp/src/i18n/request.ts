import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  LOCALES,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  type Locale,
} from "./locales";
import { deepMerge } from "./deep-merge";

// Re-exported for back-compat: existing consumers import these from
// "@/i18n/request". The canonical definitions now live in ./locales.
export { SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE };
export type { Locale };

function isSupported(value: string | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function negotiateFromAcceptLanguage(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.toLowerCase().split(",")) {
    const tag = part.split(";")[0].trim();
    const match = LOCALES.find((l) => tag.startsWith(l.code));
    if (match) return match.code;
  }
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isSupported(cookieLocale)
    ? cookieLocale
    : negotiateFromAcceptLanguage(headerStore.get("accept-language"));

  // English is the base; overlay the active locale so any untranslated key
  // falls back to English instead of rendering as a missing-key error. This is
  // what lets community locales ship partial coverage.
  const base = (await import("../../messages/en.json")).default;
  if (locale === DEFAULT_LOCALE) return { locale, messages: base };

  const override = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages: deepMerge(base, override) };
});
