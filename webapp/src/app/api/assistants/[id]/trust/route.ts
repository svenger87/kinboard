import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { familyHasPin, verifySettingsPin } from "@/lib/settings-pin";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import { setAssistantTrust, type TrustDeps } from "@/lib/assistant-trust";

export const dynamic = "force-dynamic";

/**
 * POST /api/assistants/{id}/trust — `{ trusted: true, pin }` or `{ trusted: false }`
 *
 * "Trust this assistant", per assistant connection ({id} is its
 * integration_tokens row). A session route: a person at a Kinboard screen,
 * never an Integration API token. On needs the settings PIN in the body,
 * checked with the shared limiter; off needs none. The family is always the
 * session's — another family's id is the same 404 as one that does not
 * exist. lib/assistant-trust.ts has the rules.
 */

const db = () => createAdminClient() as any;

const liveTrustDeps: TrustDeps = {
  hasPin: (familyId) => familyHasPin(familyId),
  verifyPin: (familyId, pin) => verifySettingsPin(familyId, pin),
  async setTrust({ familyId, tokenId, trusted, deviceId }) {
    let query = db()
      .from("integration_tokens")
      .update(trusted
        ? { trusted_at: new Date().toISOString(), trusted_by_device_id: deviceId }
        : { trusted_at: null, trusted_by_device_id: null })
      .eq("id", tokenId)
      .eq("family_id", familyId);
    // Only a live assistant connection can be trusted; anything can be untrusted.
    if (trusted) query = query.not("oauth_client_id", "is", null).is("revoked_at", null);
    const { data, error } = await query.select("id");
    if (error) throw new Error(`Failed to change the trust: ${error.message}`);
    return (data ?? []).length > 0 ? "ok" : "not_found";
  },
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  try {
    const result = await setAssistantTrust(
      { familyId: auth.session.familyId, deviceId: auth.session.deviceId, tokenId: id, body },
      liveTrustDeps,
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    await logApiError("assistants/trust", err);
    return NextResponse.json({ error: "Could not change the setting" }, { status: 500 });
  }
}
