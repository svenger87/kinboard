import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface UnsubscribeRequest {
  endpoint?: string;
  deviceId?: string;
}

/**
 * POST /api/notifications/unsubscribe
 * Remove a push subscription
 */
export async function POST(request: NextRequest) {
  try {
    const body: UnsubscribeRequest = await request.json();
    const { endpoint, deviceId } = body;

    if (!endpoint && !deviceId) {
      return NextResponse.json(
        { error: "Either endpoint or deviceId is required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    let query = supabase.from("push_subscriptions").delete();

    if (endpoint) {
      query = query.eq("endpoint", endpoint);
    } else if (deviceId) {
      query = query.eq("device_id", deviceId);
    }

    const { error } = await query;

    if (error) {
      console.error("Error removing subscription:", error);
      return NextResponse.json(
        { error: "Failed to remove subscription" },
        { status: 500 }
      );
    }

    console.log(`[Unsubscribe] Removed push subscription`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in unsubscribe:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
