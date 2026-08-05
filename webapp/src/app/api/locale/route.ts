import { NextRequest, NextResponse } from "next/server";
import {
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  type Locale,
} from "@/i18n/request";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

// Two things happen here, and only one of them is family data.
//
// Setting the locale cookie is a per-browser preference and stays open — the
// language switcher is on /join, before anyone has a family or a session, and
// making it 401 there would leave a visitor unable to read the page they are
// trying to join from. Writing the family's stored locale is family data, so
// naming a family requires a session for it.
export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid json body" },
      { status: 400 },
    );
  }

  const body = payload as { locale?: unknown; familyId?: unknown } | null;
  const locale = body?.locale;
  if (!isSupportedLocale(locale)) {
    return NextResponse.json(
      { error: "unsupported locale", supported: SUPPORTED_LOCALES },
      { status: 400 },
    );
  }

  const familyId = typeof body?.familyId === "string" ? body.familyId : null;
  if (familyId) {
    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;
    if (!familyMatchesSession(auth.session, familyId)) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }

    // Persist alongside the device cookie so server-side contexts with no
    // request cookie (crons, push payload generation) can resolve the
    // family's language. Best-effort: a failure here shouldn't block the
    // cookie-based locale switch the user is actively waiting on — the
    // cookie path below must never fail, even if familyId is stale (e.g.
    // a device cookie surviving a family deletion/reset).
    try {
      const supabase = createAdminClient();
      const { count } = await (supabase as any)
        .from("families")
        .select("id", { count: "exact", head: true })
        .eq("id", familyId);
      if (count) {
        await (supabase as any)
          .from("settings")
          .upsert(
            { family_id: familyId, key: SETTINGS_KEYS.locale, value: locale },
            { onConflict: "family_id,key" },
          );
      }
    } catch (error) {
      console.error("[api/locale] Failed to persist family locale setting:", error);
    }
  }

  const response = NextResponse.json({ locale });
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
  return response;
}
