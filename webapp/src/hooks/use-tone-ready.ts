"use client";

import { useSyncExternalStore } from "react";
import { subscribeTone, toneReady } from "@/lib/timer-tone";

/** Whether this screen could sound the timer alarm now (lib/timer-tone.ts). */
export function useToneReady(): boolean {
  return useSyncExternalStore(subscribeTone, toneReady, () => false);
}
