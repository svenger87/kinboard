import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { PushSubscription, NotificationPreferences } from "@/types/database";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { getPublicVapidKey } from "@/lib/push-sender";
import { KEY_CHANGED_ERROR, subscribeKeyVerdict, vapidKeyFingerprint } from "@/lib/push-key";

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
  /**
   * The VAPID public key the browser made this subscription with
   * (`subscription.options.applicationServerKey`, base64url), when it says.
   */
  applicationServerKey?: string | null;
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
      .select("id, vapid_key_fingerprint")
      .eq("endpoint", subscription.endpoint)
      .single();

    const existing = existingData as Pick<PushSubscription, "id" | "vapid_key_fingerprint"> | null;

    // A subscription made with another VAPID key than the one this server
    // runs with can never receive a push from it (RFC-023 §6.4): the keys were
    // regenerated, or the install was restored without its config folder.
    // Reviving it would show push as on while nothing arrives. The browser
    // drops it on this answer, and the device turns push on again.
    const currentKey = vapidKeyFingerprint(getPublicVapidKey());
    const clientKey = typeof body.applicationServerKey === "string" ? vapidKeyFingerprint(body.applicationServerKey) : null;
    if (subscribeKeyVerdict(currentKey, existing?.vapid_key_fingerprint ?? null, clientKey) === "key_changed") {
      return NextResponse.json(
        { error: KEY_CHANGED_ERROR, message: "This subscription was made with an earlier push key; subscribe again." },
        { status: 409 }
      );
    }

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
          ...(currentKey ? { vapid_key_fingerprint: currentKey, vapid_key_retired_at: null } : {}),
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
      vapid_key_fingerprint: currentKey,
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
