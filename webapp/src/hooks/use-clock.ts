"use client";

import { useState, useEffect, useRef } from "react";

interface ClockState {
  hours: string;
  minutes: string;
  seconds: string;
  date: Date;
}

/**
 * 12-hour hours, the way a clock face writes them: 1-12, unpadded, with
 * midnight and noon as 12 rather than 0. Padding here would render
 * "03:05 PM", which no 12-hour clock does.
 */
function hoursFor(now: Date, use24Hour: boolean): string {
  if (use24Hour) return now.getHours().toString().padStart(2, "0");
  return (now.getHours() % 12 || 12).toString();
}

/**
 * Hook for real-time clock updates
 * @param updateInterval - Update interval in milliseconds (default: 60000ms for minute updates)
 */
export function useClock(
  updateInterval: number = 60000,
  use24Hour: boolean = true,
): ClockState {
  const [time, setTime] = useState<ClockState>(() => {
    const now = new Date();
    return {
      hours: hoursFor(now, use24Hour),
      minutes: now.getMinutes().toString().padStart(2, "0"),
      seconds: now.getSeconds().toString().padStart(2, "0"),
      date: now,
    };
  });

  // Track previous values to avoid unnecessary re-renders
  const prevValues = useRef({ hours: "", minutes: "", seconds: "" });

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    const showSeconds = updateInterval < 60000;

    const tick = () => {
      const now = new Date();
      const hours = hoursFor(now, use24Hour);
      const minutes = now.getMinutes().toString().padStart(2, "0");
      const seconds = now.getSeconds().toString().padStart(2, "0");

      // Only update state if values actually changed
      const prev = prevValues.current;
      const hoursChanged = hours !== prev.hours;
      const minutesChanged = minutes !== prev.minutes;
      const secondsChanged = seconds !== prev.seconds;

      // If showing seconds, update on any change; otherwise only on hour/minute change
      const shouldUpdate = showSeconds
        ? hoursChanged || minutesChanged || secondsChanged
        : hoursChanged || minutesChanged;

      if (shouldUpdate) {
        prevValues.current = { hours, minutes, seconds };
        setTime({ hours, minutes, seconds, date: now });
      }
    };

    // Calculate time to next boundary for accurate sync
    const msToNextBoundary = showSeconds
      ? 1000 - (Date.now() % 1000)  // Sync to next second
      : 60000 - (Date.now() % 60000);  // Sync to next minute

    const initialTimeout = setTimeout(() => {
      tick();
      intervalId = setInterval(tick, updateInterval);
    }, msToNextBoundary);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [updateInterval, use24Hour]);

  return time;
}
