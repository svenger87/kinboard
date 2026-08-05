import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { PushSubscription, NotificationPreferences } from "@/types/database";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

interface SubscribeRequest {
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  };
  deviceId: string;
  familyId: string;
  resubscribe?: boolean;
}

/**
 * POST /api/notifications/subscribe
 * Register a push subscription for a device
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    const body: SubscribeRequest = await request.json();
    const { subscription, deviceId, familyId } = body;

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json(
        { error: "Invalid subscription data" },
        { status: 400 }
      );
    }

    if (!deviceId || !familyId) {
      return NextResponse.json(
        { error: "deviceId and familyId are required" },
        { status: 400 }
      );
    }

    if (!familyMatchesSession(auth.session, familyId)) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }

    const supabase = createAdminClient();

    // Check if subscription with this endpoint already exists
    const { data: existingData } = await supabase
      .from("push_subscriptions")
      .select("id")
      .eq("endpoint", subscription.endpoint)
      .single();

    const existing = existingData as Pick<PushSubscription, "id"> | null;

    // Deactivate all OTHER subscriptions for this device (old/stale endpoints)
    // A device should only have one active push subscription at a time
     
    const deactivateQuery = (supabase as any)
      .from("push_subscriptions")
      .update({ is_active: false })
      .eq("device_id", deviceId)
      .eq("family_id", familyId)
      .neq("endpoint", subscription.endpoint);

    await deactivateQuery;

    if (existing) {
      // Update existing subscription
       
      const { error: updateError } = await (supabase as any)
        .from("push_subscriptions")
        .update({
          device_id: deviceId,
          family_id: familyId,
          p256dh_key: subscription.keys.p256dh,
          auth_key: subscription.keys.auth,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) {
        console.error("Error updating subscription:", updateError);
        return NextResponse.json(
          { error: "Failed to update subscription" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        subscriptionId: existing.id,
        updated: true,
      });
    }

    // Create new subscription
    const insertData = {
      device_id: deviceId,
      family_id: familyId,
      endpoint: subscription.endpoint,
      p256dh_key: subscription.keys.p256dh,
      auth_key: subscription.keys.auth,
      user_agent: request.headers.get("user-agent") || null,
      is_active: true,
    };

     
    const { data: newSubData, error: insertError } = await (supabase as any)
      .from("push_subscriptions")
      .insert(insertData)
      .select("id")
      .single();

    const newSub = newSubData as Pick<PushSubscription, "id"> | null;

    if (insertError) {
      console.error("Error creating subscription:", insertError);
      return NextResponse.json(
        { error: "Failed to create subscription" },
        { status: 500 }
      );
    }

    // Also create default notification preferences if they don't exist
    const prefsData = {
      family_id: familyId,
      device_id: deviceId,
      shopping_collaborative: true,
      shopping_reminders: true,
    };

     
    await (supabase as any)
      .from("notification_preferences")
      .upsert(prefsData, { onConflict: "family_id,device_id" });

    console.log(`[Subscribe] New push subscription created for device ${deviceId}`);

    return NextResponse.json({
      success: true,
      subscriptionId: newSub?.id,
      created: true,
    });
  } catch (error) {
    console.error("Error in subscribe:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
