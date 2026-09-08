"use client";

import { useEffect, useState } from "react";
import { offsetFromDateHeader } from "@/lib/server-clock";

/**
 * How far this browser's clock is from the server's, in milliseconds.
 *
 * `started_at` comes from the server and the countdown from the browser, so a
 * panel two minutes fast would end its timers two minutes early. Every
 * response carries a Date header, so measuring costs a HEAD request rather
 * than an endpoint.
 *
 * Measured once per page load and shared, because two callers disagreeing
 * about the time is worse than both being slightly wrong. That is not
 * hypothetical: the timer widget corrected for skew and the screensaver did
 * not, so on a skewed panel the alarm could render underneath the screensaver
 * it was meant to hold off — the exact bug the correction exists to prevent.
 */
let measured: Promise<number> | null = null;

function serverOffset(): Promise<number> {
  // `offsetFromDateHeader` distinguishes "could not measure" (null) from
  // "measured, and the clocks agree" (0). Callers of this hook cannot act on
  // the difference — both mean "use the browser's clock" — so it collapses
  // here, deliberately, and only here.
  measured ??= fetch("/api/health", { method: "HEAD" })
    .then((res) => offsetFromDateHeader(res.headers.get("date"), new Date()) ?? 0)
    .catch(() => 0);
  return measured;
}

export function useServerClockOffset(): number {
  const [offsetMs, setOffsetMs] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void serverOffset().then((ms) => {
      if (!cancelled) setOffsetMs(ms);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return offsetMs;
}
