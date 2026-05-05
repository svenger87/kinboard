import { NextResponse } from "next/server";
import {
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  type Locale,
} from "@/i18n/request";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid json body" },
      { status: 400 },
    );
  }

  const locale = (payload as { locale?: unknown } | null)?.locale;
  if (!isSupportedLocale(locale)) {
    return NextResponse.json(
      { error: "unsupported locale", supported: SUPPORTED_LOCALES },
      { status: 400 },
    );
  }

  const response = NextResponse.json({ locale });
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
  return response;
}
