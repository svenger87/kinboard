import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { getPublicVapidKey } from "@/lib/push-sender";
import { devicesNeedingPush, vapidKeyFingerprint, type SubscriptionKeyRow } from "@/lib/push-key";

export const dynamic = "force-dynamic";

/**
 * The devices of the signed-in family that had push notifications with an
 * earlier VAPID key and not with the current one (RFC-023 §6.4): after a
 * restore without the config folder, or regenerated keys. Settings shows them
 * and asks for push to be turned on again on each.
 *
 * Compared with the key the server runs with now, not only at start, so a
 * dump restored into a running install shows the notice at once.
 *
 * GET  → { devices: [{ id, name }] }   (empty when nothing needs doing)
 * POST { action: "dismiss" } → removes the family's subscriptions made with
 *      an earlier key. They can never receive a push again; the notice goes.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const current = vapidKeyFingerprint(getPublicVapidKey());
  if (!current) return NextResponse.json({ devices: [] });
  try {
    const supabase = createAdminClient() as any;
    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("device_id, is_active, vapid_key_fingerprint, vapid_key_retired_at")
      .eq("family_id", auth.session.familyId);
    if (error) throw new Error(error.message);
    const ids = devicesNeedingPush((data ?? []) as SubscriptionKeyRow[], current);
    if (ids.length === 0) return NextResponse.json({ devices: [] });
    const { data: devices, error: devErr } = await supabase
      .from("devices")
      .select("id, name")
      .eq("family_id", auth.session.familyId)
      .in("id", ids);
    if (devErr) throw new Error(devErr.message);
    const names = new Map<string, string>(((devices ?? []) as Array<{ id: string; name: string | null }>).map((d) => [d.id, d.name ?? ""]));
    return NextResponse.json({ devices: ids.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id) ?? "" })) });
  } catch (err) {
    console.error("push-reset: read failed:", err);
    return NextResponse.json({ devices: [] });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  let action: unknown;
  try {
    action = ((await request.json()) as { action?: unknown })?.action;
  } catch {
    action = undefined;
  }
  if (action !== "dismiss") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const current = vapidKeyFingerprint(getPublicVapidKey());
  if (!current) return NextResponse.json({ ok: true });
  try {
    const { error } = await (createAdminClient() as any)
      .from("push_subscriptions")
      .delete()
      .eq("family_id", auth.session.familyId)
      .not("vapid_key_fingerprint", "is", null)
      .neq("vapid_key_fingerprint", current);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("push-reset: dismiss failed:", err);
    return NextResponse.json({ error: "could not dismiss" }, { status: 500 });
  }
}
