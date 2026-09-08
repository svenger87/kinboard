"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import type { Timer } from "@/types/database";

const KEY = "timers";

/**
 * Take the row out of the cache ourselves rather than trusting a refetch to
 * come back with a list that no longer has it.
 *
 * `invalidateQueries` is deduped against whatever fetch is already in flight,
 * and on a family board something usually is: another screen starts or stops a
 * timer, the realtime change that follows starts a refetch, and an
 * invalidation raised while that runs is answered with the older request's
 * result. The list then sits there stale until something else happens to the
 * table — a timer you stopped, still counting on the wall. Two boards open at
 * once is all it takes; measured with exactly that.
 */
function forget(qc: QueryClient, familyId: string | undefined, id: string) {
  qc.setQueryData<Timer[]>([KEY, familyId], (old) => old?.filter((x) => x.id !== id));
  void qc.invalidateQueries({ queryKey: [KEY, familyId] });
}

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
    onSuccess: (_data, id) => forget(qc, family?.id, id),
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
    onSuccess: (_data, id) => forget(qc, family?.id, id),
  });
}
