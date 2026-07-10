import { createAdminClient } from "@/lib/supabase/server";
import { SUPPORTED_LOCALES, type Locale } from "@/i18n/locales";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

// Family-level UI locale for server-side contexts (crons, push payloads)
// that have no request cookie. Falls back to "de" — the pre-existing
// hardcoded language of all server-generated notifications, so unset
// installs behave exactly as before.
export async function getFamilyLocale(familyId: string): Promise<string> {
  try {
    const supabase = createAdminClient();

    const { data } = await (supabase as any)
      .from("settings")
      .select("value")
      .eq("family_id", familyId)
      .eq("key", SETTINGS_KEYS.locale)
      .maybeSingle();
    const value = data?.value;
    return isSupportedLocale(value) ? value : "de";
  } catch {
    // A locale lookup failure must never fail a notification batch that
    // would previously have gone out (in German) unconditionally.
    return "de";
  }
}
