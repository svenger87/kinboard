import { createHmac, timingSafeEqual } from "node:crypto";
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

// ---------------------------------------------------------------------------
// Signing image URLs
// ---------------------------------------------------------------------------

/**
 * The image proxy takes a URL as a parameter, which is the shape of an open
 * proxy. The first version pinned it to the host of the configured server —
 * and that broke against a real MiniDLNA, which advertises its own detected
 * address in the photo URLs rather than the one you reached it on. Pinning was
 * both too strict for honest servers and weaker than it looked.
 *
 * So the URLs are signed instead. Only URLs Kinboard itself produced, while
 * browsing that family's own server, can be fetched back through the proxy —
 * which is the actual property worth having, and it holds no matter how many
 * addresses the media server answers to.
 */
function signingKey(): string {
  const secret = process.env.JWT_SECRET || process.env.PGRST_JWT_SECRET;
  if (!secret) {
    throw new Error("dlna: JWT_SECRET is not set — cannot sign image URLs");
  }
  return secret;
}

/** A short HMAC binding a target URL to one family. */
export function signImageUrl(familyId: string, url: string): string {
  return createHmac("sha256", signingKey())
    .update(`${familyId}\n${url}`)
    .digest("base64url")
    .slice(0, 32);
}

/** Constant-time check that this URL was signed for this family. */
export function verifyImageUrl(familyId: string, url: string, signature: string): boolean {
  let expected: string;
  try {
    expected = signImageUrl(familyId, url);
  } catch {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
