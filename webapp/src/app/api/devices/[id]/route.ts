import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { UUID } from "@/lib/home/action-requests";
import { parseDeviceOwner } from "@/lib/device-owner";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/devices/[id]  body: { person_id: <uuid> | null }
 *
 * Who a device belongs to (RFC-017 §8.2): a person of the family, or nobody.
 * A non-kiosk device that belongs to a child with a creature opens on that
 * child's Rewards page (lib/device-owner.ts, startRouteFor).
 *
 * A parent's setting, behind the settings PIN like the rest of Settings ->
 * Devices -- and the only way to write it: the browser roles hold no INSERT
 * or UPDATE privilege on devices.person_id
 * (migration_zzzzzzzzz_device_owner.sql), so a child's own phone cannot hand
 * itself to a sibling, or to nobody, by writing the column directly.
 *
 * The device and the person must both be the session's family's, and the
 * person not in the recycle bin. Answers with the whole device row, which the
 * screen puts in its store when it is the device it runs on.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = parseDeviceOwner(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;
  if (!UUID.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const familyId = auth.session.familyId;
  const db = createAdminClient() as any;

  if (parsed.personId !== null) {
    const { data: person, error: personErr } = await db
      .from("people")
      .select("id")
      .eq("id", parsed.personId)
      .eq("family_id", familyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (personErr) return NextResponse.json({ error: personErr.message }, { status: 500 });
    if (!person) return NextResponse.json({ error: "unknown_person" }, { status: 404 });
  }

  const { data, error } = await db
    .from("devices")
    .update({ person_id: parsed.personId })
    .eq("id", id)
    .eq("family_id", familyId)
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ device: data });
}
