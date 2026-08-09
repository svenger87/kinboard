"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Bring a wall display back to the dashboard after it has been left somewhere.
 *
 * The plan calls this "context switching with return logic", and the return
 * half is the part that makes the switching safe: a board that changes what it
 * shows is only tolerable if it also comes back on its own. Somebody looks up
 * a recipe, walks off, and the kitchen display sits on that recipe until the
 * next person notices — by which time the morning reminders it should have
 * been showing are hours stale.
 *
 * Only on kiosk devices. A phone is somebody's own screen and yanking it back
 * to a dashboard mid-read would be hostile; a wall panel belongs to the room.
 */

export interface ReturnToDashboardOptions {
  enabled: boolean;
  /** How long a page may sit untouched before the board goes home. */
  afterMs?: number;
}

/** Long enough to read a recipe through, short enough to be back before the next meal. */
const DEFAULT_RETURN_MS = 10 * 60 * 1000;

export function useReturnToDashboard({
  enabled,
  afterMs = DEFAULT_RETURN_MS,
}: ReturnToDashboardOptions): void {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Already home, or not a wall display: nothing to return from.
    if (!enabled || pathname === "/") return;

    const go = () => router.push("/");

    const arm = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(go, afterMs);
    };

    // Any touch restarts the clock, so the board never walks away from
    // somebody mid-sentence. Passive listeners: this must not cost scrolling
    // performance on a Raspberry Pi-class panel.
    const events: (keyof WindowEventMap)[] = [
      "pointerdown",
      "keydown",
      "touchstart",
      "wheel",
    ];
    for (const event of events) window.addEventListener(event, arm, { passive: true });
    arm();

    return () => {
      for (const event of events) window.removeEventListener(event, arm);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, pathname, afterMs, router]);
}
