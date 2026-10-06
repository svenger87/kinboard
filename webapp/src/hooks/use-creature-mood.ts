"use client";

import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSetting, useTodos } from "@/hooks/use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { isValidTimeZone } from "@/lib/integration-event-input";
import { creatureMood, type CreatureMood } from "@/lib/creature-mood";
import { currentMinute, MINUTE_MS, subscribeMinuteClock } from "@/lib/minute-clock";

/**
 * The family's time zone in the browser, falling back as lib/family-time.ts
 * does on the server: the family's `timezone` setting, else the server's own
 * (/api/time-zone, asked only when the family has none), else -- while that
 * loads -- this device's.
 */
export function useFamilyTimeZone(): string | undefined {
  const { data: saved, isSuccess } = useSetting<unknown>(SETTINGS_KEYS.timezone, null);
  const family = isValidTimeZone(saved) ? saved : null;
  const { data: server } = useQuery({
    queryKey: ["server-time-zone"],
    queryFn: async () => {
      const res = await fetch("/api/time-zone");
      if (!res.ok) throw new Error("Failed to load the server's time zone");
      return ((await res.json()) as { server: string }).server;
    },
    staleTime: Infinity,
    enabled: isSuccess && family === null,
  });
  return family ?? (isValidTimeZone(server) ? server : undefined);
}

// On the server, and while hydrating, no time at all: the mood is "normal"
// until the browser knows its clock, so the two never disagree.
const serverMinute = () => 0;

/** The current minute (ms since the epoch / 60 000), shared; 0 on the server. */
export function useMinuteClock(): number {
  return useSyncExternalStore(subscribeMinuteClock, currentMinute, serverMinute);
}

/**
 * A child's creature's mood right now (lib/creature-mood.ts): from the
 * family's tasks -- the same todos query every task screen shares, so a tick
 * anywhere turns the creature happy as soon as the list updates -- and the
 * family's clock, re-read each minute.
 */
export function useCreatureMood(personId: string | null | undefined): CreatureMood {
  const minute = useMinuteClock();
  const timeZone = useFamilyTimeZone();
  const { data: tasks } = useTodos({ enabled: Boolean(personId) });
  if (!personId || minute === 0) return "normal";
  return creatureMood({ personId, tasks: tasks ?? [], now: new Date(minute * MINUTE_MS), timeZone });
}
