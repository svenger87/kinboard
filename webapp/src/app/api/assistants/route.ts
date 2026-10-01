import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { createAdminClient } from "@/lib/supabase/server";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { assistantsEnabledFor, forgetAssistantsEnabled } from "@/lib/oauth/enabled";
import { logApiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

/**
 * The "Allow AI assistants" switch under Settings → Integrations (RFC-010).
 *
 * GET  → { enabled }
 * POST { enabled: boolean } → { enabled }
 *
 * The family is always the session's — the request carries only the
 * boolean. Changing it is a protected setting like the PIN itself: it needs
 * the server-side settings unlock (lib/settings-pin.ts), because switching
 * it on is the first step to handing the family's data to an assistant.
 *
 * Switching it off also revokes every assistant connection the family has
 * (integration_tokens rows with an oauth_client_id). "Off" has to mean the
 * assistants are gone, not merely that /api/mcp refuses them until someone
 * flips it back and they quietly work again. Manual tokens (Home Assistant)
 * are left alone — they are the Integration API, which this switch is not.
 */

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ enabled: await assistantsEnabledFor(auth.session.familyId) });
  } catch (err) {
    await logApiError("assistants/get", err);
    return NextResponse.json({ error: "Could not read the setting" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "`enabled` must be true or false" }, { status: 400 });
  }
  const enabled = body.enabled;
  const familyId = auth.session.familyId;

  try {
    const locked = await requireSettingsUnlock(auth.session);
    if (locked) return locked;

    const supabase = createAdminClient() as any;
    const { error } = await supabase.from("settings").upsert(
      { family_id: familyId, key: SETTINGS_KEYS.assistantsEnabled, value: enabled, updated_at: new Date().toISOString() },
      { onConflict: "family_id,key" },
    );
    if (error) throw error;

    if (!enabled) {
      const { error: revokeError } = await supabase
        .from("integration_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("family_id", familyId)
        .not("oauth_client_id", "is", null)
        .is("revoked_at", null);
      if (revokeError) throw revokeError;
    }
    forgetAssistantsEnabled();
    return NextResponse.json({ enabled });
  } catch (err) {
    await logApiError("assistants/set", err);
    return NextResponse.json({ error: "Could not change the setting" }, { status: 500 });
  }
}
