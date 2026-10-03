"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import type { WrittenDay } from "@/lib/todo-turns";
import type { TodoEvent } from "@/types/database";

/** todo id -> day key -> the day as written down. */
export type TodoHistory = Map<string, Map<string, WrittenDay>>;

/**
 * The written-down days of every task between two day keys (#341): done and
 * missed days, and a day still open from before an edit, with whose turn
 * each was. Read-only; the database writes them.
 */
export function useTodoHistory(fromKey: string, toKey: string, options?: { enabled?: boolean }) {
  const familyId = useFamilyStore((state) => state.family?.id);
  return useQuery({
    queryKey: ["todo-history", familyId, fromKey, toKey],
    enabled: Boolean(familyId) && (options?.enabled ?? true) && fromKey <= toKey,
    queryFn: async (): Promise<TodoHistory> => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from("todo_occurrences")
        .select("todo_id,day,person_id,status")
        .eq("family_id", familyId)
        .gte("day", fromKey)
        .lte("day", toKey);
      if (error) throw error;
      const out: TodoHistory = new Map();
      for (const row of (data ?? []) as (WrittenDay & { todo_id: string })[]) {
        let days = out.get(row.todo_id);
        if (!days) out.set(row.todo_id, (days = new Map()));
        days.set(row.day, { day: row.day, person_id: row.person_id, status: row.status });
      }
      return out;
    },
  });
}

/** The task log, newest first, `limit` at a time (Settings → Task log). */
export function useTodoEvents(limit: number) {
  const familyId = useFamilyStore((state) => state.family?.id);
  return useQuery({
    queryKey: ["todo-events", familyId, limit],
    enabled: Boolean(familyId),
    queryFn: async (): Promise<TodoEvent[]> => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from("todo_events")
        .select("*")
        .eq("family_id", familyId)
        .order("at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as TodoEvent[];
    },
  });
}
