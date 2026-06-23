"use client";

import { useState, useEffect } from "react";
import { startOfDay, addDays } from "date-fns";

/**
 * Returns the start-of-day timestamp (ms) for the local "today" and re-renders
 * the consumer when the calendar day changes — at the next local midnight, and
 * on tab/device wake (`visibilitychange`/`focus`), since a sleeping kiosk or
 * phone won't reliably fire a midnight timer.
 *
 * Use the returned value in the dependency list of any date-relative
 * computation (`daysUntil`, `isToday`, `isPast`, badge counts) so those values
 * recompute when the day rolls over instead of going stale until a manual
 * reload. The value only changes across midnight, so it won't cause churn.
 */
export function useToday(): number {
  const [day, setDay] = useState(() => startOfDay(new Date()).getTime());

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const sync = () => {
      const d = startOfDay(new Date()).getTime();
      setDay((prev) => (prev !== d ? d : prev));
    };

    const schedule = () => {
      const now = new Date();
      // True next local midnight (DST-safe via date-fns, not now + 24h).
      const next = startOfDay(addDays(now, 1)).getTime();
      const ms = Math.max(1000, next - now.getTime());
      timeoutId = setTimeout(() => {
        sync();
        schedule();
      }, ms);
    };

    schedule();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  return day;
}
