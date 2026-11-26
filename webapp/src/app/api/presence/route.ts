import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { presenceSensorToken, tokensMatch } from "@/lib/api-keys";

// In-memory presence state (per device)
interface PresenceState {
  detected: boolean;
  lastSeen: number; // timestamp
  distance?: number; // optional distance from sensor in cm
}

// Store presence states in memory (resets on server restart, which is fine for transient state)
const presenceStates = new Map<string, PresenceState>();

async function familyDevice(request: NextRequest, deviceId: string) {
  const auth = await requireSession(request);
  if (!auth.ok) return { response: auth.response };
  const { data, error } = await createAdminClient().from("devices")
    .select("id").eq("id", deviceId).eq("family_id", auth.session.familyId).maybeSingle();
  if (error) return { response: NextResponse.json({ error: "device lookup failed" }, { status: 500 }) };
  if (!data) return { response: NextResponse.json({ error: "not found" }, { status: 404 }) };
  return { response: null };
}

// GET: Query presence state for a device
export async function GET(request: NextRequest) {
  const deviceId = request.nextUrl.searchParams.get("device_id");

  if (!deviceId) {
    return NextResponse.json({ error: "device_id required" }, { status: 400 });
  }
  const access = await familyDevice(request, deviceId);
  if (access.response) return access.response;

  const state = presenceStates.get(deviceId);

  if (!state) {
    return NextResponse.json({
      detected: false,
      lastSeen: null,
      stale: true,
    });
  }

  // Check if state is stale (older than 10 seconds - sensor should report every ~1s)
  const isStale = Date.now() - state.lastSeen > 10000;

  return NextResponse.json({
    detected: state.detected,
    lastSeen: state.lastSeen,
    distance: state.distance,
    stale: isStale,
  });
}

// POST: Update presence state from Pi sensor
//
// The sensor authenticates with a bearer token. Which token: the one of the
// family the reported device belongs to, set in Settings -> Devices, else the
// server's PRESENCE_SENSOR_TOKEN (lib/api-keys.ts, RFC-023 §4.4). So the body
// is read before the token is checked, to know the device; nothing in it is
// acted on until the token matches, and the comparison stays constant-time.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { device_id?: unknown; presence?: unknown; distance?: unknown }
    | null;

  let expected: string | null;
  try {
    expected = await presenceSensorToken(body?.device_id);
  } catch (err) {
    // Not the server's token as a fallback: the family may have replaced it
    // so that it stops working (presenceSensorToken).
    console.error("presence: could not look up the sensor token:", err);
    return NextResponse.json({ error: "presence sensor check failed" }, { status: 503 });
  }
  if (!expected) return NextResponse.json({ error: "presence sensor not configured" }, { status: 503 });
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!tokensMatch(supplied, expected)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { device_id, presence, distance } = body;
  if (!device_id || typeof device_id !== "string" || typeof presence !== "boolean") {
    return NextResponse.json(
      { error: "device_id and presence (boolean) required" },
      { status: 400 }
    );
  }

  presenceStates.set(device_id, {
    detected: presence,
    lastSeen: Date.now(),
    distance: typeof distance === "number" ? distance : undefined,
  });

  return NextResponse.json({ success: true });
}

// DELETE: Clear presence state for a device (for testing/debugging)
export async function DELETE(request: NextRequest) {
  const deviceId = request.nextUrl.searchParams.get("device_id");
  if (!deviceId) return NextResponse.json({ error: "device_id required" }, { status: 400 });
  const access = await familyDevice(request, deviceId);
  if (access.response) return access.response;
  presenceStates.delete(deviceId);

  return NextResponse.json({ success: true });
}
