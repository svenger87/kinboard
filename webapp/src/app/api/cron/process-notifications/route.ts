import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendPushToMultiple, isVapidConfigured, DatabaseSubscription } from "@/lib/push-sender";
import { formatEventTime } from "@/lib/notifications/format";
import { getPushTranslator } from "@/lib/notifications/messages";
import { getFamilyLocale } from "@/lib/family-locale";
import { recordHeartbeat } from "@/lib/heartbeat";
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
/**
 * Split queued reminders into those still worth sending and those whose event
 * has been deleted or moved.
 *
 * Only calendar reminders are checked — they are the ones that carry a start
 * time, and the only ones a user can invalidate by editing something after
 * the reminder was queued. Anything else passes through untouched.
 *
 * A lookup failure keeps the reminder. Sending a reminder for an event that
 * did happen is a much smaller harm than silently swallowing every reminder
 * because a query failed.
 */
async function dropStaleEventReminders(
  supabase: any,
  pending: ScheduledNotification[],
): Promise<{ kept: ScheduledNotification[]; stale: string[] }> {
  const eventReminders = pending.filter(
    (n) => n.related_entity_type === "event" && n.related_entity_id,
  );
  if (eventReminders.length === 0) return { kept: pending, stale: [] };

  const ids = [...new Set(eventReminders.map((n) => n.related_entity_id as string))];
  const { data, error } = await supabase
    .from("events")
    .select("id, start_at")
    .in("id", ids);

  if (error) {
    console.error("[process-notifications] Could not verify events, sending anyway:", error);
    return { kept: pending, stale: [] };
  }

  const startById = new Map<string, string>(
    ((data ?? []) as Array<{ id: string; start_at: string }>).map((e) => [e.id, e.start_at]),
  );

  const stale = new Set<string>();
  for (const reminder of eventReminders) {
    const currentStart = startById.get(reminder.related_entity_id as string);

    // Event deleted.
    if (!currentStart) {
      stale.add(reminder.id);
      continue;
    }

    // Event moved. The scheduler adds a fresh row for the new start_at, so
    // without this the user gets both — one at the old time, one at the new.
    const scheduledStart = reminder.data?.start_at as string | undefined;
    if (scheduledStart && new Date(scheduledStart).getTime() !== new Date(currentStart).getTime()) {
      stale.add(reminder.id);
    }
  }

  return {
    kept: pending.filter((n) => !stale.has(n.id)),
    stale: [...stale],
  };
}

// How long a delivered notification is kept, and how often we bother looking.
const RETENTION_DAYS = 30;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Module scope, so it survives between requests in the same server process and
// resets on deploy. Losing it just means one extra sweep after a restart.
let lastSweepAt = 0;

/**
 * Delete delivered notifications older than the retention window.
 *
 * Nothing ever removed these rows. The queue is written by database triggers
 * on every shopping item and every todo, plus one row per calendar reminder,
 * birthday and meal plan — a couple of rows a day for an ordinary family, none
 * of which are read again once processed, all of which sit in a table every
 * request has to scan past. Over a few years of a dashboard that is meant to
 * run untouched, that is the table that quietly grows.
 *
 * This lives here rather than in a database job because the row lifecycle
 * already lives here: this route is what marks rows processed, and it is
 * already scheduled. Adding pg_cron entries or another ofelia job would mean a
 * second thing to configure, and one more place to look when notifications
 * misbehave.
 *
 * Thirty days is far outside every scheduler's idempotency lookback — the
 * calendar scheduler matches an existing row on the event's exact start_at
 * (written minutes before the event), and the birthday and meal-prep
 * schedulers only ask whether they already enqueued something *today*. So a
 * deleted row can never cause a duplicate send.
 *
 * Failure is logged and swallowed. Housekeeping must never stop delivery.
 */
async function sweepOldNotifications(supabase: ReturnType<typeof createAdminClient>): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  const cutoff = new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Only processed rows. An unprocessed row older than the cutoff is a
  // reminder that never went out, which is a bug worth being able to see.
  const { error: queueError } = await supabase
    .from("scheduled_notifications")
    .delete()
    .eq("processed", true)
    .lt("scheduled_for", cutoff);

  if (queueError) {
    console.error("[process-notifications] Retention sweep (queue) failed:", queueError);
  }

  const { error: logError } = await supabase
    .from("notification_logs")
    .delete()
    .lt("created_at", cutoff);

  if (logError) {
    console.error("[process-notifications] Retention sweep (logs) failed:", logError);
  }
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

  // This job runs every 30 seconds, which is what makes it the useful
  // heartbeat: the daily jobs would leave /api/health unable to tell "the
  // worker is down" from "it is not 08:00 yet".
  //
  // After the secret check, so an unauthenticated caller cannot fake a healthy
  // worker. Before the work, so a worker that is running but failing still
  // reports as alive — "not running" and "running and erroring" have different
  // fixes and should not look identical from outside.
  await recordHeartbeat();

  const supabase = createAdminClient();

  // Before the VAPID gate on purpose. The triggers that fill the queue fire
  // whether or not push is set up, so an install that never configured
  // notifications is exactly the one whose queue would otherwise grow forever
  // with nothing ever draining it.
  await sweepOldNotifications(supabase);

  if (!isVapidConfigured()) {
    return NextResponse.json({ error: "Push not configured" }, { status: 503 });
  }

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

  const allPending = (pendingData || []) as ScheduledNotification[];

  if (allPending.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0 });
  }

  // A queued reminder is a snapshot of an event taken up to ten minutes
  // earlier. Nothing rechecked it before sending, so a cancelled appointment
  // still announced itself at the old time, and a rescheduled one announced
  // itself twice — once from the stale row, once from the fresh row the
  // scheduler correctly added for the new start.
  //
  // scheduled_notifications.related_entity_id has no foreign key (it points
  // at whichever table related_entity_type names), so there's no cascade to
  // lean on. Check the event is still there, and still starts when this row
  // was written for, right before sending.
  const { kept: pending, stale } = await dropStaleEventReminders(supabase, allPending);

  if (stale.length > 0) {
    // Marked processed rather than deleted: the row is the record that a
    // reminder was scheduled, and the scheduler's idempotency check reads
    // rows regardless of processed state.
    const { error: staleError } = await supabase
      .from("scheduled_notifications")
      .update({ processed: true })
      .in("id", stale);
    if (staleError) {
      console.error("[process-notifications] Failed to retire stale reminders:", staleError);
    } else {
      console.log(`[process-notifications] Retired ${stale.length} reminder(s) for events that were deleted or moved`);
    }
  }

  if (pending.length === 0) {
    return NextResponse.json({ processed: stale.length, sent: 0, stale: stale.length });
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

  // Groups are keyed by family_id + notification_type, so the same family
  // can appear in more than one group per cron tick. Cache the resolved
  // locale per family so we hit `settings` at most once per family per run.
  const localeCache = new Map<string, Promise<string>>();
  function localeForFamily(familyId: string): Promise<string> {
    let cached = localeCache.get(familyId);
    if (!cached) {
      cached = getFamilyLocale(familyId);
      localeCache.set(familyId, cached);
    }
    return cached;
  }

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

    const preferences = (prefsData || []) as unknown as (Pick<NotificationPreferences,
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
    const locale = await localeForFamily(familyId);
    const t = getPushTranslator(locale);
    const { title, body, tag, url } = buildNotificationPayload(notificationType, notifications, t);

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
       
      await (supabase as any)
        .from("push_subscriptions")
        .update({ is_active: false })
        .in("id", result.deactivated);
    }

    processedIds.push(...notifications.map((n) => n.id));
  }

  // Mark all processed notifications
  if (processedIds.length > 0) {
     
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
    case "calendar_reminder":
      return "calendar_reminders";
    case "birthday_reminder":
      return "birthday_reminders";
    case "meal_prep_reminder":
      return "meal_prep_reminders";
    default:
      return null;
  }
}

/**
 * Build push notification payload from a batch of scheduled notifications
 */
function buildNotificationPayload(
  type: string,
  notifications: ScheduledNotification[],
  t: ReturnType<typeof getPushTranslator>
): { title: string; body: string; tag: string; url: string } {
  switch (type) {
    case "shopping_collaborative": {
      const items = notifications.map((n) => n.data?.item_name || n.body || "");
      const title = items.length === 1 ? t("newItemOne") : t("newItemMany", { count: items.length });
      const body = items.length <= 3
        ? items.join(", ")
        : `${items.slice(0, 3).join(", ")} ${t("moreSuffix", { count: items.length - 3 })}`;
      // /einkaufen (not /shopping) so iOS scope-matches an installed
      // Shopping PWA on tap. The URL is rewritten to /shopping content
      // server-side; the URL itself stays /einkaufen for the PWA-launch
      // detection. See next.config.mjs's rewrites block.
      return { title, body, tag: "shopping-update", url: "/einkaufen" };
    }

    case "todo_assigned": {
      const items = notifications.map((n) => {
        const todoTitle = n.data?.todo_title || n.body || "";
        const personName = n.data?.person_name;
        return personName ? `${todoTitle} → ${personName}` : todoTitle;
      });
      const title = items.length === 1 ? t("todoAssignedOne") : t("todoAssignedMany", { count: items.length });
      const body = items.length <= 3
        ? items.join(", ")
        : `${items.slice(0, 3).join(", ")} ${t("moreSuffix", { count: items.length - 3 })}`;
      return { title, body, tag: "todo-update", url: "/todos" };
    }

    case "todo_created": {
      const items = notifications.map((n) => n.data?.todo_title || n.body || "");
      const title = items.length === 1 ? t("todoNewOne") : t("todoNewMany", { count: items.length });
      const body = items.length <= 3
        ? items.join(", ")
        : `${items.slice(0, 3).join(", ")} ${t("moreSuffix", { count: items.length - 3 })}`;
      return { title, body, tag: "todo-update", url: "/todos" };
    }

    case "calendar_reminder": {
      // Calendar reminders fire one-per-event by design; the batch is
      // typically 1 row, occasionally several if multiple events start
      // at the same time. Render a list when batched.
      if (notifications.length === 1) {
        const n = notifications[0];
        const eventTime = n.data?.start_at as string | undefined;
        const timeStr = eventTime ? formatEventTime(eventTime) : null;
        return {
          title: n.title || t("eventFallbackTitle"),
          body: timeStr ? t("eventStartsAt", { time: timeStr }) : t("eventStartsSoon"),
          // Tag uses event ID so a re-fired notification for the same event
          // replaces the previous toast rather than stacking.
          tag: `calendar-${n.related_entity_id ?? n.id}`,
          url: "/calendar",
        };
      }
      // Multiple events starting around the same time
      const titles = notifications.map((n) => n.title || t("eventFallbackTitle"));
      return {
        title: t("eventsMany", { count: notifications.length }),
        body: titles.length <= 3
          ? titles.join(", ")
          : `${titles.slice(0, 3).join(", ")} ${t("moreSuffix", { count: titles.length - 3 })}`,
        tag: "calendar-reminders",
        url: "/calendar",
      };
    }

    case "birthday_reminder": {
      // Enqueued by /api/cron/birthday-reminders, one row per birthday.
      // n.title is the person's name; n.data.days_until is a string
      // (JSONB round-trip) with 0 meaning "today".
      if (notifications.length === 1) {
        const n = notifications[0];
        const name = n.title || (n.data?.name as string | undefined) || "";
        const daysUntil = Number(n.data?.days_until ?? 0);
        const body = daysUntil <= 0 ? t("birthdayToday") : t("birthdayBody", { count: daysUntil });
        return {
          title: t("birthdayTitle", { name }),
          body,
          tag: `birthday-${n.related_entity_id ?? n.id}`,
          url: "/birthdays",
        };
      }
      // Multiple birthdays land in the same batch (rare, but possible
      // when several people share a notify-days-before offset).
      const names = notifications.map((n) => n.title || (n.data?.name as string | undefined) || "");
      return {
        title: t("birthdaysMany", { count: notifications.length }),
        body: names.length <= 3
          ? names.join(", ")
          : `${names.slice(0, 3).join(", ")} ${t("moreSuffix", { count: names.length - 3 })}`,
        tag: "birthday-reminders",
        url: "/birthdays",
      };
    }

    case "meal_prep_reminder": {
      // Enqueued by /api/cron/meal-prep-reminders, one row per family per
      // day — tomorrow's meal-plan entries are already pre-joined into a
      // single row's data.titles_json, so this always renders notifications[0].
      const n = notifications[0];
      let titles: string[] = [];
      try {
        titles = JSON.parse((n.data?.titles_json as string | undefined) ?? "[]");
      } catch {
        titles = [];
      }
      const body = titles.length <= 3
        ? titles.join(", ")
        : `${titles.slice(0, 3).join(", ")} ${t("moreSuffix", { count: titles.length - 3 })}`;
      return {
        title: t("mealPrepTitle"),
        body,
        tag: "meal-prep-reminder",
        url: "/meals",
      };
    }

    default: {
      const title = notifications[0].title;
      const body = notifications.map((n) => n.body).filter(Boolean).join(", ");
      return { title, body, tag: "notification", url: "/" };
    }
  }
}
