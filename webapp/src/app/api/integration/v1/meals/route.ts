import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import {
  findStoredResult, fingerprintRequest, storeResult, validateIdempotencyKey,
} from "@/lib/integration-idempotency";
import { parseMealEntryInput, toMealEntry, type MealEntryRow } from "@/lib/integration-meal-input";
import { familyWeekStartsOn, weekStartForDate } from "@/lib/meal-plan-week";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/integration/v1/meals
 *
 * The meal plan, scoped through `meal_plans!inner(family_id)` because
 * `meal_plan_entries` carries no `family_id` of its own (RFC-011 task 5
 * brief) — same join `hooks/use-meal-planner.ts`'s `useMealPlan` uses, and
 * for the same reason: entries are fetched by the dates on screen (here,
 * the requested range) rather than by `meal_plan_id`, so a week renders
 * correctly however its container row happens to be keyed.
 */

/** A range wider than this is a mistake, not a meal plan view. */
export const MAX_MEAL_RANGE_DAYS = 31;

export interface MealRangeParseResult {
  ok: boolean;
  start?: string;
  end?: string;
  reason?: "missing" | "unparseable" | "reversed" | "too_wide";
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date as a UTC day number, or null. */
function dayNumber(value: string): number | null {
  const m = DATE_ONLY.exec(value);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return ms / 86_400_000;
}

/**
 * Parse and bound the requested window.
 *
 * Plain `YYYY-MM-DD` dates, not timestamps: a meal plan entry has no
 * time-of-day, and accepting timestamps would invite the same
 * zone-shifts-the-day bug `integration-event-input.ts` documents for
 * all-day calendar events.
 */
export function parseMealRange(startRaw: string | null, endRaw: string | null): MealRangeParseResult {
  if (!startRaw || !endRaw) return { ok: false, reason: "missing" };

  const startDay = dayNumber(startRaw);
  const endDay = dayNumber(endRaw);
  if (startDay === null || endDay === null) return { ok: false, reason: "unparseable" };
  if (endDay < startDay) return { ok: false, reason: "reversed" };
  if (endDay - startDay + 1 > MAX_MEAL_RANGE_DAYS) return { ok: false, reason: "too_wide" };

  return { ok: true, start: startRaw, end: endRaw };
}

export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    const url = new URL(request.url);
    const range = parseMealRange(url.searchParams.get("start"), url.searchParams.get("end"));

    if (!range.ok) {
      const messages: Record<string, string> = {
        missing: "`start` and `end` are both required",
        unparseable: "`start` and `end` must be YYYY-MM-DD dates",
        reversed: "`end` must not be before `start`",
        too_wide: `the window may not exceed ${MAX_MEAL_RANGE_DAYS} days`,
      };
      return NextResponse.json(
        { error: messages[range.reason ?? "missing"], code: "invalid_request" },
        { status: 400 },
      );
    }

    try {
      const supabase = createAdminClient();
      const { data, error } = await (supabase as any)
        .from("meal_plan_entries")
        .select(`
          id, date, meal_type, recipe_id, note, servings,
          recipe:recipes(title, deleted_at),
          meal_plan:meal_plans!inner(family_id)
        `)
        .eq("meal_plan.family_id", context.familyId)
        .gte("date", range.start!)
        .lte("date", range.end!)
        .is("deleted_at", null)
        .order("date")
        .order("meal_type");

      if (error) throw error;

      const entries = ((data ?? []) as MealEntryRow[]).map(toMealEntry);

      return NextResponse.json({ entries });
    } catch (err) {
      await logApiError("integration/meals/read", err);
      return NextResponse.json(
        { error: "Could not read the meal plan", code: "internal_error" },
        { status: 500 },
      );
    }
  });
}

/**
 * The container row for `weekStart`, creating it if needed.
 *
 * Same SELECT-then-upsert shape as `getOrCreateMealPlanId` in
 * `hooks/use-meal-planner.ts` (admin client here, not the browser's): a
 * SELECT first so an existing week's row is never touched by an UPDATE, and
 * the insert's `ON CONFLICT DO NOTHING` so two concurrent creates of the
 * same week settle on one row without either erroring or double-writing.
 */
async function getOrCreateMealPlanId(
  supabase: ReturnType<typeof createAdminClient>,
  familyId: string,
  weekStart: string,
): Promise<string> {
  const plans = (supabase as any).from("meal_plans");
  const findPlan = () => plans.select("id").eq("family_id", familyId).eq("week_start", weekStart);

  const { data: existing, error: readError } = await findPlan().maybeSingle();
  if (readError) throw readError;
  if (existing) return existing.id as string;

  const { data: inserted, error: insertError } = await plans
    .upsert(
      { family_id: familyId, week_start: weekStart },
      { onConflict: "family_id,week_start", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (insertError) throw insertError;
  if (inserted) return inserted.id as string;

  // A competing request inserted it between our SELECT and INSERT.
  const { data: raced, error: raceError } = await findPlan().single();
  if (raceError) throw raceError;
  return raced.id as string;
}

/** Add an entry to the week containing `date`, creating the plan row if needed. */
export async function POST(request: NextRequest) {
  return withIntegrationAuth(request, "meals:write", async (context) => {
    const key = validateIdempotencyKey(request.headers.get("idempotency-key"));
    if (!key.ok) {
      return NextResponse.json({ error: "An Idempotency-Key is required", code: "invalid_request" }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : {};
    } catch {
      body = {};
    }

    const input = parseMealEntryInput(body);
    if (!input.ok) {
      return NextResponse.json({ error: input.error, code: "invalid_request" }, { status: 400 });
    }
    const entry = input.value;

    const hash = fingerprintRequest("meals", body);
    const previous = await findStoredResult(context.familyId, key.key);
    if (previous) {
      if (previous.request_hash !== hash) {
        return NextResponse.json({ error: "Idempotency-Key reused with different arguments", code: "conflict" }, { status: 409 });
      }
      return NextResponse.json(previous.response, { status: previous.status, headers: { "idempotent-replay": "true" } });
    }

    try {
      const supabase = createAdminClient();

      if (entry.recipeId) {
        const { data: recipe, error: recipeError } = await (supabase as any)
          .from("recipes")
          .select("id")
          .eq("id", entry.recipeId)
          .eq("family_id", context.familyId)
          // A binned recipe is gone as far as an assistant is concerned.
          .is("deleted_at", null)
          .maybeSingle();
        if (recipeError) throw recipeError;
        if (!recipe) {
          return NextResponse.json({ error: "no such recipe", code: "not_found" }, { status: 404 });
        }
      }

      const weekStartsOn = await familyWeekStartsOn(context.familyId);
      const weekStart = weekStartForDate(entry.date, weekStartsOn);
      const mealPlanId = await getOrCreateMealPlanId(supabase, context.familyId, weekStart);

      const { data, error } = await (supabase as any)
        .from("meal_plan_entries")
        .insert({
          meal_plan_id: mealPlanId,
          date: entry.date,
          meal_type: entry.mealType,
          ...(entry.recipeId !== undefined ? { recipe_id: entry.recipeId } : {}),
          ...(entry.note !== undefined ? { note: entry.note } : {}),
          ...(entry.servings !== undefined ? { servings: entry.servings } : {}),
        })
        .select("id, date, meal_type, recipe_id, note, servings")
        .single();
      if (error) throw error;

      let recipeTitle: string | null = null;
      if (data.recipe_id) {
        const { data: recipe } = await (supabase as any)
          .from("recipes").select("title").eq("id", data.recipe_id).is("deleted_at", null).maybeSingle();
        recipeTitle = recipe?.title ?? null;
      }

      const response = { entry: { ...data, recipe_title: recipeTitle } };
      await storeResult({ familyId: context.familyId, key: key.key, service: "meals", requestHash: hash, status: 201, response });
      return NextResponse.json(response, { status: 201 });
    } catch (err) {
      await logApiError("integration/meals/create", err);
      return NextResponse.json({ error: "Could not add the meal", code: "internal_error" }, { status: 500 });
    }
  });
}
