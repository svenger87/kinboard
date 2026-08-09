import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { todayKey, toLocalDateKey } from "@/lib/local-date";
import { resolveDayContext } from "@/lib/attention/engine";
import { detectWasteType } from "@/lib/waste-types";
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
    /** Resolved name, so a consumer does not have to look the id up itself. */
    person: string | null;
    minutes_remaining: number;
  } | null;
  events_today: {
    state: number;
    events: { title: string; start_at: string; ongoing: boolean; all_day: boolean }[];
  };
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
  birthdays_upcoming: {
    state: string | null;
    name: string | null;
    days_remaining: number | null;
    /** The day it NEXT falls on. `born_on` is the original date. */
    date: string | null;
    born_on: string | null;
  };
  tasks_overdue: number;
  meal_tomorrow: { state: string | null; meal: string | null; recipe_id: string | null };
  pocket_money: { person_id: string; name: string; balance: number; currency: string }[];
  /**
   * Which part of the day the board considers itself in — morning, afternoon,
   * evening or quiet. Reported as null until the Heute-Motor existed, which
   * left the sensor permanently "unknown" and useless to automate on.
   *
   * The same function the engine and the browser use, so an automation
   * triggering on "evening" and a hint that says it is evening cannot
   * disagree.
   */
  display_mode: string;
  /**
   * Whether the Heute-Motor currently has something the family has not dealt
   * with. Hardcoded `false` until the engine existed, which made the binary
   * sensor a switch that could never flip — worse than absent, because it
   * looked like an answer.
   */
  attention_required: boolean;
  /** What it is about, so a dashboard can show it without a second call. */
  attention: { count: number; top: string | null };
  /**
   * The next bin collection. Bin day is among the most-automated things in
   * Home Assistant and the data was already here, sitting in a calendar
   * flagged is_waste_collection and reaching nothing outside the widget.
   */
  /**
   * Active saving goals, with progress. A child saving for a Lego set is
   * exactly the sort of thing a family wants on a display, and the data was
   * only reachable inside Kinboard.
   */
  saving_goals: {
    person: string;
    name: string;
    target: number;
    saved: number;
    /** 0-100, rounded. The number a progress bar actually wants. */
    percent: number;
    currency: string;
  }[];
  waste_collection: {
    /** The bin type, as a person would say it — the sensor's state. */
    state: string | null;
    /** Stable id: rest | bio | paper | recyclable | packaging. */
    type: string | null;
    date: string | null;
    days_until: number | null;
    /** The next few, so one automation can look further than tomorrow. */
    upcoming: { title: string; type: string | null; date: string }[];
  };
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

/**
 * Weekday in the range `schedules.day_of_week` actually allows.
 *
 * The column is constrained to 0..6 and the app writes 1=Monday..5=Friday, so
 * Sunday is 0 — NOT 7. Returning 7 asked the database for a value its own
 * CHECK constraint forbids: harmless today, because the timetable UI cannot
 * create weekend lessons at all, but a query that can never match is a bug
 * waiting for the day someone stores one.
 *
 * Found by seeding a Sunday lesson to test the sensor and having Postgres
 * refuse the row: `schedules_day_of_week_check`.
 */
export function isoDayOfWeek(date: Date): number {
  return date.getDay();
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
      const [calendars, shopping, todos, meals, schedules, birthdays, people, mealsTomorrow, purses, timezoneSetting, wasteCalendars, goals, attention] =
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
          .select("recipe_id, note, meal_type, recipes(title), meal_plans!inner(family_id)")
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
          .select("recipe_id, note, recipes(title), meal_plans!inner(family_id)")
          .eq("meal_plans.family_id", familyId)
          .eq("date", tomorrow)
          .is("deleted_at", null),

        (supabase as any)
          .from("pocket_money_accounts")
          .select("person_id, balance_cents, currency")
          .eq("family_id", familyId),

        // Unresolved and not already dealt with. A snoozed item is not
        // "attention required" until its snooze runs out, and the evaluator is
        // what returns it to active — so `state` is the right filter here and
        // a timestamp comparison would double-guess it.
        (supabase as any)
          .from("settings")
          .select("value")
          .eq("family_id", familyId)
          .eq("key", "timezone")
          .maybeSingle(),

        // Bin collections live in an ordinary calendar flagged
        // is_waste_collection, so they are events like any other and need the
        // same family-through-calendar join.
        (supabase as any)
          .from("calendars")
          .select("id")
          .eq("family_id", familyId)
          .eq("is_waste_collection", true),

        // Goals hang off an ACCOUNT, not off a family or a person: there is
        // no family_id or person_id column on pocket_money_goals. Filtering on
        // either returned nothing at all rather than failing — the rows came
        // back empty and looked like "this family has no goals".
        (supabase as any)
          .from("pocket_money_goals")
          .select("name, target_amount_cents, status, account_id, pocket_money_accounts!inner(family_id, person_id)")
          .eq("pocket_money_accounts.family_id", familyId)
          .eq("status", "active")
          .is("deleted_at", null),

        (supabase as any)
          .from("attention_items")
          .select("title, priority")
          .eq("family_id", familyId)
          .is("resolved_at", null)
          .eq("state", "active")
          .order("priority", { ascending: true })
          .limit(10),
      ]);

      // Calendar events need the family's calendar ids first — events are
      // scoped by calendar, not directly by family.
      const calendarIds = (calendars.data ?? []).map((c: { id: string }) => c.id);
      // Declared before the events block, which now resolves a person's name
      // from it. Left where it was, this would be read before initialisation —
      // a ReferenceError on every request rather than a type error at build.
      const nameById = new Map(
        ((people.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]),
      );

      let nextEvent: FamilySummary["next_family_event"] = null;
      let todaysEvents: FamilySummary["events_today"]["events"] = [];

      if (calendarIds.length > 0) {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

        // Anything that OVERLAPS today, not merely anything that starts in it.
        //
        // A holiday running from 2 July to 12 August is on today by any
        // reasonable reading, and this reported none of them: it asked for
        // events starting today, so a family in the middle of the school
        // holidays saw "Events today: 0". The calendar entity was fixed for
        // exactly this and the summary was not.
        //
        // The window therefore reaches back before today for the start bound
        // and requires only that the event has not already ended.
        // The window has to serve two questions at once, and narrowing it to
        // today broke the second: "what is on today" wants everything
        // overlapping the day, while "what is next" wants the first thing yet
        // to start — which is usually tomorrow. Fetching only today's overlap
        // left next_family_event empty whenever nothing further was due today.
        const horizon = new Date(startOfToday.getTime() + 14 * 24 * 60 * 60 * 1000);

        const { data: events } = await (supabase as any)
          .from("events")
          .select("id, title, start_at, end_at, all_day, location, person_id")
          .in("calendar_id", calendarIds)
          .lt("start_at", horizon.toISOString())
          .gte("end_at", startOfToday.toISOString())
          .order("start_at", { ascending: true })
          .limit(200);

        const rows = (events ?? []) as {
          id: string; title: string; start_at: string; end_at: string;
          all_day: boolean | null; location: string | null; person_id: string | null;
        }[];

        todaysEvents = rows
          .filter((e) => new Date(e.start_at) < endOfToday)
          .map((e) => ({
          title: e.title,
          start_at: e.start_at,
          // So a consumer can tell "started last month, still running" from
          // "at 16:30 today" without re-deriving it.
          ongoing: new Date(e.start_at) < startOfToday,
          all_day: Boolean(e.all_day),
          }));

        // Still the next event to START. An all-day holiday that began in
        // July is genuinely "on today", but it is not what anybody means by
        // "next" — the sensor exists to answer "what is coming up".
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
            // The name as well as the id. An automation announcing "Enno has
            // physio" cannot do anything with 54c04d4b-… , and every consumer
            // resolving it themselves means every consumer needs another call.
            person: upcoming.person_id ? nameById.get(upcoming.person_id) ?? null : null,
            minutes_remaining: Math.max(
              0,
              Math.round((new Date(upcoming.start_at).getTime() - now.getTime()) / 60_000),
            ),
          };
        }
      }

      const openTodos = (todos.data ?? []) as { id: string; due_date: string | null }[];
      const overdue = openTodos.filter((t) => t.due_date !== null && t.due_date < today).length;

      const scheduleRows = (schedules.data ?? []) as { person_id: string; time_slots: unknown }[];
      const withLessons = scheduleRows.filter((s) => firstLessonOf(s.time_slots) !== null);

      const nextBirthday = ((birthdays.data ?? []) as { name: string; date: string }[])
        .map((b) => {
          const days = daysUntilNextBirthday(b.date, now);
          // The stored date carries the year of BIRTH. Reporting it as the
          // birthday's date meant a sensor saying "in 10 days" alongside
          // "2020-08-19" — two answers to the same question, one of them six
          // years out, and the wrong one is the one a calendar card would use.
          const next =
            days === null
              ? null
              : new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
          return {
            name: b.name,
            days,
            date: next ? toLocalDateKey(next) : null,
            born_on: b.date,
          };
        })
        .filter((b): b is { name: string; days: number; date: string; born_on: string } => b.days !== null)
        .sort((a, b) => a.days - b.days)[0];

      type MealRow = {
        recipe_id: string | null;
        note: string | null;
        recipes?: { title: string | null } | null;
      };
      const mealRow = ((meals.data ?? []) as MealRow[])[0];
      const mealTomorrowRow = ((mealsTomorrow.data ?? []) as MealRow[])[0];

      // What is for dinner, as a person would say it.
      //
      // A planned meal is either a free-text note or a recipe. The recipe case
      // used to report the literal string "recipe" as the state — the word,
      // not the dish — because nothing ever joined to the recipes table. On a
      // wall display that read "Dinner: recipe", which is worse than blank:
      // blank at least says nothing rather than saying something wrong.
      const mealName = (row: MealRow | undefined): string | null =>
        row?.note ?? row?.recipes?.title ?? null;

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

      // Same default as the Heute-Motor's own adapter, so the two cannot
      // resolve different parts of the day for the same instant.
      const familyTimeZone =
        typeof timezoneSetting.data?.value === "string"
          ? timezoneSetting.data.value
          : "Europe/Berlin";

      // Already ordered by priority in the query, so [0] is the one that
      // matters most rather than merely the oldest.
      const attentionItems = (attention.data ?? []) as { title: string; priority: number }[];

      // Progress is measured against the child's balance, not against a
      // per-goal pot: Kinboard has one account per child and goals are targets
      // on it, so "saved" is what they have, capped at the target so a child
      // with more than they need reads 100% rather than 340%.
      const balanceByPerson = new Map(pocketMoney.map((p) => [p.person_id, p]));
      const savingGoals: FamilySummary["saving_goals"] = (
        (goals.data ?? []) as {
          name: string;
          target_amount_cents: number;
          pocket_money_accounts?: { person_id: string | null } | null;
        }[]
      ).map((g) => {
        const personId = g.pocket_money_accounts?.person_id ?? null;
        const purse = personId ? balanceByPerson.get(personId) : undefined;
        const target = g.target_amount_cents / 100;
        const saved = Math.min(purse?.balance ?? 0, target);
        return {
          person: purse?.name ?? "?",
          name: g.name,
          target,
          saved,
          percent: target > 0 ? Math.round((saved / target) * 100) : 0,
          currency: purse?.currency ?? "EUR",
        };
      });

      // -- the next bin ----------------------------------------------------
      const wasteCalendarIds = ((wasteCalendars.data ?? []) as { id: string }[]).map((c) => c.id);
      let waste: FamilySummary["waste_collection"] = {
        state: null,
        type: null,
        date: null,
        days_until: null,
        upcoming: [],
      };

      if (wasteCalendarIds.length > 0) {
        // From the start of today, not from `now`: a collection at 06:00 is
        // still today's collection at 09:00, and a household that has not yet
        // put the bin out should not be told the next one is next week.
        const { data: wasteRows } = await (supabase as any)
          .from("events")
          .select("title, start_at")
          .in("calendar_id", wasteCalendarIds)
          .gte("start_at", new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString())
          .order("start_at", { ascending: true })
          .limit(10);

        const rows = (wasteRows ?? []) as { title: string; start_at: string }[];
        const upcoming = rows.map((row) => ({
          title: row.title,
          // The same matcher the widget uses, so the board and the sensor
          // cannot disagree about whether Thursday is paper day.
          type: detectWasteType(row.title)?.id ?? null,
          date: toLocalDateKey(new Date(row.start_at)),
        }));

        const next = upcoming[0];
        if (next) {
          const days = Math.round(
            (new Date(`${next.date}T12:00:00`).getTime() -
              new Date(`${today}T12:00:00`).getTime()) /
              86_400_000,
          );
          waste = {
            // The bin, not a count — the same reasoning as every other state
            // here. "Waste collection: 1" tells nobody which bin to put out.
            state: next.title,
            type: next.type,
            date: next.date,
            days_until: days,
            upcoming: upcoming.slice(0, 5),
          };
        }
      }

      const summary: FamilySummary = {
        next_family_event: nextEvent,
        events_today: { state: todaysEvents.length, events: todaysEvents.slice(0, 10) },
        shopping_items: shopping.count ?? 0,
        meal_today: {
          state: mealName(mealRow),
          meal: mealName(mealRow),
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
          born_on: nextBirthday?.born_on ?? null,
        },
        tasks_overdue: overdue,
        meal_tomorrow: {
          state: mealName(mealTomorrowRow),
          meal: mealName(mealTomorrowRow),
          recipe_id: mealTomorrowRow?.recipe_id ?? null,
        },
        pocket_money: pocketMoney,
        display_mode: resolveDayContext(now, familyTimeZone),
        attention_required: attentionItems.length > 0,
        attention: {
          count: attentionItems.length,
          top: attentionItems[0]?.title ?? null,
        },
        saving_goals: savingGoals,
        waste_collection: waste,
      };

      return NextResponse.json({ summary, generated_at: now.toISOString(), today, tomorrow });
    } catch (err) {
      await logApiError("integration/family/summary", err);
      return NextResponse.json({ error: "Could not build the summary" }, { status: 500 });
    }
  });
}
