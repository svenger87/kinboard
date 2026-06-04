"use client";

import { useEffect, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
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
  | "notification_preferences";

// Module-level constant so the default array keeps a stable identity across
// renders — otherwise the realtime effect (which lists `tables` in its deps)
// tears down and rebuilds the channel on every render, dropping events.
const DEFAULT_TABLES: TableName[] = [
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
  const { tables = DEFAULT_TABLES, enabled = true } = options;

  // Memoize the client for the lifetime of the hook. createClient() returns a
  // fresh instance each call; an unstable `supabase` in the effect deps would
  // otherwise re-subscribe on every render.
  const [supabase] = useState(() => createClient());
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

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
      }
    },
    [queryClient, family]
  );

  useEffect(() => {
    if (!enabled || !family?.id) return;

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

    // Subscribe to the channel
    channel.subscribe();

    // Cleanup on unmount
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, family?.id, enabled, tables, handleChange]);
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
