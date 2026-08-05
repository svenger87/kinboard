import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications/subscription-status?deviceId=...&familyId=...
 * Check if a device has an active push subscription on the server
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get("deviceId");
  const familyId = searchParams.get("familyId");

  if (!deviceId || !familyId) {
    return NextResponse.json(
      { error: "deviceId and familyId are required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("id, is_active")
      .eq("device_id", deviceId)
      .eq("family_id", familyId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Error checking subscription status:", error);
      return NextResponse.json(
        { error: "Failed to check subscription status" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      isActive: data !== null,
    });
  } catch (error) {
    console.error("Error in subscription-status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
