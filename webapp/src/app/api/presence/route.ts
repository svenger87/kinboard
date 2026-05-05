import { NextRequest, NextResponse } from "next/server";

// In-memory presence state (per device)
interface PresenceState {
  detected: boolean;
  lastSeen: number; // timestamp
  distance?: number; // optional distance from sensor in cm
}

// Store presence states in memory (resets on server restart, which is fine for transient state)
const presenceStates = new Map<string, PresenceState>();

// GET: Query presence state for a device
export async function GET(request: NextRequest) {
  const deviceId = request.nextUrl.searchParams.get("device_id");

  if (!deviceId) {
    return NextResponse.json({ error: "device_id required" }, { status: 400 });
  }

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
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { device_id, presence, distance } = body;

    if (!device_id || typeof presence !== "boolean") {
      return NextResponse.json(
        { error: "device_id and presence (boolean) required" },
        { status: 400 }
      );
    }

    presenceStates.set(device_id, {
      detected: presence,
      lastSeen: Date.now(),
      distance: distance ?? undefined,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}

// DELETE: Clear presence state for a device (for testing/debugging)
export async function DELETE(request: NextRequest) {
  const deviceId = request.nextUrl.searchParams.get("device_id");

  if (deviceId) {
    presenceStates.delete(deviceId);
  } else {
    presenceStates.clear();
  }

  return NextResponse.json({ success: true });
}
