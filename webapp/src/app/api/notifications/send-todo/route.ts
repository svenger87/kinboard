import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendPushToMultiple, isVapidConfigured, DatabaseSubscription } from "@/lib/push-sender";
import { getPushTranslator } from "@/lib/notifications/messages";
import { getFamilyLocale } from "@/lib/family-locale";
import type { PushSubscription, NotificationPreferences } from "@/types/database";

export const dynamic = "force-dynamic";

interface TodoNotificationItem {
  title: string;
  personName?: string;
}

interface SendTodoRequest {
  familyId: string;
  deviceId: string;
  type: "created" | "assigned";
  items: TodoNotificationItem[];
}

export async function POST(request: NextRequest) {
  try {
    if (!isVapidConfigured()) {
      return NextResponse.json(
        { error: "Push notifications not configured" },
        { status: 503 }
      );
    }

    const requestBody: SendTodoRequest = await request.json();
    const { familyId, deviceId, type, items } = requestBody;

    if (!familyId || !items || items.length === 0) {
      return NextResponse.json(
        { error: "familyId and items are required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Get all active subscriptions except sender
    let query = supabase
      .from("push_subscriptions")
      .select("*")
      .eq("family_id", familyId)
      .eq("is_active", true);

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
      return NextResponse.json({ sent: 0, skipped: "no_subscriptions" });
    }

    // Check preferences
    const { data: preferencesData } = await supabase
      .from("notification_preferences")
      .select("device_id, todo_collaborative, quiet_hours_enabled, quiet_hours_start, quiet_hours_end")
      .eq("family_id", familyId);

    const preferences = preferencesData as Pick<NotificationPreferences,
      "device_id" | "todo_collaborative" | "quiet_hours_enabled" | "quiet_hours_start" | "quiet_hours_end"
    >[] | null;

    const prefsMap = new Map(
      (preferences || []).map((p) => [p.device_id, p])
    );

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

    const eligibleSubscriptions = subscriptions.filter((sub) => {
      const prefs = prefsMap.get(sub.device_id);
      if (!prefs) return true;

       
      if ((prefs as any).todo_collaborative === false) return false;

      if (prefs.quiet_hours_enabled) {
        const start = prefs.quiet_hours_start || "22:00";
        const end = prefs.quiet_hours_end || "07:00";

        if (start > end) {
          if (currentTime >= start || currentTime <= end) return false;
        } else {
          if (currentTime >= start && currentTime <= end) return false;
        }
      }

      return true;
    });

    if (eligibleSubscriptions.length === 0) {
      return NextResponse.json({ sent: 0, skipped: "quiet_hours_or_disabled" });
    }

    // Build notification content
    const locale = await getFamilyLocale(familyId);
    const t = getPushTranslator(locale);
    let title: string;
    let body: string;

    if (type === "assigned") {
      title = items.length === 1 ? t("todoAssignedOne") : t("todoAssignedMany", { count: items.length });
      body = items.length <= 3
        ? items.map((i) => `${i.title} → ${i.personName}`).join(", ")
        : `${items.slice(0, 3).map((i) => `${i.title} → ${i.personName}`).join(", ")} ${t("moreSuffix", { count: items.length - 3 })}`;
    } else {
      title = items.length === 1 ? t("todoNewOne") : t("todoNewMany", { count: items.length });
      body = items.length <= 3
        ? items.map((i) => i.title).join(", ")
        : `${items.slice(0, 3).map((i) => i.title).join(", ")} ${t("moreSuffix", { count: items.length - 3 })}`;
    }

    const result = await sendPushToMultiple(eligibleSubscriptions as DatabaseSubscription[], {
      title,
      body,
      tag: "todo-update",
      url: "/todos",
    });

    // Deactivate failed subscriptions
    if (result.deactivated.length > 0) {
       
      await (supabase as any)
        .from("push_subscriptions")
        .update({ is_active: false })
        .in("id", result.deactivated);
    }

    return NextResponse.json({
      sent: result.sent,
      failed: result.failed,
      deactivated: result.deactivated.length,
    });
  } catch (error) {
    console.error("Error in send-todo:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
