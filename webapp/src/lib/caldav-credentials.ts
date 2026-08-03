import { createAdminClient } from "@/lib/supabase/server";

/**
 * CalDAV username/password storage.
 *
 * Deliberately NOT routed through lib/integration-secrets.ts. That module
 * models one secret bundle per *integration* (`home_assistant`, `immich`,
 * …), keyed by a static entry in SECRET_FIELDS, and its split/merge helpers
 * exist to keep raw values out of the `settings` table that the browser
 * reads directly. CalDAV credentials are per *calendar* — a family can have
 * a Nextcloud calendar and a Fastmail one with different logins — so the
 * key is dynamic and SECRET_FIELDS' static path filter would drop it.
 *
 * What's kept from that module's model is the part that matters: the row
 * lives in public.integration_secrets, which is REVOKEd from anon and
 * authenticated (migration_integration_secrets.sql) and reachable only via
 * service_role. Credentials therefore never leave the server — no API
 * response includes them, and the settings UI re-collects the password to
 * change it rather than round-tripping a masked value.
 */

export interface CaldavCredentials {
  username: string;
  password: string;
}

/** integration_secrets key for one calendar's credentials. */
export function caldavSecretKey(calendarId: string): string {
  return `caldav:${calendarId}`;
}

export async function getCaldavCredentials(
  familyId: string,
  calendarId: string,
): Promise<CaldavCredentials | null> {
  const supabase = createAdminClient();

  const { data } = await (supabase as any)
    .from("integration_secrets")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", caldavSecretKey(calendarId))
    .maybeSingle();

  const value = data?.value as Partial<CaldavCredentials> | undefined;
  if (!value?.username || !value?.password) return null;
  return { username: value.username, password: value.password };
}

export async function saveCaldavCredentials(
  familyId: string,
  calendarId: string,
  credentials: CaldavCredentials,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await (supabase as any).from("integration_secrets").upsert(
    {
      family_id: familyId,
      key: caldavSecretKey(calendarId),
      value: credentials,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "family_id,key" },
  );
  if (error) {
    throw new Error(`Failed to store CalDAV credentials: ${error.message}`);
  }
}

/**
 * Drop a calendar's credentials. Called when the calendar row is deleted —
 * integration_secrets has no FK to calendars (it's keyed by family + an
 * opaque string), so the cascade has to be explicit or the row leaks.
 */
export async function deleteCaldavCredentials(
  familyId: string,
  calendarId: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await (supabase as any)
    .from("integration_secrets")
    .delete()
    .eq("family_id", familyId)
    .eq("key", caldavSecretKey(calendarId));
  if (error) {
    throw new Error(`Failed to delete CalDAV credentials: ${error.message}`);
  }
}
