/**
 * "How did our week go?" — `GET /api/integration/v1/week-summary` and the
 * `get_week_summary` tool: one compact look back over a few days, and a
 * glance at the week ahead, built from the reads the app already has.
 *
 * WHERE EACH PART COMES FROM
 *
 *   tasks       todo_events, the task log (migration_zzzzzy_todo_turns.sql):
 *               every tick and un-tick, with whose turn it was. A day ticked
 *               and taken back again does not count. Missed days are the
 *               written-down ones (todo_occurrences, status missed), which
 *               exist only for tasks that take turns or track completion.
 *   points      todo_point_awards (earned; an un-tick deletes its row),
 *               approved point_redemptions and point_purchases (spent) —
 *               the rows point_person_totals() itself adds up.
 *   creatures   creatureStage() (lib/creatures/stage.ts), the screens'
 *               arithmetic, at the start and the end of the range: the
 *               points earned (or, for a creature that grows with money,
 *               the balance) then, worked back from today's. Named columns
 *               only: never a creature's look or the name the child gave it.
 *   meals       meal_plan_entries, as GET /meals reads them (toMealEntry).
 *   events      eventsOverlapping(), as GET /calendar/events reads them.
 *   next week   listBirthdays() and listCountdowns(), as their own routes.
 *
 * Days are the family's: its time zone turns the dates into instants. Every
 * read is filtered by family; the admin client bypasses RLS.
 */

import { addDays, familyDateKey } from "@/lib/family-time";
import { zonedWallTimeToUtc } from "@/lib/integration-event-input";
import { isRealDate, toMealEntry, type MealEntryRow } from "@/lib/integration-meal-input";
import { eventsOverlapping, familyCalendarIds, type ListedEvent, type SearchDb } from "@/lib/integration-event-search";
import { listBirthdays } from "@/lib/integration-birthdays";
import { listCountdowns } from "@/lib/countdowns";
import { creatureStage } from "@/lib/creatures/stage";
import { stageNameFor } from "@/lib/integration-rewards";

// The admin client is untyped for these tables, as in the other routes.
type Db = SearchDb;

/** The longest range one summary covers. */
export const MAX_SUMMARY_DAYS = 31;
/** The default range: the last 7 days, today included. */
export const DEFAULT_SUMMARY_DAYS = 7;
/** How many days "next week" looks ahead, from tomorrow. */
export const NEXT_DAYS = 7;
/** The most events listed by name, looking back and ahead; the rest are counted. */
export const MAX_NOTABLE_EVENTS = 8;
export const MAX_UPCOMING_EVENTS = 10;
/** The most planned meals listed; the rest are counted. */
export const MAX_MEALS_LISTED = 21;
/** The tasks a person did most often, by title. */
export const MAX_TOP_TASKS = 3;
/** The task log's default retention (Settings → Task log). */
const DEFAULT_TASK_LOG_DAYS = 90;
const TASK_LOG_KEY = "task_log";

export interface WeekSummaryDeps {
  db: Db;
  timeZone: string;
  locale: string;
  now: Date;
}

export type WeekSummaryResult =
  | { status: 200; body: WeekSummary }
  | { status: 400; body: { error: string; code: "invalid_request" } };

export interface PersonWeek {
  person_id: string;
  name: string;
  is_child: boolean;
  tasks_completed: number;
  /** Due days written down as missed: only tasks that take turns or track completion have them. */
  tasks_missed: number;
  /** What they did most, by title, most often first. */
  most_done: { title: string; times: number }[];
  /** Children only. */
  points?: { earned: number; spent: number };
}

export interface CreatureWeek {
  person_id: string;
  name: string;
  species: string;
  from_stage: number;
  from_stage_name: string;
  to_stage: number;
  to_stage_name: string;
}

export interface WeekSummary {
  start: string;
  end: string;
  time_zone: string;
  /** The language stage names are in. */
  locale: string;
  people: PersonWeek[];
  /** Ticks on tasks assigned to nobody (or to someone no longer in the family). */
  unassigned_tasks_completed: number;
  /** False when the range starts before the oldest entry the task log keeps. */
  task_log_complete: boolean;
  creatures: CreatureWeek[];
  meals: { count: number; planned: { date: string; meal_type: string; title: string | null }[] };
  events: { count: number; notable: { title: string; date: string; all_day: boolean }[] };
  next_week: {
    start: string;
    end: string;
    events: { count: number; list: { title: string; date: string; time: string | null; all_day: boolean }[] };
    birthdays: { name: string; date: string; turns: number | null }[];
    countdowns: { title: string; date: string; days_until: number }[];
  };
}

const dayNumber = (key: string) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86_400_000;
/** The instant `day` (YYYY-MM-DD) begins in `timeZone`. */
const dayStart = (day: string, timeZone: string) => zonedWallTimeToUtc(dayNumber(day), 0, timeZone);

/**
 * The range asked for, or why not. Both dates or neither; without them, the
 * last DEFAULT_SUMMARY_DAYS days up to today. A review looks back, so the
 * end may not be after today.
 */
export function parseSummaryRange(
  startRaw: string | null, endRaw: string | null, today: string,
): { ok: true; start: string; end: string } | { ok: false; error: string } {
  if (startRaw === null && endRaw === null) {
    return { ok: true, start: addDays(today, -(DEFAULT_SUMMARY_DAYS - 1)), end: today };
  }
  if (startRaw === null || endRaw === null) return { ok: false, error: "send both `start` and `end`, or neither for the last 7 days" };
  if (!isRealDate(startRaw) || !isRealDate(endRaw)) return { ok: false, error: "`start` and `end` must be YYYY-MM-DD dates" };
  if (endRaw < startRaw) return { ok: false, error: "`end` must not be before `start`" };
  if (endRaw > today) return { ok: false, error: `\`end\` may not be after today (${today}): a summary looks back` };
  if (dayNumber(endRaw) - dayNumber(startRaw) + 1 > MAX_SUMMARY_DAYS) {
    return { ok: false, error: `the range may not exceed ${MAX_SUMMARY_DAYS} days` };
  }
  return { ok: true, start: startRaw, end: endRaw };
}

function rows<T>(result: { data: unknown; error: unknown }, what: string): T[] {
  if (result.error) throw new Error(`Failed to read ${what}: ${(result.error as { message?: string }).message ?? String(result.error)}`);
  return (result.data ?? []) as T[];
}

interface PersonRow { id: string; name: string; is_child: boolean | null }
interface LogRow { todo_id: string | null; kind: "completed" | "uncompleted"; at: string; person_id: string | null; day: string | null; detail: { title?: unknown } | null }
interface AwardRow { person_id: string; points: number; created_at: string }
interface CreatureRow { person_id: string; species: string; grows_with: string; best_tier: number | null }
interface AccountRow { id: string; person_id: string; balance_cents: number | null }
interface TxRow { account_id: string; amount_cents: number; created_at: string }

/**
 * Who did which task, from the log between `from` and `to`: per task and
 * due day, the last tick or un-tick decides, and only a tick counts. The
 * person is whose turn it was (a task with turns) or the assignee.
 */
export function countCompletions(log: readonly LogRow[]): { person_id: string | null; title: string }[] {
  const last = new Map<string, LogRow>();
  const ordered = [...log].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  ordered.forEach((row, i) => {
    // A task emptied from the bin keeps its log with no todo id: each of
    // its rows then stands alone.
    const key = row.todo_id ? `${row.todo_id}|${row.day ?? "-"}` : `gone#${i}`;
    last.set(key, row);
  });
  return [...last.values()]
    .filter((row) => row.kind === "completed")
    .map((row) => ({ person_id: row.person_id, title: typeof row.detail?.title === "string" ? row.detail.title : "" }));
}

/** The most frequent titles, most often first, then by title. */
function topTitles(titles: string[]): { title: string; times: number }[] {
  const counts = new Map<string, number>();
  for (const t of titles) if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TOP_TASKS)
    .map(([title, times]) => ({ title, times }));
}

const sum = <T>(list: readonly T[], value: (row: T) => number) => list.reduce((n, row) => n + value(row), 0);

export async function readWeekSummary(
  familyId: string,
  query: { start: string | null; end: string | null },
  deps: WeekSummaryDeps,
): Promise<WeekSummaryResult> {
  const { db, timeZone, now } = deps;
  const today = familyDateKey(now, timeZone);
  const range = parseSummaryRange(query.start, query.end, today);
  if (!range.ok) return { status: 400, body: { error: range.error, code: "invalid_request" } };

  const from = dayStart(range.start, timeZone);
  const dayAfterEnd = dayStart(addDays(range.end, 1), timeZone);
  // The range ends now when it ends today: nothing later has happened yet.
  const to = new Date(Math.min(dayAfterEnd.getTime(), now.getTime()));
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const d = db as any;

  const [people, log, missed, awards, redemptions, purchases, creatures, accounts, mealRes, taskLog, calendarIds] = await Promise.all([
    d.from("people").select("id, name, is_child").eq("family_id", familyId).is("deleted_at", null)
      .order("created_at", { ascending: true }),
    d.from("todo_events").select("todo_id, kind, at, person_id, day, detail").eq("family_id", familyId)
      .in("kind", ["completed", "uncompleted"]).gte("at", fromIso).lt("at", toIso).order("at", { ascending: true }),
    d.from("todo_occurrences").select("person_id").eq("family_id", familyId).eq("status", "missed")
      .gte("day", range.start).lte("day", range.end),
    // From the start on, not only to the end: the awards after the range are
    // what is taken off today's total to know the points at its end.
    d.from("todo_point_awards").select("person_id, points, created_at").eq("family_id", familyId).gte("created_at", fromIso),
    d.from("point_redemptions").select("person_id, cost_points").eq("family_id", familyId).eq("status", "approved")
      .gte("decided_at", fromIso).lt("decided_at", toIso),
    d.from("point_purchases").select("person_id, cost").eq("family_id", familyId)
      .gte("created_at", fromIso).lt("created_at", toIso),
    // Named columns: never `look`, never `*` (lib/integration-rewards.ts).
    d.from("creatures").select("person_id, species, grows_with, best_tier").eq("family_id", familyId).eq("enabled", true),
    d.from("pocket_money_accounts").select("id, person_id, balance_cents").eq("family_id", familyId),
    d.from("meal_plan_entries")
      .select("id, date, meal_type, recipe_id, note, servings, recipe:recipes(title, deleted_at), meal_plan:meal_plans!inner(family_id)")
      .eq("meal_plan.family_id", familyId).gte("date", range.start).lte("date", range.end).is("deleted_at", null)
      .order("date").order("meal_type"),
    d.from("settings").select("value").eq("family_id", familyId).eq("key", TASK_LOG_KEY).maybeSingle(),
    familyCalendarIds(db, familyId),
  ]);

  const peopleRows = rows<PersonRow>(people, "people");
  const completions = countCompletions(rows<LogRow>(log, "the task log"));
  const missedRows = rows<{ person_id: string | null }>(missed, "missed days");
  const awardRows = rows<AwardRow>(awards, "points");
  const awardsInRange = awardRows.filter((a) => Date.parse(a.created_at) < to.getTime());
  const redemptionRows = rows<{ person_id: string; cost_points: number }>(redemptions, "rewards");
  const purchaseRows = rows<{ person_id: string; cost: number }>(purchases, "shop purchases");
  const creatureRows = rows<CreatureRow>(creatures, "creature stages");
  const accountRows = rows<AccountRow>(accounts, "pocket money accounts");
  const mealRows = rows<MealEntryRow>(mealRes, "the meal plan");
  if (taskLog.error) throw new Error(`Failed to read the task log setting: ${taskLog.error.message}`);

  // ── people and their tasks ────────────────────────────────────────────
  const known = new Set(peopleRows.map((p) => p.id));
  const peopleOut: PersonWeek[] = peopleRows.map((person) => {
    const done = completions.filter((c) => c.person_id === person.id);
    const entry: PersonWeek = {
      person_id: person.id,
      name: person.name,
      is_child: person.is_child === true,
      tasks_completed: done.length,
      tasks_missed: missedRows.filter((m) => m.person_id === person.id).length,
      most_done: topTitles(done.map((c) => c.title)),
    };
    if (person.is_child === true) {
      entry.points = {
        earned: sum(awardsInRange.filter((a) => a.person_id === person.id), (a) => a.points),
        spent: sum(redemptionRows.filter((r) => r.person_id === person.id), (r) => r.cost_points)
          + sum(purchaseRows.filter((p) => p.person_id === person.id), (p) => p.cost),
      };
    }
    return entry;
  });

  const retention = (taskLog.data?.value as { retentionDays?: unknown } | null)?.retentionDays;
  const keptDays = typeof retention === "number" ? retention : DEFAULT_TASK_LOG_DAYS;
  const taskLogComplete = keptDays <= 0 || from.getTime() >= now.getTime() - keptDays * 86_400_000;

  // ── creatures ─────────────────────────────────────────────────────────
  const stageName = stageNameFor(deps.locale);
  const creaturesOut: CreatureWeek[] = [];
  const moneyAccounts = accountRows.filter((a) => creatureRows.some((c) => c.person_id === a.person_id && c.grows_with === "money"));
  let txRows: TxRow[] = [];
  if (moneyAccounts.length > 0) {
    txRows = rows<TxRow>(await d.from("pocket_money_transactions").select("account_id, amount_cents, created_at")
      .in("account_id", moneyAccounts.map((a) => a.id)).gte("created_at", fromIso), "pocket money transactions");
  }
  for (const person of peopleRows) {
    if (person.is_child !== true) continue;
    const creature = creatureRows.find((c) => c.person_id === person.id);
    if (!creature) continue;
    const { data, error } = await d.rpc("point_person_totals", { p_family_id: familyId, p_person_id: person.id });
    if (error) throw new Error(`Failed to read points: ${error.message}`);
    if (!data) continue; // gone between the two reads
    const mine = awardRows.filter((a) => a.person_id === person.id);
    const earnedEnd = Number(data.earned) - sum(mine.filter((a) => Date.parse(a.created_at) >= to.getTime()), (a) => a.points);
    const earnedStart = earnedEnd - sum(mine.filter((a) => Date.parse(a.created_at) < to.getTime()), (a) => a.points);
    const account = accountRows.find((a) => a.person_id === person.id) ?? null;
    const tx = account ? txRows.filter((t) => t.account_id === account.id) : [];
    const balanceEnd = (account?.balance_cents ?? 0) - sum(tx.filter((t) => Date.parse(t.created_at) >= to.getTime()), (t) => t.amount_cents);
    const balanceStart = balanceEnd - sum(tx.filter((t) => Date.parse(t.created_at) < to.getTime()), (t) => t.amount_cents);
    const at = (earned: number, balance: number) => creatureStage({
      creature: { grows_with: creature.grows_with, best_tier: creature.best_tier },
      account: account ? { balance_cents: balance } : null,
      earnedPoints: earned,
    }).tier;
    const fromStage = at(earnedStart, balanceStart);
    const toStage = at(earnedEnd, balanceEnd);
    creaturesOut.push({
      person_id: person.id,
      name: person.name,
      species: creature.species,
      from_stage: fromStage,
      from_stage_name: stageName(creature.species, fromStage),
      to_stage: toStage,
      to_stage_name: stageName(creature.species, toStage),
    });
  }

  // ── meals ─────────────────────────────────────────────────────────────
  const mealEntries = mealRows.map(toMealEntry);
  const meals = {
    count: mealEntries.length,
    planned: mealEntries.slice(0, MAX_MEALS_LISTED)
      .map((m) => ({ date: m.date, meal_type: m.meal_type, title: m.recipe_title ?? m.note ?? null })),
  };

  // ── events, past and next ─────────────────────────────────────────────
  const nextStart = addDays(today, 1);
  const nextEnd = addDays(today, NEXT_DAYS);
  const [past, upcoming, birthdays, countdowns] = await Promise.all([
    eventsOverlapping(db, calendarIds, from, to),
    eventsOverlapping(db, calendarIds, dayStart(nextStart, timeZone), dayStart(addDays(nextEnd, 1), timeZone)),
    listBirthdays(familyId, today, db),
    listCountdowns(familyId, today, db),
  ]);
  const localDate = (e: ListedEvent) => familyDateKey(new Date(e.start_at), timeZone);
  const title = (e: ListedEvent) => (typeof e.title === "string" ? e.title : "");
  // Notable: what happened once in the range. A title that comes round
  // again (swimming every Tuesday) is routine and only counted.
  const timesSeen = new Map<string, number>();
  for (const e of past) timesSeen.set(title(e).trim().toLowerCase(), (timesSeen.get(title(e).trim().toLowerCase()) ?? 0) + 1);
  const notable = past
    .filter((e) => timesSeen.get(title(e).trim().toLowerCase()) === 1)
    .slice(0, MAX_NOTABLE_EVENTS)
    .map((e) => ({ title: title(e), date: e.all_day === true ? clampDate(localDate(e), range.start) : localDate(e), all_day: e.all_day === true }));

  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const nextList = upcoming.slice(0, MAX_UPCOMING_EVENTS).map((e) => ({
    title: title(e),
    date: clampDate(localDate(e), nextStart),
    time: e.all_day === true || Date.parse(e.start_at) < dayStart(nextStart, timeZone).getTime()
      ? null : time.format(new Date(e.start_at)),
    all_day: e.all_day === true,
  }));

  return {
    status: 200,
    body: {
      start: range.start,
      end: range.end,
      time_zone: timeZone,
      locale: deps.locale,
      people: peopleOut,
      unassigned_tasks_completed: completions.filter((c) => !c.person_id || !known.has(c.person_id)).length,
      task_log_complete: taskLogComplete,
      creatures: creaturesOut,
      meals,
      events: { count: past.length, notable },
      next_week: {
        start: nextStart,
        end: nextEnd,
        events: { count: upcoming.length, list: nextList },
        birthdays: birthdays.filter((b) => b.days_until >= 1 && b.days_until <= NEXT_DAYS)
          .map((b) => ({ name: b.name, date: b.next_date, turns: b.turns })),
        countdowns: countdowns.filter((c) => c.days_until >= 1 && c.days_until <= NEXT_DAYS)
          .map((c) => ({ title: c.title, date: c.date, days_until: c.days_until })),
      },
    },
  };
}

/** An event that began before the window is shown on the window's first day. */
function clampDate(day: string, first: string): string {
  return day < first ? first : day;
}
