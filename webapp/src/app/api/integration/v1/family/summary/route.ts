import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { todayKey, toLocalDateKey } from "@/lib/local-date";
import { logApiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/family/summary — everything the Home Assistant
 * sensors need, in one call.
 *
 * One endpoint rather than one per sensor, deliberately. Home Assistant polls
 * on a fixed interval, and a self-hosted Kinboard is frequently a Raspberry Pi
 * sharing a disk with Postgres; eight requests where one would do is eight
 * times the load, forever, for data that is all read at the same moment
 * anyway.
 *
 * Every date here comes from `todayKey()` / `toLocalDateKey()`, never from
 * `toISOString().slice(0,10)`. That helper exists because the UTC day is wrong
 * every night between local midnight and the offset — in Berlin a task due
 * today read as not-due until 02:00. A summary that disagrees with the wall
 * display about what day it is would be worse than no summary.
 */

/** Shape returned for each sensor. `null` means "not applicable right now". */
export interface FamilySummary {
  next_family_event: {
    /**
     * What a sensor displays. Every other field here carries one, and a
     * consumer that reads `state` uniformly across the summary was left with
     * `undefined` for this one — the Home Assistant sensor showed "unknown"
     * while the event sat right beside it in the same payload. Found on the
     * first real setup.
     */
    state: string;
    id: string;
    title: string;
    start_at: string;
    location: string | null;
    person_id: string | null;
    minutes_remaining: number;
  } | null;
  events_today: { state: number; events: { title: string; start_at: string }[] };
  shopping_items: number;
  meal_today: { state: string | null; meal: string | null; recipe_id: string | null };
  tasks_due: { state: number; open: number; overdue: number };
  /**
   * `state` is the value a dashboard card shows, so it is the human answer,
   * not the count. Home Assistant renders the state and hides attributes, and
   * "0" is not an answer to "whose birthday is next" — which is exactly how
   * this read on a real wall display.
   */
  school_tomorrow: { state: string | null; children: string[]; count: number; first_lesson: string | null };
  birthdays_upcoming: { state: string | null; name: string | null; days_remaining: number | null; date: string | null };
  tasks_overdue: number;
  meal_tomorrow: { state: string | null; meal: string | null; recipe_id: string | null };
  pocket_money: { person_id: string; name: string; balance: number; currency: string }[];
  /** Heute-Motor, Phase 3. Reported as null so the entity exists and reads "unknown". */
  display_mode: null;
  attention_required: false;
}

/**
 * Days until the next anniversary of a birth date.
 *
 * Computed on calendar days rather than by subtracting timestamps: a DST
 * change makes a "day" 23 or 25 hours long, and dividing elapsed milliseconds
 * by 86,400,000 then rounds a birthday to the wrong day twice a year.
 *
 * 29 February falls back to 1 March in non-leap years — the same day the rest
 * of the app shows it on, which matters more than being clever about it.
 */
export function daysUntilNextBirthday(birthDate: string, today: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const atMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const occurrence = (year: number) => {
    const d = new Date(year, month - 1, day);
    // A 29 Feb in a non-leap year rolls to 1 March, which is what we want.
    if (d.getMonth() !== month - 1) d.setDate(0);
    return d;
  };

  let next = occurrence(atMidnight.getFullYear());
  if (next.getTime() < atMidnight.getTime()) next = occurrence(atMidnight.getFullYear() + 1);

  return Math.round((next.getTime() - atMidnight.getTime()) / 86_400_000);
}

/** The earliest lesson in a schedule's slots, by start time. */
export function firstLessonOf(timeSlots: unknown): string | null {
  if (!Array.isArray(timeSlots) || timeSlots.length === 0) return null;
  const sorted = [...timeSlots]
    .filter((s): s is { start?: string; subject?: string } => !!s && typeof s === "object")
    .filter((s) => typeof s.start === "string")
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return sorted.length > 0 ? (sorted[0].subject ?? null) : null;
}

/** ISO weekday for a date: Monday = 1 … Sunday = 7, matching `schedules.day_of_week`. */
export function isoDayOfWeek(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    const supabase = createAdminClient();
    const familyId = context.familyId;

    const now = new Date();
    const today = todayKey();
    const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrow = toLocalDateKey(tomorrowDate);
    const tomorrowDow = isoDayOfWeek(tomorrowDate);

    try {
      const [calendars, shopping, todos, meals, schedules, birthdays, people, mealsTomorrow, purses] =
        await Promise.all([

        (supabase as any).from("calendars").select("id").eq("family_id", familyId),

        (supabase as any)
          .from("shopping_items")
          .select("id", { count: "exact", head: true })
          .eq("family_id", familyId)
          // `not.is.true`, not `eq false`. shopping_items.checked is NULLABLE
          // with a default of false, so a row inserted with an explicit null
          // is unchecked but would not match `= false` — the count would be
          // quietly low, and a count that is quietly wrong is worse than one
          // that is obviously broken.
          .not("checked", "is", true),

        (supabase as any)
          .from("todos")
          .select("id, due_date")
          .eq("family_id", familyId)
          .eq("completed", false)
          .is("deleted_at", null),

        (supabase as any)
          .from("meal_plan_entries")
          .select("recipe_id, note, meal_type, meal_plans!inner(family_id)")
          .eq("meal_plans.family_id", familyId)
          .eq("date", today)
          .is("deleted_at", null),

        (supabase as any)
          .from("schedules")
          .select("person_id, time_slots")
          .eq("family_id", familyId)
          .eq("day_of_week", tomorrowDow),

        (supabase as any)
          .from("birthdays")
          .select("name, date")
          .eq("family_id", familyId)
          .is("deleted_at", null),

        (supabase as any)
          .from("people")
          .select("id, name")
          .eq("family_id", familyId)
          .is("deleted_at", null),

        (supabase as any)
          .from("meal_plan_entries")
          .select("recipe_id, note, meal_plans!inner(family_id)")
          .eq("meal_plans.family_id", familyId)
          .eq("date", tomorrow)
          .is("deleted_at", null),

        (supabase as any)
          .from("pocket_money_accounts")
          .select("person_id, balance_cents, currency")
          .eq("family_id", familyId),
      ]);

      // Calendar events need the family's calendar ids first — events are
      // scoped by calendar, not directly by family.
      const calendarIds = (calendars.data ?? []).map((c: { id: string }) => c.id);
      let nextEvent: FamilySummary["next_family_event"] = null;
      let todaysEvents: { title: string; start_at: string }[] = [];

      if (calendarIds.length > 0) {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

        const { data: events } = await (supabase as any)
          .from("events")
          .select("id, title, start_at, location, person_id")
          .in("calendar_id", calendarIds)
          .gte("start_at", startOfToday.toISOString())
          .order("start_at", { ascending: true })
          .limit(50);

        const rows = (events ?? []) as {
          id: string; title: string; start_at: string; location: string | null; person_id: string | null;
        }[];

        todaysEvents = rows
          .filter((e) => new Date(e.start_at) < endOfToday)
          .map((e) => ({ title: e.title, start_at: e.start_at }));

        const upcoming = rows.find((e) => new Date(e.start_at) >= now);
        if (upcoming) {
          nextEvent = {
            // The title is the sensible display value; the detail is in the
            // attributes beside it.
            state: upcoming.title,
            id: upcoming.id,
            title: upcoming.title,
            start_at: upcoming.start_at,
            location: upcoming.location,
            person_id: upcoming.person_id,
            minutes_remaining: Math.max(
              0,
              Math.round((new Date(upcoming.start_at).getTime() - now.getTime()) / 60_000),
            ),
          };
        }
      }

      const openTodos = (todos.data ?? []) as { id: string; due_date: string | null }[];
      const overdue = openTodos.filter((t) => t.due_date !== null && t.due_date < today).length;

      const nameById = new Map(
        ((people.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]),
      );
      const scheduleRows = (schedules.data ?? []) as { person_id: string; time_slots: unknown }[];
      const withLessons = scheduleRows.filter((s) => firstLessonOf(s.time_slots) !== null);

      const nextBirthday = ((birthdays.data ?? []) as { name: string; date: string }[])
        .map((b) => ({ name: b.name, days: daysUntilNextBirthday(b.date, now), date: b.date }))
        .filter((b): b is { name: string; days: number; date: string } => b.days !== null)
        .sort((a, b) => a.days - b.days)[0];

      const mealRow = ((meals.data ?? []) as { recipe_id: string | null; note: string | null }[])[0];
      const mealTomorrowRow = ((mealsTomorrow.data ?? []) as { recipe_id: string | null; note: string | null }[])[0];

      const pocketMoney = ((purses.data ?? []) as {
        person_id: string; balance_cents: number | null; currency: string | null;
      }[]).map((a) => ({
        person_id: a.person_id,
        name: nameById.get(a.person_id) ?? "?",
        // Cents in the database, currency units out: a sensor showing 501 for
        // €5.01 is a sensor nobody trusts.
        balance: Math.round((a.balance_cents ?? 0)) / 100,
        currency: a.currency ?? "EUR",
      }));

      const childNames = withLessons.map((s) => nameById.get(s.person_id) ?? "?");

      const summary: FamilySummary = {
        next_family_event: nextEvent,
        events_today: { state: todaysEvents.length, events: todaysEvents.slice(0, 10) },
        shopping_items: shopping.count ?? 0,
        meal_today: {
          state: mealRow?.note ?? (mealRow?.recipe_id ? "recipe" : null),
          meal: mealRow?.note ?? null,
          recipe_id: mealRow?.recipe_id ?? null,
        },
        tasks_due: { state: openTodos.length, open: openTodos.length, overdue },
        school_tomorrow: {
          // Who has school, not how many — the names are the answer.
          state: childNames.length > 0 ? childNames.join(", ") : null,
          children: childNames,
          count: childNames.length,
          first_lesson: withLessons.length > 0 ? firstLessonOf(withLessons[0].time_slots) : null,
        },
        birthdays_upcoming: {
          // The person, not the day count. "0" told nobody it was Nora's.
          state: nextBirthday?.name ?? null,
          name: nextBirthday?.name ?? null,
          days_remaining: nextBirthday?.days ?? null,
          date: nextBirthday?.date ?? null,
        },
        tasks_overdue: overdue,
        meal_tomorrow: {
          state: mealTomorrowRow?.note ?? (mealTomorrowRow?.recipe_id ? "recipe" : null),
          meal: mealTomorrowRow?.note ?? null,
          recipe_id: mealTomorrowRow?.recipe_id ?? null,
        },
        pocket_money: pocketMoney,
        display_mode: null,
        attention_required: false,
      };

      return NextResponse.json({ summary, generated_at: now.toISOString(), today, tomorrow });
    } catch (err) {
      await logApiError("integration/family/summary", err);
      return NextResponse.json({ error: "Could not build the summary" }, { status: 500 });
    }
  });
}
