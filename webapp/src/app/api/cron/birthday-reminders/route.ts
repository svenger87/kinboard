import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

interface BirthdayRow {
  id: string;
  family_id: string;
  name: string;
  date: string; // Postgres DATE, serialized as "YYYY-MM-DD"
  notify_days_before: number | null;
}

interface HouseholdDate {
  year: number;
  month: number; // 1-12
  day: number;
}

function householdTimeZone(): string {
  // Same household-TZ model as src/lib/notifications/format.ts — the
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

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Resolve a birthday's (month, day) to the actual (month, day) to look for
 * in a given year — Feb-29 birthdays roll to Mar-1 on non-leap years so the
 * reminder still fires annually instead of silently skipping 3 years out of
 * 4 (matches how most calendar apps handle leap-day anniversaries).
 */
function resolveOccurrence(month: number, day: number, year: number): { month: number; day: number } {
  if (month === 2 && day === 29 && !isLeapYear(year)) {
    return { month: 3, day: 1 };
  }
  return { month, day };
}

/** Days from `today` to the next occurrence of (month, day), 0 = today. */
function daysUntilNextOccurrence(month: number, day: number, today: HouseholdDate): number {
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);

  const thisYear = resolveOccurrence(month, day, today.year);
  let occurrenceUtc = Date.UTC(today.year, thisYear.month - 1, thisYear.day);

  if (occurrenceUtc < todayUtc) {
    const nextYear = resolveOccurrence(month, day, today.year + 1);
    occurrenceUtc = Date.UTC(today.year + 1, nextYear.month - 1, nextYear.day);
  }

  return Math.round((occurrenceUtc - todayUtc) / (1000 * 60 * 60 * 24));
}

/**
 * POST /api/cron/birthday-reminders
 * Runs once daily via Ofelia (~07:00). For every saved birthday, checks
 * whether today is exactly `notify_days_before` days ahead of this year's
 * (or next year's, if already passed) occurrence and enqueues a row into
 * scheduled_notifications. process-notifications then delivers it,
 * honoring quiet hours and the per-device birthday_reminders preference.
 *
 * Idempotent — skips a birthday if an unsent reminder for it was already
 * enqueued today (guards against a manual re-trigger double-firing; the
 * following year's match is a separate calendar day so it isn't blocked).
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

  const { data: birthdaysData, error: birthdaysError } = await supabase
    .from("birthdays")
    .select("id, family_id, name, date, notify_days_before");

  if (birthdaysError) {
    console.error("[birthday-reminders] Error fetching birthdays:", birthdaysError);
    return NextResponse.json({ error: "Failed to fetch birthdays" }, { status: 500 });
  }

  const birthdays = (birthdaysData || []) as BirthdayRow[];

  if (birthdays.length === 0) {
    return NextResponse.json({ scheduled: 0, skipped: 0 });
  }

  let totalScheduled = 0;
  let totalSkipped = 0;

  for (const birthday of birthdays) {
    const notifyDaysBefore = birthday.notify_days_before ?? 7;
    const [, monthStr, dayStr] = birthday.date.split("-");
    const month = Number(monthStr);
    const day = Number(dayStr);

    if (!month || !day) {
      console.error(`[birthday-reminders] Unparseable date for birthday ${birthday.id}: ${birthday.date}`);
      continue;
    }

    const daysUntil = daysUntilNextOccurrence(month, day, today);
    if (daysUntil !== notifyDaysBefore) {
      continue;
    }

    // Dedup: skip if an unsent reminder for this birthday was already
    // enqueued today. A previous year's (already-sent) row has
    // processed = true so it never blocks this year's reminder.
    const { data: existingRows } = await supabase
      .from("scheduled_notifications")
      .select("id, scheduled_for")
      .eq("notification_type", "birthday_reminder")
      .eq("related_entity_id", birthday.id)
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
        family_id: birthday.family_id,
        notification_type: "birthday_reminder",
        scheduled_for: new Date().toISOString(),
        title: birthday.name,
        body: null,
        data: {
          birthday_id: birthday.id,
          name: birthday.name,
          days_until: String(daysUntil),
        },
        related_entity_type: "birthday",
        related_entity_id: birthday.id,
      });

    if (insertError) {
      console.error(`[birthday-reminders] Insert failed for birthday ${birthday.id}:`, insertError);
      continue;
    }

    totalScheduled++;
  }

  console.log(`[birthday-reminders] Done. Scheduled ${totalScheduled}, skipped ${totalSkipped} (already queued)`);

  return NextResponse.json({
    scheduled: totalScheduled,
    skipped: totalSkipped,
    timestamp: new Date().toISOString(),
  });
}
