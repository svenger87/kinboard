"use client";

import { useEffect, useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { useRealtimeStatusStore } from "@/stores/realtime-status-store";
import { queryKeys } from "./use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { actionChangeMatters } from "@/lib/home/action-prompt";
import { reactToTaskChange } from "@/stores/creature-reactions";
import type { TickRow } from "@/lib/pocket-money/creature-reactions";
import { invalidatePocketMoney } from "./use-pocket-money-accounts";
import { invalidationBatch } from "@/lib/realtime/invalidation-batch";

/**
 * Live updates: the family's row changes, from the server's change feed.
 *
 * `GET /api/realtime` is a Server-Sent Events stream (app/api/realtime/route.ts)
 * fed by a Postgres NOTIFY on every change to the tables below
 * (docker/migrations/084_change_feed.sql). It replaced Supabase Realtime's
 * WebSocket. The session cookie authenticates it and decides the family, so
 * there is no token to hand over or refresh here.
 *
 * Each change arrives in the shape the handler always read — `eventType`,
 * `new`, `old` — with `new`/`old` cut down to `id` and the fields a handler
 * reads (TickRow for todos, `key` for settings, `birthday_id` for gift ideas,
 * `status` for assistant requests). Anything else a screen needs it refetches.
 */

/** A change as the stream sends it; `new`/`old` are `{}` where there is no row. */
export interface ChangePayload {
  table?: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

/** Reconnect delays after the stream is refused (a 401, a 502 while the server restarts). */
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

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
  | "todo_point_awards"
  | "creatures"
  | "pocket_money_accounts"
  | "pocket_money_transactions"
  | "pocket_money_goals"
  | "pocket_money_withdrawal_requests";

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
  "todo_point_awards",
  "creatures",
  "pocket_money_accounts",
  "pocket_money_transactions",
  "pocket_money_goals",
  "pocket_money_withdrawal_requests",
];

interface UseRealtimeOptions {
  tables?: TableName[];
  enabled?: boolean;
}

/**
 * Hook to follow the family's row changes and invalidate the affected queries
 *
 * @param options - Configuration options
 * @param options.tables - Specific tables to subscribe to (defaults to all)
 * @param options.enabled - Whether to enable subscriptions (defaults to true)
 */
export function useRealtime(options: UseRealtimeOptions = {}) {
  const { tables = ALL_TABLES, enabled = true } = options;

  const queryClient = useQueryClient();
  const { family } = useFamilyStore();
  const setStatus = useRealtimeStatusStore((s) => s.setStatus);

  // One refetch per list per burst, not one per changed row (see
  // lib/realtime/invalidation-batch.ts: a 362-row sync used to fire 1,494).
  const batch = useMemo(() => invalidationBatch(queryClient), [queryClient]);
  useEffect(() => () => batch.dispose(), [batch]);

  const handleChange = useCallback(
    (
      table: TableName,
      payload: ChangePayload
    ) => {
      // Realtime change received - invalidate query
      if (!family?.id) return;

      // Invalidate the appropriate query based on the table
      switch (table) {
        case "people":
          batch.invalidateQueries({
            queryKey: queryKeys.people(family.id),
          });
          break;
        case "events":
          batch.invalidateQueries({
            queryKey: ["events", family.id],
          });
          break;
        case "calendars":
          // A calendar switched off (an unticked Google calendar) leaves the
          // calendar list, and the events query embeds each calendar's
          // colour and holiday/waste flags, so both are refetched.
          batch.invalidateQueries({
            queryKey: ["calendars", family.id],
          });
          batch.invalidateQueries({
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
          batch.invalidateQueries({
            queryKey: queryKeys.todos(family.id),
          });
          batch.invalidateQueries({
            queryKey: ["todo-point-awards", family.id],
          });
          batch.invalidateQueries({ queryKey: ["todo-history", family.id] });
          batch.invalidateQueries({ queryKey: ["todo-events", family.id] });
          break;
        }
        case "todo_occurrences":
          // Days written down by the quarter-hourly pass, which touches no
          // task row when it only marks a day missed.
          batch.invalidateQueries({ queryKey: ["todo-history", family.id] });
          break;
        case "point_rewards":
          batch.invalidateQueries({ queryKey: ["point-rewards", family.id] });
          break;
        case "point_redemptions":
          // A child's request, or a parent's decision on another screen.
          batch.invalidateQueries({ queryKey: ["point-redemptions", family.id] });
          break;
        case "point_purchases":
          // Something bought in the shop on another screen (RFC-017 §5): the
          // balance and what the creature may wear both change.
          batch.invalidateQueries({ queryKey: ["point-purchases", family.id] });
          break;
        case "todo_point_awards":
          // A task's points, or a parent's adjustment by hand (#349), which
          // touches no task row: every total and the adjustments list move.
          batch.invalidateQueries({ queryKey: ["todo-point-awards", family.id] });
          batch.invalidateQueries({ queryKey: ["point-adjustments", family.id] });
          break;
        case "creatures":
          // A creature switched on or off, re-dressed, or its stage recorded
          // on another screen (RFC-017).
          batch.invalidateQueries({ queryKey: ["creatures", family.id] });
          break;
        case "pocket_money_accounts":
        case "pocket_money_transactions":
        case "pocket_money_goals":
        case "pocket_money_withdrawal_requests":
          // Every pocket-money write is the server's (#361), so the screen
          // that asked is often not the one that wrote: an assistant's
          // booking a parent allowed on the wall, the allowance run, a spend
          // request decided elsewhere. A booking moves the balance, the
          // ledger and a goal's progress at once, so all four are refetched.
          invalidatePocketMoney(batch);
          break;
        case "shopping_items":
          batch.invalidateQueries({
            queryKey: queryKeys.shoppingItems(family.id),
          });
          break;
        case "subjects":
          batch.invalidateQueries({
            queryKey: queryKeys.subjects(family.id),
          });
          break;
        case "schedules":
          batch.invalidateQueries({
            queryKey: queryKeys.schedules(family.id),
          });
          break;
        case "birthdays":
          batch.invalidateQueries({
            queryKey: queryKeys.birthdays(family.id),
          });
          break;
        case "notes":
          batch.invalidateQueries({
            queryKey: queryKeys.notes(family.id),
          });
          break;
        case "settings": {
          // Invalidate all settings queries
          batch.invalidateQueries({
            queryKey: ["settings", family.id],
          });
          // school_holidays has no change feed. The rows a sync writes
          // come with an update to the school_holiday_sync setting in the same
          // transaction, and a new region with its holiday_region row: either
          // one refetches the rows, so open screens follow a sync or a region
          // change. A delete carries no key, so it refetches too.
          const key = ((payload.new as Record<string, unknown>)?.key ?? null) as string | null;
          if (key === null || key === SETTINGS_KEYS.schoolHolidaySync || key === SETTINGS_KEYS.holidayRegion) {
            batch.invalidateQueries({
              queryKey: queryKeys.schoolHolidays(family.id),
            });
          }
          break;
        }
        case "recipes":
          batch.invalidateQueries({
            queryKey: ["recipes", family.id],
          });
          break;
        case "recipe_ingredients":
          // Invalidate all recipes as ingredients changed
          batch.invalidateQueries({
            queryKey: ["recipes", family.id],
          });
          break;
        case "recipe_tags":
          batch.invalidateQueries({
            queryKey: ["recipe-tags", family.id],
          });
          batch.invalidateQueries({
            queryKey: ["recipes", family.id],
          });
          break;
        case "meal_plans":
        case "meal_plan_entries":
          batch.invalidateQueries({
            queryKey: ["meal-plans", family.id],
          });
          break;
        case "item_catalog":
          batch.invalidateQueries({
            queryKey: ["item-catalog", family.id],
          });
          break;
        case "push_subscriptions":
          batch.invalidateQueries({
            queryKey: ["push-subscriptions", family.id],
          });
          break;
        case "notification_preferences":
          batch.invalidateQueries({
            queryKey: ["notification-preferences", family.id],
          });
          break;
        case "timers":
          batch.invalidateQueries({
            queryKey: ["timers", family.id],
          });
          break;
        case "camera_takeovers":
          batch.invalidateQueries({
            queryKey: ["camera-takeover", family.id],
          });
          break;
        case "messages":
          batch.invalidateQueries({
            queryKey: ["messages", family.id],
          });
          break;
        case "catalogue_items":
          batch.invalidateQueries({
            queryKey: ["catalogue", family.id],
          });
          break;
        case "rooms":
          batch.invalidateQueries({
            queryKey: ["rooms", family.id],
          });
          break;
        case "assistant_action_requests":
          // Pending requests and any one a deep link is showing — but not
          // for the audit row every non-sensitive assistant action inserts.
          if (!actionChangeMatters(payload)) break;
          batch.invalidateQueries({
            queryKey: ["assistant-actions", family.id],
          });
          break;
        case "birthday_gift_ideas": {
          const birthdayId = (payload.new as Record<string, unknown>)?.birthday_id as string | undefined
            ?? (payload.old as Record<string, unknown>)?.birthday_id as string | undefined;
          if (birthdayId) {
            batch.invalidateQueries({
              queryKey: queryKeys.giftIdeas(birthdayId),
            });
          }
          break;
        }
      }
    },
    [queryClient, batch, family]
  );

  /**
   * Refetch everything this family's screens show. After a gap — the stream
   * reconnected, or the server's database connection came back — changes may
   * have been missed, and there is no replay.
   */
  const resync = useCallback(() => {
    if (!family?.id) return;
    const familyId = family.id;
    batch.invalidateQueries({
      predicate: (query) => query.queryKey.includes(familyId),
    });
    // Keyed without the family id.
    batch.invalidateQueries({ queryKey: ["giftIdeas"] });
    invalidatePocketMoney(batch);
  }, [batch, family?.id]);

  // The stream is opened once per family, not again whenever the family
  // object or a callback changes identity: the handlers are read through refs.
  const handleChangeRef = useRef(handleChange);
  const resyncRef = useRef(resync);
  useEffect(() => {
    handleChangeRef.current = handleChange;
    resyncRef.current = resync;
  }, [handleChange, resync]);

  const tablesKey = tables.join(",");

  useEffect(() => {
    if (!enabled || !family?.id || typeof EventSource === "undefined") return;

    const wanted = new Set(tablesKey.split(","));
    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let openedBefore = false;

    const connect = () => {
      if (disposed) return;
      const es = new EventSource("/api/realtime");
      source = es;

      es.onopen = () => {
        if (disposed) return;
        failures = 0;
        setStatus("connected");
        // Every open after the first follows a gap.
        if (openedBefore) resyncRef.current();
        openedBefore = true;
      };

      es.addEventListener("change", (event) => {
        if (disposed) return;
        let payload: ChangePayload;
        try {
          payload = JSON.parse((event as MessageEvent<string>).data) as ChangePayload;
        } catch {
          return;
        }
        if (!payload.table || !wanted.has(payload.table)) return;
        handleChangeRef.current(payload.table as TableName, payload);
      });

      // The server's database connection is back after a loss.
      es.addEventListener("resync", () => {
        if (disposed) return;
        setStatus("connected");
        resyncRef.current();
      });

      // The server has lost its database connection: the stream is open, but
      // nothing will arrive until the next resync.
      es.addEventListener("down", () => {
        if (!disposed) setStatus("disconnected");
      });

      es.onerror = () => {
        if (disposed) return;
        setStatus("disconnected");
        // A dropped connection is retried by the browser itself (readyState
        // CONNECTING). A refused one — not a 200 event stream, such as a 401
        // or a proxy's 502 while the server restarts — is not: that
        // EventSource is CLOSED for good, so open a new one after a wait.
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** failures);
          failures++;
          retryTimer = setTimeout(connect, delay);
        }
      };
    };

    connect();

    // `disposed` first, so an event already queued cannot touch the store.
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [family?.id, enabled, tablesKey, setStatus]);
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
