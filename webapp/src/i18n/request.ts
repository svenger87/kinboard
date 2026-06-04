import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const SUPPORTED_LOCALES = ["en", "de", "fr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

function isSupported(value: string | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function negotiateFromAcceptLanguage(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.toLowerCase().split(",")) {
    const tag = part.split(";")[0].trim();
    if (tag.startsWith("de")) return "de";
    if (tag.startsWith("fr")) return "fr";
    if (tag.startsWith("en")) return "en";
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

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
