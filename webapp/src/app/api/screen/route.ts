import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { parseDeviceScreen } from "@/lib/device-screen";

export const dynamic = "force-dynamic";

/**
 * POST /api/screen  body: DeviceScreen (lib/device-screen.ts)
 *
 * A screen reports its own size on its check-in, when it has changed. It
 * writes the session's own device and nothing else: the device is taken from
 * the session, never from the request, so a screen cannot set another's
 * size. The browser roles hold no write privilege on devices.screen
 * (migrations/085_device_screen.sql), so this route is the only way in.
 *
 * No settings PIN: a screen's size is a fact about the screen, not a choice
 * a parent makes, and the report runs unattended. That is also why it is not
 * under api/devices, where every mutating route asks for the PIN
 * (e2e/creatures-surfaces.spec.ts). A session with no device (a fresh join still settling)
 * gets 204 and nothing is written.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = parseDeviceScreen(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { familyId, deviceId } = auth.session;
  if (!deviceId) return new NextResponse(null, { status: 204 });

  const db = createAdminClient() as any;
  const screen = { ...parsed.screen, reportedAt: new Date().toISOString() };
  const { data, error } = await db
    .from("devices")
    .update({ screen })
    .eq("id", deviceId)
    .eq("family_id", familyId)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ screen });
}
