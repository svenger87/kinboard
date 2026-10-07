"use client";

import { useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { useRealtimeStatusStore } from "@/stores/realtime-status-store";
import { queryKeys } from "./use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { actionChangeMatters } from "@/lib/home/action-prompt";
import { reactToTaskChange } from "@/stores/creature-reactions";
import type { TickRow } from "@/lib/pocket-money/creature-reactions";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

/**
 * How often to re-authenticate the realtime socket.
 *
 * Family tokens live an hour (FAMILY_TOKEN_TTL_SECONDS). Refreshing every 20
 * minutes means a missed tick or two still lands well inside the window,
 * which matters on a kiosk that may sleep and wake.
 */
const REALTIME_REAUTH_INTERVAL_MS = 20 * 60 * 1000;

type TableName =
  | "people"
  | "events"
  | "calendars"
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
  | "birthday_gift_ideas"
  | "timers"
  | "camera_takeovers"
  | "messages"
  | "catalogue_items"
  | "rooms"
  | "assistant_action_requests"
  | "todo_occurrences"
  | "point_rewards"
  | "point_redemptions"
  | "point_purchases"
  | "creatures";

const ALL_TABLES: TableName[] = [
  "people",
  "events",
  "calendars",
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
  "timers",
  "camera_takeovers",
  "messages",
  "catalogue_items",
  "rooms",
  "assistant_action_requests",
  "todo_occurrences",
  "point_rewards",
  "point_redemptions",
  "point_purchases",
  "creatures",
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
        case "calendars":
          // A calendar switched off (an unticked Google calendar) leaves the
          // calendar list, and the events query embeds each calendar's
          // colour and holiday/waste flags, so both are refetched.
          queryClient.invalidateQueries({
            queryKey: ["calendars", family.id],
          });
          queryClient.invalidateQueries({
            queryKey: ["events", family.id],
          });
          break;
        case "todos": {
          // A child's task ticked off on another screen: their creature
          // cheers here. Compared with the row as this screen's cache had it,
          // so this must run before the invalidation below refetches it.
          if (payload.eventType === "UPDATE") {
            const next = payload.new as unknown as TickRow;
            const prev = queryClient
              .getQueryData<TickRow[]>(queryKeys.todos(family.id))
              ?.find((todo) => todo.id === next.id);
            reactToTaskChange(queryClient, family.id, prev, next);
          }
          queryClient.invalidateQueries({
            queryKey: queryKeys.todos(family.id),
          });
          queryClient.invalidateQueries({
            queryKey: ["todo-point-awards", family.id],
          });
          queryClient.invalidateQueries({ queryKey: ["todo-history", family.id] });
          queryClient.invalidateQueries({ queryKey: ["todo-events", family.id] });
          break;
        }
        case "todo_occurrences":
          // Days written down by the quarter-hourly pass, which touches no
          // task row when it only marks a day missed.
          queryClient.invalidateQueries({ queryKey: ["todo-history", family.id] });
          break;
        case "point_rewards":
          queryClient.invalidateQueries({ queryKey: ["point-rewards", family.id] });
          break;
        case "point_redemptions":
          // A child's request, or a parent's decision on another screen.
          queryClient.invalidateQueries({ queryKey: ["point-redemptions", family.id] });
          break;
        case "point_purchases":
          // Something bought in the shop on another screen (RFC-017 §5): the
          // balance and what the creature may wear both change.
          queryClient.invalidateQueries({ queryKey: ["point-purchases", family.id] });
          break;
        case "creatures":
          // A creature switched on or off, re-dressed, or its stage recorded
          // on another screen (RFC-017).
          queryClient.invalidateQueries({ queryKey: ["creatures", family.id] });
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
        case "settings": {
          // Invalidate all settings queries
          queryClient.invalidateQueries({
            queryKey: ["settings", family.id],
          });
          // school_holidays is not in the publication. The rows a sync writes
          // come with an update to the school_holiday_sync setting in the same
          // transaction, and a new region with its holiday_region row: either
          // one refetches the rows, so open screens follow a sync or a region
          // change. A delete carries no key, so it refetches too.
          const key = ((payload.new as Record<string, unknown>)?.key ?? null) as string | null;
          if (key === null || key === SETTINGS_KEYS.schoolHolidaySync || key === SETTINGS_KEYS.holidayRegion) {
            queryClient.invalidateQueries({
              queryKey: queryKeys.schoolHolidays(family.id),
            });
          }
          break;
        }
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
        case "timers":
          queryClient.invalidateQueries({
            queryKey: ["timers", family.id],
          });
          break;
        case "camera_takeovers":
          queryClient.invalidateQueries({
            queryKey: ["camera-takeover", family.id],
          });
          break;
        case "messages":
          queryClient.invalidateQueries({
            queryKey: ["messages", family.id],
          });
          break;
        case "catalogue_items":
          queryClient.invalidateQueries({
            queryKey: ["catalogue", family.id],
          });
          break;
        case "rooms":
          queryClient.invalidateQueries({
            queryKey: ["rooms", family.id],
          });
          break;
        case "assistant_action_requests":
          // Pending requests and any one a deep link is showing — but not
          // for the audit row every non-sensitive assistant action inserts.
          if (!actionChangeMatters(payload)) break;
          queryClient.invalidateQueries({
            queryKey: ["assistant-actions", family.id],
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

    /**
     * Hand the socket a fresh token before the old one expires.
     *
     * Family tokens last an hour. The HTTP path re-mints transparently on
     * every request, but a WebSocket is opened once and then simply held —
     * exactly the situation a wall display is in, where nothing reloads the
     * page for days. Without this the socket's JWT ages out and the server
     * stops honouring the subscription while the connection still looks
     * healthy: the same silent failure this fix exists to end.
     *
     * setAuth() re-reads the `accessToken` option in client.ts, so the
     * refresh logic stays in exactly one place.
     */
    const reauthTimer = setInterval(() => {
      void supabase.realtime.setAuth();
    }, REALTIME_REAUTH_INTERVAL_MS);

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
      clearInterval(reauthTimer);
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
