import { NextResponse } from "next/server";
import { getPublicVapidKey, isVapidConfigured } from "@/lib/push-sender";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications/vapid-key
 * Returns the public VAPID key for push subscription
 */
export async function GET() {
  if (!isVapidConfigured()) {
    return NextResponse.json(
      { error: "Push notifications not configured" },
      { status: 503 }
    );
  }

  const publicKey = getPublicVapidKey();

  return NextResponse.json({
    publicKey,
    supported: true,
  });
}
