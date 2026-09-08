"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import type { Timer } from "@/types/database";

const KEY = "timers";

export function useTimers() {
  const { family } = useFamilyStore();
  return useQuery({
    queryKey: [KEY, family?.id],
    enabled: Boolean(family?.id),
    queryFn: async (): Promise<Timer[]> => {
      const r = await fetch(`/api/timers?family_id=${family!.id}`);
      if (!r.ok) throw new Error(`timers: ${r.status}`);
      return ((await r.json()) as { timers: Timer[] }).timers;
    },
  });
}

export function useStartTimer() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (input: { label?: string; duration_seconds: number }): Promise<Timer> => {
      const r = await fetch("/api/timers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, family_id: family!.id }),
      });
      if (!r.ok) throw new Error(`start timer: ${r.status}`);
      return ((await r.json()) as { timer: Timer }).timer;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, family?.id] }),
  });
}

export function useDismissTimer() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await fetch(`/api/timers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family!.id }),
      });
      if (!r.ok) throw new Error(`dismiss timer: ${r.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, family?.id] }),
  });
}

export function useDeleteTimer() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await fetch(`/api/timers/${id}?family_id=${family!.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`delete timer: ${r.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, family?.id] }),
  });
}
