"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import type { Timer } from "@/types/database";
import { timerState } from "@/lib/timer-math";
import { applyOffset } from "@/lib/server-clock";
import { useServerClockOffset } from "./use-server-clock";

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
    /*
      A backstop for dropped realtime messages, not the primary update path —
      the realtime subscription is. This stack puts ~22 tables on one channel,
      and its own e2e coverage documents that channel shedding load under
      contention ("MessagePerSecondRateLimitReached"). Miss the message that a
      timer was dismissed and a kiosk — which fires no focus or visibility
      events to fall back on — shows an alarm nobody can silence from the
      table's own screen. 10s while the family actually has timers running or
      finished; 30s otherwise, so an idle board isn't polling for nothing.
    */
    refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 10_000 : 30_000),
  });
}

/**
 * True while any not-yet-dismissed timer has passed its end.
 *
 * Exists so `ScreensaverProvider` can hold the screensaver off during an
 * alarm — see the call site in providers.tsx. It needs its own clock: unlike
 * the widget, nothing else re-renders this hook's caller on a tick, so it
 * runs a 1-second interval of its own, active only while there is a timer
 * that has not yet ended (mirrors `hasRunning` in timer-widget.tsx), and
 * cleaned up once there isn't.
 */
export function useRingingTimer(): boolean {
  const { data: timers = [] } = useTimers();
  const [now, setNow] = useState(() => new Date());
  // The same clock the widget rings on. Reading the browser's own clock here
  // would let the two disagree by the panel's skew, and the alarm would spend
  // that long underneath the screensaver this is supposed to hold off.
  const serverNow = applyOffset(now, useServerClockOffset());

  const hasPending = timers.some((x) => timerState(x, serverNow) === "running");
  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [hasPending]);

  return timers.some((x) => timerState(x, serverNow) === "finished");
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
