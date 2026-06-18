import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { formatEventTime } from "@/lib/notifications/format";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

const DEFAULT_REMINDER_MINUTES = 30;
// Half the cron interval (5 min) as the scan window buffer on each side
const WINDOW_BUFFER_MINUTES = 5;

interface EventRow {
  id: string;
  calendar_id: string;
  title: string;
  start_at: string;
  family_id: string;
}

/**
 * POST /api/cron/schedule-event-reminders
 * Runs every 5 minutes via Ofelia. For each family with active push subscriptions,
 * finds events starting within the configured reminder window and inserts rows
 * into scheduled_notifications. Idempotent — skips events that already have a
 * pending scheduled_notifications row.
 *
 * All-day events are skipped — "in 30 min" is semantically meaningless for them.
 */
export async function POST(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Collect families that have at least one active push subscription
  const { data: familySubs } = await supabase
    .from("push_subscriptions")
    .select("family_id")
    .eq("is_active", true);

  if (!familySubs || familySubs.length === 0) {
    return NextResponse.json({ scheduled: 0, skipped: 0 });
  }

  const familyIdSet = new Set<string>();
  for (const s of familySubs as { family_id: string }[]) {
    familyIdSet.add(s.family_id);
  }
  const familyIds = Array.from(familyIdSet);

  let totalScheduled = 0;
  let totalSkipped = 0;

  for (const familyId of familyIds) {
    // Read the family's configured reminder offset (take MAX across all device rows
    // to be conservative — every device gets a fair chance to receive the reminder).
    const { data: prefsData } = await supabase
      .from("notification_preferences")
      .select("calendar_reminders, default_event_reminder_minutes")
      .eq("family_id", familyId);

    const prefs = (prefsData || []) as {
      calendar_reminders: boolean;
      default_event_reminder_minutes: number | null;
    }[];

    // If every device has the toggle off, skip this family entirely
    const anyEnabled = prefs.length === 0 || prefs.some((p) => p.calendar_reminders !== false);
    if (!anyEnabled) {
      continue;
    }

    const reminderMinutes = prefs.reduce((max, p) => {
      const val = p.default_event_reminder_minutes ?? DEFAULT_REMINDER_MINUTES;
      return val > max ? val : max;
    }, DEFAULT_REMINDER_MINUTES);

    // Scan window: events starting in [reminderMinutes - BUFFER, reminderMinutes + BUFFER]
    // from now. This catches events regardless of which 5-min tick fires first.
    const windowMinStart = reminderMinutes - WINDOW_BUFFER_MINUTES;
    const windowMinEnd = reminderMinutes + WINDOW_BUFFER_MINUTES;

    const now = new Date();
    const rangeStart = new Date(now.getTime() + windowMinStart * 60 * 1000);
    const rangeEnd = new Date(now.getTime() + windowMinEnd * 60 * 1000);

    // Fetch upcoming non-all-day events for this family within the window
    const { data: eventsData, error: eventsError } = await supabase
      .from("events")
      .select("id, calendar_id, title, start_at, calendars!inner(family_id)")
      .eq("calendars.family_id", familyId)
      .eq("all_day", false)
      .gte("start_at", rangeStart.toISOString())
      .lte("start_at", rangeEnd.toISOString());

    if (eventsError) {
      console.error(`[schedule-event-reminders] Error fetching events for family ${familyId}:`, eventsError);
      continue;
    }

    if (!eventsData || eventsData.length === 0) {
      continue;
    }

    // Flatten the joined result into a typed array
    const events: EventRow[] = (eventsData as unknown as Array<{
      id: string;
      calendar_id: string;
      title: string;
      start_at: string;
      calendars: { family_id: string };
    }>).map((e) => ({
      id: e.id,
      calendar_id: e.calendar_id,
      title: e.title,
      start_at: e.start_at,
      family_id: e.calendars.family_id,
    }));

    for (const event of events) {
      // Idempotency: skip if a reminder for this event already exists — whether
      // or not it's been sent. The reminder window (reminderMinutes ± buffer) is
      // wider than the cron interval, so an event is matched on several
      // consecutive ticks; previously this only checked `processed = false`, so
      // once the first reminder was sent and flipped to processed, the next tick
      // re-inserted and re-sent it — which is why reminders fired twice.
      const { data: existing } = await supabase
        .from("scheduled_notifications")
        .select("id")
        .eq("notification_type", "calendar_reminder")
        .eq("related_entity_id", event.id)
        .limit(1)
        .maybeSingle();

      if (existing) {
        totalSkipped++;
        continue;
      }

      // scheduled_for = event.start_at - reminderMinutes
      const scheduledFor = new Date(
        new Date(event.start_at).getTime() - reminderMinutes * 60 * 1000
      );

      const timeStr = formatEventTime(event.start_at);

      const { error: insertError } = await supabase
        .from("scheduled_notifications")
        .insert({
          family_id: familyId,
          notification_type: "calendar_reminder",
          scheduled_for: scheduledFor.toISOString(),
          title: event.title,
          body: `Beginnt um ${timeStr}`,
          data: {
            event_id: event.id,
            calendar_id: event.calendar_id,
            start_at: event.start_at,
          },
          related_entity_type: "event",
          related_entity_id: event.id,
        });

      if (insertError) {
        console.error(`[schedule-event-reminders] Insert failed for event ${event.id}:`, insertError);
        continue;
      }

      totalScheduled++;
    }
  }

  console.log(`[schedule-event-reminders] Done. Scheduled ${totalScheduled}, skipped ${totalSkipped} (already queued)`);

  return NextResponse.json({
    scheduled: totalScheduled,
    skipped: totalSkipped,
    timestamp: new Date().toISOString(),
  });
}
