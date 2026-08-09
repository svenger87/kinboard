import { createAdminClient } from "@/lib/supabase/server";

/**
 * Where a family's DLNA server lives.
 *
 * Plain `settings`, not `integration_secrets`: there is nothing secret here.
 * A DLNA server on the LAN has no credential to protect — that is the whole
 * appeal of it as a photo source, and pretending otherwise would put a
 * non-secret behind the server-only table for no benefit.
 */
export interface DlnaSettings {
  /** The device description XML the owner pasted. */
  description_url: string;
  /** ContentDirectory control endpoint, resolved at connect time. */
  control_url: string;
  friendly_name: string;
  /** Object id of the container to show photos from. "0" is the root. */
  selected_container?: string;
  selected_container_title?: string;
}

export const DLNA_SETTINGS_KEY = "dlna";

/** Read a family's DLNA settings, or null when it has none. */
export async function readDlnaSettings(familyId: string): Promise<DlnaSettings | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", DLNA_SETTINGS_KEY)
    .maybeSingle();

  if (error || !data) return null;
  const value = (data as { value: unknown }).value as DlnaSettings | null;
  if (!value?.control_url) return null;
  return value;
}
