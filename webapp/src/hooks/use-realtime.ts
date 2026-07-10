"use client";

import { useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { useRealtimeStatusStore } from "@/stores/realtime-status-store";
import { queryKeys } from "./use-supabase-queries";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

type TableName =
  | "people"
  | "events"
  | "todos"
  | "shopping_items"
  | "subjects"
  | "schedules"
  | "birthdays"
  | "notes"
  | "settings"
  | "recipes"
  | "recipe_ingredients"
  | "recipe_tags"
  | "meal_plans"
  | "meal_plan_entries"
  | "item_catalog"
  | "push_subscriptions"
  | "notification_preferences"
  | "birthday_gift_ideas";

const ALL_TABLES: TableName[] = [
  "people",
  "events",
  "todos",
  "shopping_items",
  "subjects",
  "schedules",
  "birthdays",
  "notes",
  "settings",
  "recipes",
  "recipe_ingredients",
  "recipe_tags",
  "meal_plans",
  "meal_plan_entries",
  "item_catalog",
  "push_subscriptions",
  "notification_preferences",
  "birthday_gift_ideas",
];

interface UseRealtimeOptions {
  tables?: TableName[];
  enabled?: boolean;
}

/**
 * Hook to subscribe to Supabase Realtime changes and automatically invalidate queries
 *
 * @param options - Configuration options
 * @param options.tables - Specific tables to subscribe to (defaults to all)
 * @param options.enabled - Whether to enable subscriptions (defaults to true)
 */
export function useRealtime(options: UseRealtimeOptions = {}) {
  const { tables = ALL_TABLES, enabled = true } = options;

  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();
  const setStatus = useRealtimeStatusStore((s) => s.setStatus);

  const handleChange = useCallback(
    (
      table: TableName,
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) => {
      // Realtime change received - invalidate query
      if (!family?.id) return;

      // Invalidate the appropriate query based on the table
      switch (table) {
        case "people":
          queryClient.invalidateQueries({
            queryKey: queryKeys.people(family.id),
          });
          break;
        case "events":
          queryClient.invalidateQueries({
            queryKey: ["events", family.id],
          });
          break;
        case "todos":
          queryClient.invalidateQueries({
            queryKey: queryKeys.todos(family.id),
          });
          break;
        case "shopping_items":
          queryClient.invalidateQueries({
            queryKey: queryKeys.shoppingItems(family.id),
          });
          break;
        case "subjects":
          queryClient.invalidateQueries({
            queryKey: queryKeys.subjects(family.id),
          });
          break;
        case "schedules":
          queryClient.invalidateQueries({
            queryKey: queryKeys.schedules(family.id),
          });
          break;
        case "birthdays":
          queryClient.invalidateQueries({
            queryKey: queryKeys.birthdays(family.id),
          });
          break;
        case "notes":
          queryClient.invalidateQueries({
            queryKey: queryKeys.notes(family.id),
          });
          break;
        case "settings":
          // Invalidate all settings queries
          queryClient.invalidateQueries({
            queryKey: ["settings", family.id],
          });
          break;
        case "recipes":
          queryClient.invalidateQueries({
            queryKey: ["recipes", family.id],
          });
          break;
        case "recipe_ingredients":
          // Invalidate all recipes as ingredients changed
          queryClient.invalidateQueries({
            queryKey: ["recipes", family.id],
          });
          break;
        case "recipe_tags":
          queryClient.invalidateQueries({
            queryKey: ["recipe-tags", family.id],
          });
          queryClient.invalidateQueries({
            queryKey: ["recipes", family.id],
          });
          break;
        case "meal_plans":
        case "meal_plan_entries":
          queryClient.invalidateQueries({
            queryKey: ["meal-plans", family.id],
          });
          break;
        case "item_catalog":
          queryClient.invalidateQueries({
            queryKey: ["item-catalog", family.id],
          });
          break;
        case "push_subscriptions":
          queryClient.invalidateQueries({
            queryKey: ["push-subscriptions", family.id],
          });
          break;
        case "notification_preferences":
          queryClient.invalidateQueries({
            queryKey: ["notification-preferences", family.id],
          });
          break;
        case "birthday_gift_ideas": {
          const birthdayId = (payload.new as Record<string, unknown>)?.birthday_id as string | undefined
            ?? (payload.old as Record<string, unknown>)?.birthday_id as string | undefined;
          if (birthdayId) {
            queryClient.invalidateQueries({
              queryKey: queryKeys.giftIdeas(birthdayId),
            });
          }
          break;
        }
      }
    },
    [queryClient, family]
  );

  useEffect(() => {
    if (!enabled || !family?.id) return;

    let disposed = false;

    // Create a channel for all subscriptions
    const channel = supabase.channel(`family-${family.id}`);

    // Subscribe to each table
    tables.forEach((table) => {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          // Note: RLS will filter to only family's data
        },
        (payload) => handleChange(table, payload)
      );
    });

    // Subscribe to the channel. supabase-js retries CHANNEL_ERROR/TIMED_OUT
    // internally (rejoin timer), so the status flips back to SUBSCRIBED on
    // recovery without any action on our side.
    channel.subscribe((status) => {
      if (disposed) return;

      if (status === "SUBSCRIBED") {
        setStatus("connected");
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        setStatus("disconnected");
      }
    });

    // Cleanup on unmount. supabase.removeChannel() fires this same
    // subscribe callback with status "CLOSED" — flip `disposed` first so
    // that self-inflicted close doesn't overwrite the store with
    // "disconnected" (a genuinely unexpected pre-cleanup CLOSED is still
    // handled above, before this runs).
    return () => {
      disposed = true;
      supabase.removeChannel(channel);
    };
  }, [supabase, family?.id, enabled, tables, handleChange, setStatus]);
}

/**
 * Hook to subscribe to a specific table's changes
 *
 * @param table - The table to subscribe to
 * @param enabled - Whether to enable the subscription
 */
export function useRealtimeTable(table: TableName, enabled = true) {
  return useRealtime({ tables: [table], enabled });
}

/**
 * Provider component to enable realtime subscriptions at the app level
 */
export function useRealtimeSync() {
  const { family } = useFamilyStore();
  useRealtime({ enabled: !!family?.id });
}
