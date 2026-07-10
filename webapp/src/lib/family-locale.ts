import { createAdminClient } from "@/lib/supabase/server";
import { SUPPORTED_LOCALES, type Locale } from "@/i18n/locales";

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
  const supabase = createAdminClient();

  const { data } = await (supabase as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", "locale")
    .maybeSingle();
  const value = data?.value;
  return isSupportedLocale(value) ? value : "de";
}
