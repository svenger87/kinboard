"use client";

import { toLocalDateKey } from "@/lib/local-date";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { requireFamilyId } from "./use-supabase-queries";
import { useWeekStart } from "./use-week-start";
import type { WeekStartsOn } from "./use-week-start";
import type {
  MealPlan,
  MealPlanEntry,
  MealPlanEntryWithRecipe,
  MealType,
} from "@/types/database";

// Query keys
export const mealPlanQueryKeys = {
  all: (familyId: string) => ["meal-plans", familyId] as const,
  week: (familyId: string, weekStart: string) =>
    ["meal-plans", familyId, weekStart] as const,
  entries: (familyId: string, mealPlanId: string) =>
    ["meal-plans", familyId, "entries", mealPlanId] as const,
};

// Moved to lib/local-date so the rest of the app stops reinventing it —
// three places in this file were bypassing it with toISOString().
const toLocalDateString = toLocalDateKey;

/**
 * The first day of the week containing `date`, as `YYYY-MM-DD`.
 *
 * `weekStartsOn` is required rather than defaulted, deliberately. This is both
 * the planner's display window and the key of the `meal_plans` row, and it used
 * to hardcode Monday — so a household that had chosen a Sunday start still got
 * a Monday-to-Sunday grid (issue #228). A default here would let a caller keep
 * the old behaviour by saying nothing, which is exactly how the setting came to
 * be missed in three call sites.
 *
 * Comes from `useWeekStart()`: 0 is Sunday, 1 is Monday.
 */
export function getWeekStart(date: Date, weekStartsOn: WeekStartsOn): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // How many days we are past the start of the week, 0-6.
  const offset = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - offset);
  return toLocalDateString(d);
}

// Helper to format date for display
export function formatDate(dateStr: string, locale: string): string {
  // Parse as local date (add T12:00 to avoid timezone edge cases)
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// Helper to get dates for a week
export function getWeekDates(weekStart: string): string[] {
  const dates: string[] = [];
  // Parse as local date
  const start = new Date(weekStart + "T12:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(toLocalDateString(d));
  }
  return dates;
}

// Ordered meal types — labels are resolved per-locale via t("meals.mealType.*").
export const MEAL_TYPES: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack"] as const;

// Input types
export interface CreateMealPlanEntryInput {
  date: string;
  meal_type: MealType;
  recipe_id?: string | null;
  note?: string | null;
  servings?: number;
}

export interface UpdateMealPlanEntryInput {
  id: string;
  date?: string;
  meal_type?: MealType;
  recipe_id?: string | null;
  note?: string | null;
  servings?: number;
}

// Fetch or create meal plan for a specific week
export function useMealPlan(weekStart: string) {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: mealPlanQueryKeys.week(family?.id ?? "", weekStart),
    queryFn: async (): Promise<{
      mealPlan: MealPlan;
      entries: MealPlanEntryWithRecipe[];
    }> => {
       
      const supabaseAny = supabase as any;

      // Get or create meal plan via upsert. The unique constraint
      // (family_id, week_start) makes this race-safe — without it, parallel
      // hooks (dashboard widget + meals page + adjacent-week prefetch) all
      // SELECT → null → INSERT and cascade into 409 conflicts.
      const { data: mealPlan, error } = await supabaseAny
        .from("meal_plans")
        .upsert(
          {
            family_id: requireFamilyId(family),
            week_start: weekStart,
          },
          { onConflict: "family_id,week_start" },
        )
        .select()
        .single();

      if (error) throw error;

      /*
        Entries are fetched by the dates on screen, not by `meal_plan_id`.

        The plan row's `week_start` follows the household's "week starts on"
        setting, and that setting can be changed at any time. Keyed by plan row,
        flipping it from Monday to Sunday would have hidden every entry already
        written: the visible Sunday-to-Saturday week spans two Monday-keyed
        plans, and a query for one of them returns neither in full. Six days of
        a family's meals would silently vanish from the grid while sitting
        perfectly intact in the table.

        Asking for the seven dates the grid is about to draw cannot go wrong
        that way, whatever the rows are keyed by. `meal_plans!inner` scopes it
        to this family — `meal_plan_entries` carries no `family_id` of its own,
        so the join is what keeps one household out of another's week, and RLS
        still applies underneath.
      */
      const weekDates = getWeekDates(weekStart);

      const { data: entries, error: entriesError } = await supabaseAny
        .from("meal_plan_entries")
        .select(
          `
          *,
          recipe:recipes(id, title, image_url, total_time_minutes, servings),
          meal_plan:meal_plans!inner(family_id)
        `
        )
        .eq("meal_plan.family_id", requireFamilyId(family))
        .gte("date", weekDates[0])
        .lte("date", weekDates[6])
        .order("date")
        .order("meal_type");

      if (entriesError) throw entriesError;

      return {
        mealPlan: mealPlan as MealPlan,
        entries: (entries || []) as MealPlanEntryWithRecipe[],
      };
    },
    enabled: !!family?.id && !!weekStart,
  });
}

// Add entry to meal plan
export function useAddMealPlanEntry() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      weekStart,
      entry,
    }: {
      weekStart: string;
      entry: CreateMealPlanEntryInput;
    }): Promise<MealPlanEntry> => {
       
      const supabaseAny = supabase as any;

      // Race-safe get-or-create — see useMealPlan above.
      const { data: mealPlan, error: planError } = await supabaseAny
        .from("meal_plans")
        .upsert(
          {
            family_id: requireFamilyId(family),
            week_start: weekStart,
          },
          { onConflict: "family_id,week_start" },
        )
        .select("id")
        .single();

      if (planError) throw planError;

      // Create entry
      const { data, error } = await supabaseAny
        .from("meal_plan_entries")
        .insert({
          meal_plan_id: mealPlan.id,
          ...entry,
        })
        .select()
        .single();

      if (error) throw error;
      return data as MealPlanEntry;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: mealPlanQueryKeys.week(requireFamilyId(family), variables.weekStart),
      });
    },
  });
}

// Update meal plan entry (for rescheduling)
export function useUpdateMealPlanEntry() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      weekStart,
      update,
    }: {
      weekStart: string;
      update: UpdateMealPlanEntryInput;
    }): Promise<MealPlanEntry> => {
      const { id, ...updates } = update;

       
      const { data, error } = await (supabase as any)
        .from("meal_plan_entries")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as MealPlanEntry;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: mealPlanQueryKeys.week(requireFamilyId(family), variables.weekStart),
      });
      // Also invalidate adjacent weeks in case entry was moved
      const prevWeek = new Date(variables.weekStart);
      prevWeek.setDate(prevWeek.getDate() - 7);
      const nextWeek = new Date(variables.weekStart);
      nextWeek.setDate(nextWeek.getDate() + 7);

      queryClient.invalidateQueries({
        queryKey: mealPlanQueryKeys.week(
          requireFamilyId(family),
          toLocalDateKey(prevWeek)
        ),
      });
      queryClient.invalidateQueries({
        queryKey: mealPlanQueryKeys.week(
          requireFamilyId(family),
          toLocalDateKey(nextWeek)
        ),
      });
    },
  });
}

// Reschedule entry to a different day/meal type
export function useRescheduleMealPlanEntry() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();
  // Dragging a meal into another week has to land in the week the household
  // actually sees, so the destination plan is keyed the same way the grid is.
  const { weekStartsOn } = useWeekStart();

  return useMutation({
    mutationFn: async ({
      entryId,
      newDate,
      newMealType,
      currentWeekStart,
    }: {
      entryId: string;
      newDate: string;
      newMealType?: MealType;
      currentWeekStart: string;
    }): Promise<MealPlanEntry> => {
       
      const supabaseAny = supabase as any;

      // Get the new week start for the target date
      const newWeekStart = getWeekStart(new Date(newDate), weekStartsOn);

      // Check if moving to a different week
      if (newWeekStart !== currentWeekStart) {
        // Race-safe get-or-create for the destination week — see useMealPlan above.
        const { data: newMealPlan, error: planError } = await supabaseAny
          .from("meal_plans")
          .upsert(
            {
              family_id: requireFamilyId(family),
              week_start: newWeekStart,
            },
            { onConflict: "family_id,week_start" },
          )
          .select("id")
          .single();

        if (planError) throw planError;

        // Update the entry with new meal_plan_id
        const updates: Record<string, unknown> = {
          meal_plan_id: newMealPlan.id,
          date: newDate,
        };
        if (newMealType) {
          updates.meal_type = newMealType;
        }

        const { data, error } = await supabaseAny
          .from("meal_plan_entries")
          .update(updates)
          .eq("id", entryId)
          .select()
          .single();

        if (error) throw error;
        return data as MealPlanEntry;
      }

      // Same week, just update date and optionally meal_type
      const updates: Record<string, unknown> = { date: newDate };
      if (newMealType) {
        updates.meal_type = newMealType;
      }

      const { data, error } = await supabaseAny
        .from("meal_plan_entries")
        .update(updates)
        .eq("id", entryId)
        .select()
        .single();

      if (error) throw error;
      return data as MealPlanEntry;
    },
    onSuccess: (_, variables) => {
      // Invalidate current week
      queryClient.invalidateQueries({
        queryKey: mealPlanQueryKeys.week(requireFamilyId(family), variables.currentWeekStart),
      });
      // Invalidate target week if different
      const newWeekStart = getWeekStart(new Date(variables.newDate), weekStartsOn);
      if (newWeekStart !== variables.currentWeekStart) {
        queryClient.invalidateQueries({
          queryKey: mealPlanQueryKeys.week(requireFamilyId(family), newWeekStart),
        });
      }
    },
  });
}

// Delete meal plan entry
export function useDeleteMealPlanEntry() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      entryId,
      weekStart,
    }: {
      entryId: string;
      weekStart: string;
    }): Promise<void> => {
       
      const { error } = await (supabase as any)
        .from("meal_plan_entries")
        .delete()
        .eq("id", entryId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: mealPlanQueryKeys.week(requireFamilyId(family), variables.weekStart),
      });
    },
  });
}

// Generate shopping list from meal plan
export function useGenerateShoppingFromMealPlan() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family, device } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      weekStart,
      selectedEntryIds,
    }: {
      weekStart: string;
      selectedEntryIds?: string[];
    }): Promise<number> => {
       
      const supabaseAny = supabase as any;

      /*
        Bounded by the week's dates, for the same reason `useMealPlan` is: the
        plan row's key follows the "week starts on" setting, so a week on screen
        need not be one plan row. Reading this by `meal_plan_id` would have
        shopped for part of a week — and silently, since a short list looks like
        a light week rather than a bug.
      */
      const weekDates = getWeekDates(weekStart);

      let query = supabaseAny
        .from("meal_plan_entries")
        .select(
          `
          id,
          servings,
          recipe:recipes(
            id,
            servings,
            ingredients:recipe_ingredients(*)
          ),
          meal_plan:meal_plans!inner(family_id)
        `
        )
        .eq("meal_plan.family_id", requireFamilyId(family))
        .gte("date", weekDates[0])
        .lte("date", weekDates[6])
        .not("recipe_id", "is", null);

      if (selectedEntryIds && selectedEntryIds.length > 0) {
        query = query.in("id", selectedEntryIds);
      }

      const { data: entries, error: entriesError } = await query;
      if (entriesError) throw entriesError;

      // Aggregate ingredients
      const ingredientMap = new Map<
        string,
        {
          name: string;
          quantity: number;
          unit: string | null;
          category: string | null;
          recipeIds: Set<string>;
        }
      >();

      for (const entry of entries || []) {
        if (!entry.recipe?.ingredients) continue;

        const recipeServings = entry.recipe.servings || 4;
        const targetServings = entry.servings || recipeServings;
        const multiplier = targetServings / recipeServings;

        for (const ing of entry.recipe.ingredients) {
          const key = `${ing.name.toLowerCase()}_${ing.unit || ""}`;
          const existing = ingredientMap.get(key);

          if (existing) {
            existing.quantity += (ing.quantity || 0) * multiplier;
            existing.recipeIds.add(entry.recipe.id);
          } else {
            ingredientMap.set(key, {
              name: ing.name,
              quantity: (ing.quantity || 0) * multiplier,
              unit: ing.unit,
              category: ing.category,
              recipeIds: new Set([entry.recipe.id]),
            });
          }
        }
      }

      if (ingredientMap.size === 0) {
        return 0;
      }

      // Batch match ingredients against catalog for images and categories
      let catalogMatches: Record<string, {
        id: string | null;
        name: string;
        category: string | null;
        image_url: string | null;
        thumbnail_url: string | null;
      } | null> = {};

      try {
        const ingredientNames = Array.from(ingredientMap.values()).map((ing) => ing.name);
        const matchResponse = await fetch("/api/catalog/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            family_id: requireFamilyId(family),
            items: ingredientNames,
          }),
        });

        if (matchResponse.ok) {
          const data = await matchResponse.json();
          catalogMatches = data.matches || {};
        }
      } catch (err) {
        console.log("Could not match catalog items:", err);
        // Continue without catalog matching
      }

      // Create shopping items with catalog data
      const shoppingItems = Array.from(ingredientMap.values()).map((ing) => {
        const catalogMatch = catalogMatches[ing.name.toLowerCase().trim()];
        return {
          family_id: requireFamilyId(family),
          name: ing.name,
          quantity: ing.quantity || null,
          unit: ing.unit,
          // Use catalog data if available, else fall back to recipe/default
          category: catalogMatch?.category || ing.category || "sonstiges",
          image_url: catalogMatch?.thumbnail_url || catalogMatch?.image_url || null,
          catalog_item_id: catalogMatch?.id || null,
          notes: `Für ${ing.recipeIds.size} Rezept${ing.recipeIds.size > 1 ? "e" : ""}`,
          source_device_id: device?.id || null,
        };
      });

      const { error: insertError } = await supabaseAny
        .from("shopping_items")
        .insert(shoppingItems);

      if (insertError) throw insertError;

      return shoppingItems.length;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["shopping_items", requireFamilyId(family)],
      });
    },
  });
}

// Postpone meal to tomorrow
export function usePostponeMeal() {
  const rescheduleMeal = useRescheduleMealPlanEntry();

  return useMutation({
    mutationFn: async ({
      entryId,
      currentDate,
      currentWeekStart,
      keepMealType,
    }: {
      entryId: string;
      currentDate: string;
      currentWeekStart: string;
      keepMealType?: boolean;
    }) => {
      const tomorrow = new Date(currentDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      // toISOString here produced *today* for anyone east of Greenwich,
      // so "move to tomorrow" silently left the meal where it was.
      const newDate = toLocalDateKey(tomorrow);

      return rescheduleMeal.mutateAsync({
        entryId,
        newDate,
        currentWeekStart,
      });
    },
  });
}
