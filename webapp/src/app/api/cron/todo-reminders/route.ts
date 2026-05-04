import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendPushToMultiple, isVapidConfigured, DatabaseSubscription } from "@/lib/push-sender";
import type { PushSubscription, NotificationPreferences } from "@/types/database";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

const RECURRENCE_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

interface TodoRow {
  id: string;
  family_id: string;
  title: string;
  completed: boolean;
  due_date: string | null;
  recurrence: string | null;
  last_completed: string | null;
}

function isTodoDue(todo: TodoRow): boolean {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Non-recurring: check due_date
  if (!todo.recurrence || todo.recurrence === "once") {
    if (!todo.due_date || todo.completed) return false;
    const dueDate = new Date(todo.due_date);
    return dueDate <= today;
  }

  // Recurring: check if interval has elapsed since last_completed
  if (!todo.last_completed) return true;

  const lastCompleted = new Date(todo.last_completed);
  const intervalDays = RECURRENCE_DAYS[todo.recurrence] || 0;
  if (intervalDays === 0) return false;

  const daysSince = Math.floor((now.getTime() - lastCompleted.getTime()) / (1000 * 60 * 60 * 24));
  return daysSince >= intervalDays;
}

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

  console.log("[todo-reminders] Starting daily reminder check");

  const supabase = createAdminClient();

  // Get all families that have active push subscriptions
  const { data: familySubs } = await supabase
    .from("push_subscriptions")
    .select("family_id")
    .eq("is_active", true);

  if (!familySubs || familySubs.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0 });
  }

  const familyIdSet = new Set<string>();
  for (const s of familySubs as { family_id: string }[]) {
    familyIdSet.add(s.family_id);
  }
  const familyIds = Array.from(familyIdSet);

  let totalSent = 0;

  for (const familyId of familyIds) {
    // Fetch open todos for this family
    const { data: todosData } = await supabase
      .from("todos")
      .select("*")
      .eq("family_id", familyId)
      .eq("completed", false);

    const todos = (todosData || []) as TodoRow[];

    // Also include recurring todos (they might have completed=false but need checking)
    const { data: recurringData } = await supabase
      .from("todos")
      .select("*")
      .eq("family_id", familyId)
      .neq("recurrence", "once")
      .not("recurrence", "is", null);

    const recurringTodos = (recurringData || []) as TodoRow[];

    // Merge and deduplicate
    const allTodos = new Map<string, TodoRow>();
    for (const t of [...todos, ...recurringTodos]) {
      allTodos.set(t.id, t);
    }

    const dueTodos = Array.from(allTodos.values()).filter(isTodoDue);

    if (dueTodos.length === 0) continue;

    // Get subscriptions for this family
    const { data: subsData } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("family_id", familyId)
      .eq("is_active", true);

    const subscriptions = (subsData || []) as PushSubscription[];
    if (subscriptions.length === 0) continue;

    // Check preferences
    const { data: prefsData } = await supabase
      .from("notification_preferences")
      .select("device_id, todo_reminders, quiet_hours_enabled, quiet_hours_start, quiet_hours_end")
      .eq("family_id", familyId);

    const preferences = (prefsData || []) as Pick<NotificationPreferences,
      "device_id" | "todo_reminders" | "quiet_hours_enabled" | "quiet_hours_start" | "quiet_hours_end"
    >[];

    const prefsMap = new Map(preferences.map((p) => [p.device_id, p]));

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

    const eligible = subscriptions.filter((sub) => {
      const prefs = prefsMap.get(sub.device_id);
      if (!prefs) return true;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((prefs as any).todo_reminders === false) return false;

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

    if (eligible.length === 0) continue;

    const title = dueTodos.length === 1
      ? "Aufgabe fällig"
      : `${dueTodos.length} Aufgaben fällig`;

    const body = dueTodos.length <= 3
      ? dueTodos.map((t) => t.title).join(", ")
      : `${dueTodos.slice(0, 3).map((t) => t.title).join(", ")} +${dueTodos.length - 3} weitere`;

    const result = await sendPushToMultiple(eligible as DatabaseSubscription[], {
      title,
      body,
      tag: `todo-reminder-${new Date().toISOString().slice(0, 10)}`,
      url: "/todos",
    });

    totalSent += result.sent;

    if (result.deactivated.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("push_subscriptions")
        .update({ is_active: false })
        .in("id", result.deactivated);
    }
  }

  console.log(`[todo-reminders] Done. Sent ${totalSent} notifications across ${familyIds.length} families`);

  return NextResponse.json({
    processed: familyIds.length,
    sent: totalSent,
    timestamp: new Date().toISOString(),
  });
}
