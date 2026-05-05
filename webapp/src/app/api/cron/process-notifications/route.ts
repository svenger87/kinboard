import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendPushToMultiple, isVapidConfigured, DatabaseSubscription } from "@/lib/push-sender";
import type { PushSubscription, NotificationPreferences } from "@/types/database";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

interface ScheduledNotification {
  id: string;
  family_id: string;
  notification_type: string;
  scheduled_for: string;
  title: string;
  body: string | null;
  data: Record<string, string> | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  processed: boolean;
}

/**
 * POST /api/cron/process-notifications
 * Polls scheduled_notifications for unprocessed rows, batches by family+type,
 * respects preferences/quiet hours, sends push notifications, marks processed.
 *
 * Called by Ofelia cron every 30 seconds.
 */
export async function POST(request: NextRequest) {
  // Validate cron secret
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isVapidConfigured()) {
    return NextResponse.json({ error: "Push not configured" }, { status: 503 });
  }

  const supabase = createAdminClient();

  // Fetch all unprocessed notifications scheduled for now or earlier
  const { data: pendingData, error: fetchError } = await supabase
    .from("scheduled_notifications")
    .select("*")
    .eq("processed", false)
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(200);

  if (fetchError) {
    console.error("[process-notifications] Error fetching pending:", fetchError);
    return NextResponse.json({ error: "Failed to fetch pending notifications" }, { status: 500 });
  }

  const pending = (pendingData || []) as ScheduledNotification[];

  if (pending.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0 });
  }

  // Group by family_id + notification_type
  const groups = new Map<string, ScheduledNotification[]>();
  for (const notif of pending) {
    const key = `${notif.family_id}::${notif.notification_type}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(notif);
  }

  let totalSent = 0;
  let totalFailed = 0;
  const processedIds: string[] = [];

  for (const [, notifications] of Array.from(groups.entries())) {
    const familyId = notifications[0].family_id;
    const notificationType = notifications[0].notification_type;

    // Collect source device IDs to exclude from recipients
    const sourceDeviceIds = new Set<string>();
    for (const n of notifications) {
      const srcId = n.data?.source_device_id;
      if (srcId) sourceDeviceIds.add(srcId);
    }

    // Get active subscriptions for this family, excluding source devices
    const { data: subsData } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("family_id", familyId)
      .eq("is_active", true);

    let subscriptions = (subsData || []) as PushSubscription[];

    // Exclude source devices
    if (sourceDeviceIds.size > 0) {
      subscriptions = subscriptions.filter(
        (sub) => !sourceDeviceIds.has(sub.device_id)
      );
    }

    if (subscriptions.length === 0) {
      // No recipients — mark as processed anyway
      processedIds.push(...notifications.map((n) => n.id));
      continue;
    }

    // Check notification preferences
    const prefColumn = getPreferenceColumn(notificationType);
    const { data: prefsData } = await supabase
      .from("notification_preferences")
      .select("device_id, quiet_hours_enabled, quiet_hours_start, quiet_hours_end" + (prefColumn ? `, ${prefColumn}` : ""))
      .eq("family_id", familyId);

    const preferences = (prefsData || []) as (Pick<NotificationPreferences,
      "device_id" | "quiet_hours_enabled" | "quiet_hours_start" | "quiet_hours_end"
    > & Record<string, unknown>)[];

    const prefsMap = new Map(preferences.map((p) => [p.device_id, p]));

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

    const eligible = subscriptions.filter((sub) => {
      const prefs = prefsMap.get(sub.device_id);
      if (!prefs) return true;

      // Check type-specific preference
      if (prefColumn && prefs[prefColumn] === false) return false;

      // Check quiet hours
      if (prefs.quiet_hours_enabled) {
        const start = (prefs.quiet_hours_start as string) || "22:00";
        const end = (prefs.quiet_hours_end as string) || "07:00";
        if (start > end) {
          if (currentTime >= start || currentTime <= end) return false;
        } else {
          if (currentTime >= start && currentTime <= end) return false;
        }
      }

      return true;
    });

    if (eligible.length === 0) {
      processedIds.push(...notifications.map((n) => n.id));
      continue;
    }

    // Build notification payload
    const { title, body, tag, url } = buildNotificationPayload(notificationType, notifications);

    const result = await sendPushToMultiple(eligible as DatabaseSubscription[], {
      title,
      body,
      tag,
      url,
    });

    totalSent += result.sent;
    totalFailed += result.failed;

    // Deactivate expired subscriptions
    if (result.deactivated.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("push_subscriptions")
        .update({ is_active: false })
        .in("id", result.deactivated);
    }

    processedIds.push(...notifications.map((n) => n.id));
  }

  // Mark all processed notifications
  if (processedIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("scheduled_notifications")
      .update({ processed: true })
      .in("id", processedIds);
  }

  if (totalSent > 0 || totalFailed > 0) {
    console.log(`[process-notifications] Processed ${processedIds.length} notifications, sent ${totalSent}, failed ${totalFailed}`);
  }

  return NextResponse.json({
    processed: processedIds.length,
    sent: totalSent,
    failed: totalFailed,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Map notification_type to the preference column that controls it
 */
function getPreferenceColumn(type: string): string | null {
  switch (type) {
    case "shopping_collaborative":
      return "shopping_collaborative";
    case "todo_created":
    case "todo_assigned":
      return "todo_collaborative";
    default:
      return null;
  }
}

/**
 * Build push notification payload from a batch of scheduled notifications
 */
function buildNotificationPayload(
  type: string,
  notifications: ScheduledNotification[]
): { title: string; body: string; tag: string; url: string } {
  switch (type) {
    case "shopping_collaborative": {
      const items = notifications.map((n) => n.data?.item_name || n.body || "");
      const title = items.length === 1 ? "Neuer Artikel" : `${items.length} neue Artikel`;
      const body = items.length <= 3
        ? items.join(", ")
        : `${items.slice(0, 3).join(", ")} +${items.length - 3} weitere`;
      return { title, body, tag: "shopping-update", url: "/einkaufen" };
    }

    case "todo_assigned": {
      const items = notifications.map((n) => {
        const todoTitle = n.data?.todo_title || n.body || "";
        const personName = n.data?.person_name;
        return personName ? `${todoTitle} → ${personName}` : todoTitle;
      });
      const title = items.length === 1 ? "Aufgabe zugewiesen" : `${items.length} Aufgaben zugewiesen`;
      const body = items.length <= 3
        ? items.join(", ")
        : `${items.slice(0, 3).join(", ")} +${items.length - 3} weitere`;
      return { title, body, tag: "todo-update", url: "/todos" };
    }

    case "todo_created": {
      const items = notifications.map((n) => n.data?.todo_title || n.body || "");
      const title = items.length === 1 ? "Neue Aufgabe" : `${items.length} neue Aufgaben`;
      const body = items.length <= 3
        ? items.join(", ")
        : `${items.slice(0, 3).join(", ")} +${items.length - 3} weitere`;
      return { title, body, tag: "todo-update", url: "/todos" };
    }

    default: {
      const title = notifications[0].title;
      const body = notifications.map((n) => n.body).filter(Boolean).join(", ");
      return { title, body, tag: "notification", url: "/" };
    }
  }
}
