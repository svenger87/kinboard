import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendPushNotification, isVapidConfigured, type DatabaseSubscription } from "@/lib/push-sender";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    if (!isVapidConfigured()) {
      return NextResponse.json({
        success: false,
        error: "VAPID-Schlüssel nicht konfiguriert",
      });
    }

    const { deviceId, familyId } = await request.json();

    if (!deviceId || !familyId) {
      return NextResponse.json(
        { success: false, error: "deviceId und familyId erforderlich" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Get the most recent active subscription for this device
    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("device_id", deviceId)
      .eq("family_id", familyId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1);

    const subscription = subscriptions?.[0] ?? null;

    if (subError || !subscription) {
      console.log("[SendTest] No active subscription found for device:", deviceId);
      return NextResponse.json({
        success: false,
        error: "Kein aktives Push-Abonnement gefunden. Bitte zuerst Benachrichtigungen aktivieren.",
      });
    }

    // Send actual push notification via web-push
    const result = await sendPushNotification(subscription as DatabaseSubscription, {
      title: "Test-Benachrichtigung",
      body: "Push-Benachrichtigungen funktionieren!",
      tag: "test",
      url: "/settings/notifications",
    });

    if (result.success) {
      console.log("[SendTest] Test notification sent successfully to device:", deviceId);
      return NextResponse.json({ success: true });
    }

    // If push failed, handle deactivation
    if (result.shouldDeactivate) {
      console.log("[SendTest] Deactivating stale subscription for device:", deviceId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub = subscription as any;
      await (supabase as any)
        .from("push_subscriptions")
        .update({ is_active: false })
        .eq("id", sub.id);
    }

    return NextResponse.json({
      success: false,
      error: result.error || "Push-Benachrichtigung fehlgeschlagen",
    });
  } catch (error) {
    console.error("[SendTest] Error:", error);
    return NextResponse.json(
      { success: false, error: "Serverfehler beim Senden der Test-Benachrichtigung" },
      { status: 500 }
    );
  }
}
