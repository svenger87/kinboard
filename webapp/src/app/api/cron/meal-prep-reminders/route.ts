import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

interface MealPlanEntryRow {
  id: string;
  date: string; // Postgres DATE, serialized as "YYYY-MM-DD"
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  note: string | null;
  created_at: string;
  recipe: { title: string } | null;
  meal_plan: { id: string; family_id: string } | null;
}

interface HouseholdDate {
  year: number;
  month: number; // 1-12
  day: number;
}

// Deterministic ordering for same-day entries — matches the meal-planner
// UI's MEAL_TYPES order (src/hooks/use-meal-planner.ts), not Postgres's
// default alphabetical text sort ("breakfast" < "dinner" < "lunch" < "snack").
const MEAL_TYPE_ORDER = ["breakfast", "lunch", "dinner", "snack"] as const;

function householdTimeZone(): string {
  // Same household-TZ model as src/app/api/cron/birthday-reminders — the
  // container's TZ env var is the single source of truth for "today"
  // across every family (there's one deployment per household/cluster,
  // not per-family timezones).
  return process.env.TZ || "Europe/Berlin";
}

function formatInTimeZone(date: Date, timeZone: string): HouseholdDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function dateKey(d: HouseholdDate): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function addDays(d: HouseholdDate, days: number): HouseholdDate {
  const utc = new Date(Date.UTC(d.year, d.month - 1, d.day) + days * 86400000);
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

function entryTitle(entry: MealPlanEntryRow): string {
  return entry.recipe?.title || entry.note || "";
}

/**
 * POST /api/cron/meal-prep-reminders
 * Runs once daily via Ofelia (18:00 household time). For every family with
 * meal-plan entries dated tomorrow, enqueues ONE meal_prep_reminder row into
 * scheduled_notifications listing tomorrow's planned meals. process-notifications
 * then delivers it, honoring quiet hours and the per-device meal_prep_reminders
 * preference.
 *
 * Idempotent — skips a family if an unsent meal_prep_reminder was already
 * enqueued today (guards against a manual re-trigger double-firing).
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
  const timeZone = householdTimeZone();
  const today = formatInTimeZone(new Date(), timeZone);
  const todayKey = dateKey(today);
  const tomorrowKey = dateKey(addDays(today, 1));

  const { data: entriesData, error: entriesError } = await (supabase as any)
    .from("meal_plan_entries")
    .select(
      `
      id,
      date,
      meal_type,
      note,
      created_at,
      recipe:recipes(title),
      meal_plan:meal_plans!inner(id, family_id)
    `
    )
    .eq("date", tomorrowKey);

  if (entriesError) {
    console.error("[meal-prep-reminders] Error fetching meal plan entries:", entriesError);
    return NextResponse.json({ error: "Failed to fetch meal plan entries" }, { status: 500 });
  }

  const entries = (entriesData || []) as MealPlanEntryRow[];

  if (entries.length === 0) {
    return NextResponse.json({ scheduled: 0, skipped: 0 });
  }

  // Group tomorrow's entries by family
  const byFamily = new Map<string, { mealPlanId: string; entries: MealPlanEntryRow[] }>();
  for (const entry of entries) {
    const familyId = entry.meal_plan?.family_id;
    if (!familyId) continue;
    let group = byFamily.get(familyId);
    if (!group) {
      group = { mealPlanId: entry.meal_plan!.id, entries: [] };
      byFamily.set(familyId, group);
    }
    group.entries.push(entry);
  }

  let totalScheduled = 0;
  let totalSkipped = 0;

  for (const [familyId, group] of Array.from(byFamily.entries())) {
    const titles = group.entries
      .slice()
      .sort((a, b) => {
        const orderDiff = MEAL_TYPE_ORDER.indexOf(a.meal_type) - MEAL_TYPE_ORDER.indexOf(b.meal_type);
        if (orderDiff !== 0) return orderDiff;
        return a.created_at.localeCompare(b.created_at);
      })
      .map(entryTitle)
      .filter((title) => title.length > 0);

    if (titles.length === 0) continue;

    // Dedup: skip if an unsent meal_prep_reminder for this family was
    // already enqueued today. A previous day's (already-sent) row has
    // processed = true so it never blocks today's reminder.
    const { data: existingRows } = await supabase
      .from("scheduled_notifications")
      .select("id, scheduled_for")
      .eq("notification_type", "meal_prep_reminder")
      .eq("family_id", familyId)
      .eq("processed", false);

    const alreadyScheduledToday = (existingRows || []).some((row) => {
      const scheduledDate = formatInTimeZone(new Date(row.scheduled_for), timeZone);
      return dateKey(scheduledDate) === todayKey;
    });

    if (alreadyScheduledToday) {
      totalSkipped++;
      continue;
    }

    const { error: insertError } = await supabase
      .from("scheduled_notifications")
      .insert({
        family_id: familyId,
        notification_type: "meal_prep_reminder",
        scheduled_for: new Date().toISOString(),
        title: "Tomorrow's meals",
        body: null,
        data: {
          meal_plan_id: group.mealPlanId,
          titles_json: JSON.stringify(titles),
          count: String(titles.length),
        },
        related_entity_type: "meal_plan",
        related_entity_id: group.mealPlanId,
      });

    if (insertError) {
      console.error(`[meal-prep-reminders] Insert failed for family ${familyId}:`, insertError);
      continue;
    }

    totalScheduled++;
  }

  console.log(`[meal-prep-reminders] Done. Scheduled ${totalScheduled}, skipped ${totalSkipped} (already queued)`);

  return NextResponse.json({
    scheduled: totalScheduled,
    skipped: totalSkipped,
    timestamp: new Date().toISOString(),
  });
}
