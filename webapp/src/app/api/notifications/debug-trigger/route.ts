import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendPushToMultiple, isVapidConfigured, DatabaseSubscription } from "@/lib/push-sender";
import type { PushSubscription } from "@/types/database";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications/debug-trigger
 * Debug endpoint to check notification system status.
 *
 * Query params:
 *   familyId - required
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const familyId = searchParams.get("familyId");

  if (!familyId) {
    return NextResponse.json({ error: "familyId query param required" }, { status: 400 });
  }

   
  const supabase = createAdminClient() as any;

  // Get pending notifications
  const { data: pending } = await supabase
    .from("scheduled_notifications")
    .select("id, notification_type, title, body, processed, scheduled_for, created_at")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false })
    .limit(20);

  // Get active subscriptions
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, device_id, is_active, user_agent, created_at")
    .eq("family_id", familyId);

  // Get notification preferences
  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select("device_id, shopping_collaborative, todo_collaborative, todo_reminders, quiet_hours_enabled, quiet_hours_start, quiet_hours_end")
    .eq("family_id", familyId);

  return NextResponse.json({
    vapid_configured: isVapidConfigured(),
    family_id: familyId,
    subscriptions: subs || [],
    preferences: prefs || [],
    recent_notifications: pending || [],
  });
}

/**
 * POST /api/notifications/debug-trigger
 * Debug endpoint to manually trigger notifications.
 *
 * Actions:
 *   action=process     - Process all pending notifications now (same as cron)
 *   action=test-push   - Send a test push to all family devices
 *   action=insert-test - Insert a test notification into the queue
 *
 * Body: { familyId, action, deviceId? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { familyId, action, deviceId } = body;

    if (!familyId) {
      return NextResponse.json({ error: "familyId required" }, { status: 400 });
    }

     
    const supabase = createAdminClient() as any;

    switch (action) {
      case "process": {
        // Process pending notifications for this family
        const { data: pending } = await supabase
          .from("scheduled_notifications")
          .select("*")
          .eq("family_id", familyId)
          .eq("processed", false)
          .lte("scheduled_for", new Date().toISOString())
          .order("scheduled_for", { ascending: true });

        if (!pending || pending.length === 0) {
          return NextResponse.json({ message: "No pending notifications", processed: 0 });
        }

        // Get subscriptions
        const { data: subsData } = await supabase
          .from("push_subscriptions")
          .select("*")
          .eq("family_id", familyId)
          .eq("is_active", true);

        const subscriptions = (subsData || []) as PushSubscription[];

        if (subscriptions.length === 0) {
          // Mark as processed since no one to send to
          await supabase
            .from("scheduled_notifications")
            .update({ processed: true })
            .in("id", pending.map((n: { id: string }) => n.id));

          return NextResponse.json({ message: "No active subscriptions", processed: pending.length, sent: 0 });
        }

        // Send all pending as individual notifications for debugging
        let totalSent = 0;
        for (const notif of pending) {
          const result = await sendPushToMultiple(subscriptions as DatabaseSubscription[], {
            title: notif.title,
            body: notif.body || "",
            tag: `debug-${notif.notification_type}`,
            url: notif.notification_type.startsWith("todo") ? "/todos" : "/einkaufen",
          });
          totalSent += result.sent;
        }

        // Mark as processed
         
        await (supabase as any)
          .from("scheduled_notifications")
          .update({ processed: true })
          .in("id", pending.map((n: { id: string }) => n.id));

        return NextResponse.json({ processed: pending.length, sent: totalSent });
      }

      case "test-push": {
        if (!isVapidConfigured()) {
          return NextResponse.json({ error: "VAPID not configured" }, { status: 503 });
        }

        // Get subscriptions (optionally filter to a specific device)
        let query = supabase
          .from("push_subscriptions")
          .select("*")
          .eq("family_id", familyId)
          .eq("is_active", true);

        if (deviceId) {
          query = query.eq("device_id", deviceId);
        }

        const { data: subsData } = await query;
        const subscriptions = (subsData || []) as PushSubscription[];

        if (subscriptions.length === 0) {
          return NextResponse.json({ error: "No active subscriptions found" }, { status: 404 });
        }

        const result = await sendPushToMultiple(subscriptions as DatabaseSubscription[], {
          title: "Test-Benachrichtigung",
          body: `Server-side push funktioniert! (${new Date().toLocaleTimeString("de-DE")})`,
          tag: "debug-test",
          url: "/settings/notifications",
        });

        return NextResponse.json({
          message: "Test notification sent",
          sent: result.sent,
          failed: result.failed,
          targets: subscriptions.length,
        });
      }

      case "insert-test": {
        // Insert a test notification into the queue (will be picked up by cron)
        const { data: inserted, error: insertError } = await supabase
          .from("scheduled_notifications")
          .insert({
            family_id: familyId,
            notification_type: "shopping_collaborative",
            scheduled_for: new Date().toISOString(),
            title: "Test-Artikel",
            body: "Debug-Testartikel",
            data: {
              item_name: "Debug-Testartikel",
              source_device_id: deviceId || "",
            },
            related_entity_type: "debug",
            processed: false,
          })
          .select()
          .single();

        if (insertError) {
          return NextResponse.json({ error: insertError.message }, { status: 500 });
        }

        return NextResponse.json({
          message: "Test notification queued - will be processed in next cron cycle (~30s)",
          notification: inserted,
        });
      }

      default:
        return NextResponse.json({
          error: "Unknown action. Use: process, test-push, or insert-test",
          usage: {
            process: "Process all pending notifications now",
            "test-push": "Send a test push to all family devices immediately",
            "insert-test": "Insert a test notification into the queue (picked up by cron in ~30s)",
          },
        }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[debug-trigger] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
