"use client";

import { useEffect, useState } from "react";
import { resolveDayContext } from "@/lib/attention/engine";
import type { DayContext } from "@/lib/attention/types";

/**
 * Which part of the day it is, for the browser.
 *
 * Deliberately the *same function* the Heute-Motor uses, not a second
 * implementation of the same ranges. If the board decided it was evening and
 * the screen decided it was afternoon, a family would see evening reminders on
 * an afternoon layout and there would be nothing on either side to blame.
 *
 * `resolveDayContext` is a pure function of an instant and a timezone with no
 * server-only dependency, which is what lets it be shared rather than copied.
 */

/** Re-checked each minute: the boundaries are on the minute, and nothing finer matters. */
const TICK_MS = 60_000;

export function useDayContext(timeZone?: string): DayContext {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Resolved once on mount rather than during render, because the server and
  // the browser can disagree about the time and a mismatch would hydrate
  // wrong. "quiet" is the safe first answer — it emphasises nothing.
  const [context, setContext] = useState<DayContext>("quiet");

  useEffect(() => {
    const update = () => setContext(resolveDayContext(new Date(), zone));
    update();
    const timer = setInterval(update, TICK_MS);
    return () => clearInterval(timer);
  }, [zone]);

  return context;
}
