import { createAdminClient } from "@/lib/supabase/server";
import {
  DEFAULT_PACK_ITEMS,
  PACK_ITEMS_SETTING_KEY,
  packItemsForSubject,
  type PackItemConfig,
} from "@/lib/schedule-pack-items";
import type {
  SignalBirthday,
  SignalEvent,
  SignalLesson,
  SignalMeal,
  SignalTodo,
  Signals,
} from "./types";

/**
 * Gathering the signals the rules read (plan §Phase 3).
 *
 * This is the only part of the Heute-Motor that touches the database. The
 * evaluator is a pure function precisely so that this boundary exists: all the
 * I/O, and all the ways the schema is awkward, live here — and a rule stays a
 * small readable statement about a family's day.
 *
 * Server-side, with the admin client, filtered by family_id explicitly. The
 * browser never runs this: an evaluator the client could run is one a child
 * could make say anything.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CollectOptions {
  /** Injected so a caller can ask "what would the board say on Tuesday?". */
  now?: Date;
  timeZone?: string;
}

/**
 * Everything the rules are allowed to see, for one family.
 *
 * Each source is fetched independently and degrades to empty on failure. A
 * family whose calendar sync is broken should still be told to pack the sports
 * kit — one dead signal must not silence the whole board.
 */
export async function collectSignals(
  familyId: string,
  options: CollectOptions = {}
): Promise<Signals> {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? (await familyTimeZone(familyId)) ?? "Europe/Berlin";

  const [events, todos, lessons, meals, birthdays, shoppingItemCount] = await Promise.all([
    fetchEvents(familyId, now).catch(() => [] as SignalEvent[]),
    fetchTodos(familyId).catch(() => [] as SignalTodo[]),
    fetchLessons(familyId).catch(() => [] as SignalLesson[]),
    fetchMeals(familyId, now).catch(() => [] as SignalMeal[]),
    fetchBirthdays(familyId, now, timeZone).catch(() => [] as SignalBirthday[]),
    fetchShoppingCount(familyId).catch(() => 0),
  ]);

  // weather and home are deliberately absent for now. The rules that use them
  // degrade to silence, which is why they can be added later without touching
  // anything here — see take-an-umbrella and lock-up-before-bed.
  return { now, timeZone, events, todos, lessons, meals, birthdays, shoppingItemCount };
}

async function familyTimeZone(familyId: string): Promise<string | null> {
  try {
    const supabase = createAdminClient();
    const { data } = await (supabase as any)
      .from("settings")
      .select("value")
      .eq("family_id", familyId)
      .eq("key", "timezone")
      .maybeSingle();
    const value = data?.value;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Events reach a family through their calendar, not directly.
 *
 * `events` carries no family_id — it has calendar_id, and calendars carry the
 * family. Filtering on the join is the only correct way, and getting it wrong
 * would mean showing one household another's appointments.
 */
async function fetchEvents(familyId: string, now: Date): Promise<SignalEvent[]> {
  const supabase = createAdminClient();

  const { data: calendars } = await (supabase as any)
    .from("calendars")
    .select("id")
    .eq("family_id", familyId);
  const calendarIds = (calendars ?? []).map((c: { id: string }) => c.id);
  if (calendarIds.length === 0) return [];

  // A little behind, so an appointment that started ten minutes ago is still
  // visible, and two days ahead, which is as far as any shipped rule looks.
  const from = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 2 * DAY_MS).toISOString();

  const { data } = await (supabase as any)
    .from("events")
    .select("id, title, start_at, end_at, all_day, location, person_id")
    .in("calendar_id", calendarIds)
    .gte("start_at", from)
    .lte("start_at", to)
    .order("start_at", { ascending: true });

  const people = await peopleNames(familyId);

  return (data ?? []).map(
    (row: Record<string, unknown>): SignalEvent => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      startAt: new Date(String(row.start_at)),
      endAt: new Date(String(row.end_at)),
      allDay: Boolean(row.all_day),
      location: (row.location as string) ?? null,
      personId: (row.person_id as string) ?? null,
      personName: row.person_id ? people.get(String(row.person_id)) ?? null : null,
    })
  );
}

async function fetchTodos(familyId: string): Promise<SignalTodo[]> {
  const supabase = createAdminClient();
  const { data } = await (supabase as any)
    .from("todos")
    .select("id, title, due_date, completed, person_id")
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .eq("completed", false);

  const people = await peopleNames(familyId);

  return (data ?? []).map(
    (row: Record<string, unknown>): SignalTodo => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      // A date-only column. Treated as end-of-day, because a task due "today"
      // is not overdue at one minute past midnight — it is overdue tomorrow.
      dueDate: row.due_date ? new Date(`${String(row.due_date)}T23:59:59`) : null,
      completed: Boolean(row.completed),
      personId: (row.person_id as string) ?? null,
      personName: row.person_id ? people.get(String(row.person_id)) ?? null : null,
    })
  );
}

/**
 * The timetable, flattened.
 *
 * `schedules` stores one row per person per weekday, with the lessons in a
 * JSONB `time_slots` array — so a "lesson" is not a row and has to be unpacked
 * here rather than queried.
 *
 * The pack list is not stored against a lesson at all. It is a per-family
 * setting mapping a subject *substring* to a list of things, which is how the
 * schedule page already does it: "Sport" matches "Sport" and "Sportförderung"
 * alike. Reimplementing the match differently here would mean the board and
 * the timetable page disagreed about whether to bring a sports kit.
 */
async function fetchLessons(familyId: string): Promise<SignalLesson[]> {
  const supabase = createAdminClient();

  const [{ data: schedules }, packItems, people] = await Promise.all([
    (supabase as any)
      .from("schedules")
      .select("person_id, day_of_week, time_slots")
      .eq("family_id", familyId),
    fetchPackItems(familyId),
    peopleNames(familyId),
  ]);

  const lessons: SignalLesson[] = [];
  for (const row of schedules ?? []) {
    const personId = String(row.person_id);
    const slots = Array.isArray(row.time_slots) ? row.time_slots : [];
    for (const slot of slots) {
      const subject = typeof slot?.subject === "string" ? slot.subject : "";
      if (!subject) continue;

      lessons.push({
        personId,
        personName: people.get(personId) ?? "",
        dayOfWeek: Number(row.day_of_week),
        period: Number(slot?.period ?? 0),
        subject,
        packList: packItemsForSubject(subject, packItems),
      });
    }
  }
  return lessons;
}

async function fetchPackItems(familyId: string): Promise<PackItemConfig[]> {
  try {
    const supabase = createAdminClient();
    const { data } = await (supabase as any)
      .from("settings")
      .select("value")
      .eq("family_id", familyId)
      .eq("key", PACK_ITEMS_SETTING_KEY)
      .maybeSingle();
    const value = data?.value;
    return Array.isArray(value) && value.length > 0 ? value : DEFAULT_PACK_ITEMS;
  } catch {
    return DEFAULT_PACK_ITEMS;
  }
}

async function fetchMeals(familyId: string, now: Date): Promise<SignalMeal[]> {
  const supabase = createAdminClient();

  const { data: plans } = await (supabase as any)
    .from("meal_plans")
    .select("id")
    .eq("family_id", familyId);
  const planIds = (plans ?? []).map((p: { id: string }) => p.id);
  if (planIds.length === 0) return [];

  const from = new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 3 * DAY_MS).toISOString().slice(0, 10);

  const { data } = await (supabase as any)
    .from("meal_plan_entries")
    .select("date, meal_type, note, recipe_id, recipes(title)")
    .in("meal_plan_id", planIds)
    .is("deleted_at", null)
    .gte("date", from)
    .lte("date", to);

  return (data ?? []).map((row: Record<string, any>): SignalMeal => ({
    date: new Date(`${String(row.date)}T12:00:00`),
    mealType: String(row.meal_type ?? ""),
    // A planned meal is either a recipe or a free-text note; either counts as
    // "something is planned", which is the only question a rule asks.
    title: row.recipes?.title ?? row.note ?? null,
  }));
}

async function fetchBirthdays(
  familyId: string,
  now: Date,
  timeZone: string
): Promise<SignalBirthday[]> {
  const supabase = createAdminClient();
  const { data } = await (supabase as any)
    .from("birthdays")
    .select("id, name, date")
    .eq("family_id", familyId)
    .is("deleted_at", null);

  const today = localDate(now, timeZone);

  return (data ?? []).map((row: Record<string, unknown>): SignalBirthday => {
    const stored = new Date(`${String(row.date)}T12:00:00`);
    // The stored year is the year of birth, so the next occurrence has to be
    // computed. Midday avoids the date shifting under a timezone conversion.
    const next = new Date(stored);
    next.setFullYear(today.getFullYear());
    if (next < today) next.setFullYear(today.getFullYear() + 1);

    return {
      id: String(row.id),
      name: String(row.name ?? ""),
      date: next,
      daysUntil: Math.round((next.getTime() - today.getTime()) / DAY_MS),
    };
  });
}

/** Local midday today, as an instant — the anchor day comparisons hang off. */
function localDate(instant: Date, timeZone: string): Date {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return new Date(`${day}T12:00:00`);
}

async function fetchShoppingCount(familyId: string): Promise<number> {
  const supabase = createAdminClient();
  const { count } = await (supabase as any)
    .from("shopping_items")
    .select("id", { head: true, count: "exact" })
    .eq("family_id", familyId)
    .eq("checked", false);
  return count ?? 0;
}

const peopleCache = new Map<string, Map<string, string>>();

async function peopleNames(familyId: string): Promise<Map<string, string>> {
  // Per-invocation memo: several fetchers want the same names, and asking six
  // times for a table that changes about once a year is wasteful. Cleared by
  // the caller between evaluations.
  const cached = peopleCache.get(familyId);
  if (cached) return cached;

  const supabase = createAdminClient();
  const { data } = await (supabase as any)
    .from("people")
    .select("id, name")
    .eq("family_id", familyId);

  const names = new Map<string, string>(
    (data ?? []).map((p: { id: string; name: string }) => [String(p.id), String(p.name)])
  );
  peopleCache.set(familyId, names);
  return names;
}

/** Drop the memo. Called between evaluations so a renamed person is picked up. */
export function resetSignalCaches(): void {
  peopleCache.clear();
}
