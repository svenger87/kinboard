import type { Timer } from "@/types/database";
import { msPastEnd, timerState } from "@/lib/timer-math";

/** How often a wall display repeats the tone while a timer rings. */
export const RING_EVERY_MS = 3_000;

/**
 * How long after a timer runs out the tone keeps repeating, unless somebody
 * dismisses it first. After that only the sound stops: the red "Time's up"
 * stays on the widget until it is dismissed, so a timer nobody is home for
 * doesn't beep for an hour, and a panel that reloads finds an old alarm
 * waiting for it in silence.
 */
export const RING_FOR_MS = 2 * 60_000;

/** Whether a wall display should be ringing: some timer ran out less than RING_FOR_MS ago and is not dismissed. */
export function alarmRinging(timers: readonly Timer[], now: Date): boolean {
  return timers.some((timer) => timerState(timer, now) === "finished" && msPastEnd(timer, now) < RING_FOR_MS);
}
