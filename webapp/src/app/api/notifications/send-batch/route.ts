import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendPushToMultiple, isVapidConfigured, DatabaseSubscription } from "@/lib/push-sender";
import type { PushSubscription, NotificationPreferences } from "@/types/database";

export const dynamic = "force-dynamic";

interface SendBatchRequest {
  familyId: string;
  deviceId: string; // The device that triggered the notification (to exclude from recipients)
  items: string[];  // List of item names added
}

/**
 * POST /api/notifications/send-batch
 * Send a batched shopping notification to all family devices
 */
export async function POST(request: NextRequest) {
  try {
    if (!isVapidConfigured()) {
      return NextResponse.json(
        { error: "Push notifications not configured" },
        { status: 503 }
      );
    }

    const requestBody: SendBatchRequest = await request.json();
    const { familyId, deviceId, items } = requestBody;

    if (!familyId || !items || items.length === 0) {
      return NextResponse.json(
        { error: "familyId and items are required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Get all active subscriptions for this family EXCEPT the sender device
    let query = supabase
      .from("push_subscriptions")
      .select("*")
      .eq("family_id", familyId)
      .eq("is_active", true);

    // Exclude the sender device if provided
    if (deviceId) {
      query = query.neq("device_id", deviceId);
    }

    const { data: subscriptionsData, error: fetchError } = await query;
    const subscriptions = subscriptionsData as PushSubscription[] | null;

    if (fetchError) {
      console.error("Error fetching subscriptions:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch subscriptions" },
        { status: 500 }
      );
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log(`[SendBatch] No active subscriptions for family ${familyId}`);
      return NextResponse.json({ sent: 0, skipped: "no_subscriptions" });
    }

    // Check notification preferences for each subscription
    const { data: preferencesData } = await supabase
      .from("notification_preferences")
      .select("device_id, shopping_collaborative, quiet_hours_enabled, quiet_hours_start, quiet_hours_end")
      .eq("family_id", familyId);

    const preferences = preferencesData as Pick<NotificationPreferences,
      "device_id" | "shopping_collaborative" | "quiet_hours_enabled" | "quiet_hours_start" | "quiet_hours_end"
    >[] | null;

    const prefsMap = new Map(
      (preferences || []).map((p) => [p.device_id, p])
    );

    // Filter subscriptions based on preferences and quiet hours
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

    const eligibleSubscriptions = subscriptions.filter((sub) => {
      const prefs = prefsMap.get(sub.device_id);

      // If no preferences, default to receiving notifications
      if (!prefs) return true;

      // Check if shopping notifications are enabled
      if (prefs.shopping_collaborative === false) return false;

      // Check quiet hours
      if (prefs.quiet_hours_enabled) {
        const start = prefs.quiet_hours_start || "22:00";
        const end = prefs.quiet_hours_end || "07:00";

        // Handle overnight quiet hours (e.g., 22:00 - 07:00)
        if (start > end) {
          // Quiet if current time is after start OR before end
          if (currentTime >= start || currentTime <= end) {
            console.log(`[SendBatch] Device ${sub.device_id} in quiet hours`);
            return false;
          }
        } else {
          // Normal range (e.g., 12:00 - 14:00)
          if (currentTime >= start && currentTime <= end) {
            console.log(`[SendBatch] Device ${sub.device_id} in quiet hours`);
            return false;
          }
        }
      }

      return true;
    });

    if (eligibleSubscriptions.length === 0) {
      console.log(`[SendBatch] No eligible subscriptions after filtering`);
      return NextResponse.json({ sent: 0, skipped: "quiet_hours_or_disabled" });
    }

    // Build notification content
    // Note: iOS shows "FROM [app name]" automatically, so we use descriptive titles
    const title = items.length === 1
      ? "Neuer Artikel"
      : `${items.length} neue Artikel`;
    const notificationBody = items.length <= 3
      ? items.join(", ")
      : `${items.slice(0, 3).join(", ")} +${items.length - 3} weitere`;

    // Send notifications
    const result = await sendPushToMultiple(eligibleSubscriptions as DatabaseSubscription[], {
      title,
      body: notificationBody,
      tag: "shopping-update",
      url: "/einkaufen",
      icon: "/icons/icon-shopping-192.png",
    });

    // Deactivate failed subscriptions
    if (result.deactivated.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("push_subscriptions")
        .update({ is_active: false })
        .in("id", result.deactivated);

      console.log(`[SendBatch] Deactivated ${result.deactivated.length} expired subscriptions`);
    }

    console.log(`[SendBatch] Sent ${result.sent}/${eligibleSubscriptions.length} notifications for family ${familyId}`);

    return NextResponse.json({
      sent: result.sent,
      failed: result.failed,
      deactivated: result.deactivated.length,
    });
  } catch (error) {
    console.error("Error in send-batch:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
