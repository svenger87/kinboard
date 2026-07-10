import { NextResponse } from "next/server";
import { getPublicVapidKey, isVapidConfigured } from "@/lib/push-sender";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications/vapid-key
 * Returns the public VAPID key for push subscription
 */
export async function GET() {
  if (!isVapidConfigured()) {
    // Degrade gracefully: 200 with configured:false, not a 500/503. Callers
    // must check body.configured rather than relying on res.ok alone.
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  const publicKey = getPublicVapidKey();

  return NextResponse.json({
    configured: true,
    publicKey,
    supported: true,
  });
}
