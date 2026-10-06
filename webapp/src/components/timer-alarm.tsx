"use client";

import { useEffect, useRef } from "react";
import { useFamilyStore } from "@/stores/family-store";
import { useTimers } from "@/hooks/use-timers";
import { useServerClockOffset } from "@/hooks/use-server-clock";
import { applyOffset } from "@/lib/server-clock";
import { RING_EVERY_MS, alarmRinging } from "@/lib/timer-alarm";
import { playTone, unlockTone } from "@/lib/timer-tone";

/**
 * The timer alarm's sound on a wall display, on every page (RFC-004 §4.2).
 *
 * Mounted once for the whole app, not in the timer widget: the widget is only
 * on Home, and a timer runs out just as often while the kitchen panel shows a
 * recipe. Only a kiosk rings. A phone in a pocket should not beep from an
 * open tab; its channel is the push.
 *
 * The tone repeats every RING_EVERY_MS while a timer has run out and nobody
 * has dismissed it, for at most RING_FOR_MS (lib/timer-alarm.ts): one tone
 * for any number of timers, never a chord.
 *
 * Browsers only let a page start its audio from a touch, a click or a key
 * press, so every one of them anywhere on the page unlocks it. Listening only on the
 * timer's own buttons left the alarm silent whenever the timer came from a
 * phone or an assistant, or the panel had reloaded since its last preset.
 */
export function TimerAlarm() {
  const { device } = useFamilyStore();
  const isKiosk = device?.is_kiosk ?? false;
  const { data: timers = [] } = useTimers();
  const offsetMs = useServerClockOffset();

  // pointerdown for a mouse, pointerup for a finger: a touch only counts as
  // the user's gesture once it lifts, so a finger's first tap would be missed
  // on pointerdown alone. keydown for a keyboard.
  useEffect(() => {
    if (!isKiosk) return;
    const options = { capture: true, passive: true } as const;
    const events = ["pointerdown", "pointerup", "keydown"] as const;
    for (const event of events) document.addEventListener(event, unlockTone, options);
    return () => {
      for (const event of events) document.removeEventListener(event, unlockTone, options);
    };
  }, [isKiosk]);

  // The interval reads the latest list and offset through refs, so a refetch
  // does not restart it and push the next ring back.
  const latest = useRef({ timers, offsetMs });
  latest.current = { timers, offsetMs };
  const hasTimers = timers.length > 0;

  // Only while the family has a timer that is not dismissed, like the
  // widget's own clock: an idle panel runs no interval.
  useEffect(() => {
    if (!isKiosk || !hasTimers) return;
    let lastRing = 0;
    const tick = () => {
      const { timers: current, offsetMs: offset } = latest.current;
      if (!alarmRinging(current, applyOffset(new Date(), offset))) {
        lastRing = 0;
        return;
      }
      if (Date.now() - lastRing >= RING_EVERY_MS && playTone()) lastRing = Date.now();
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [isKiosk, hasTimers]);

  return null;
}
