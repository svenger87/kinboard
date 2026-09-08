import type { Timer } from "@/types/database";

export type TimerState = "running" | "finished" | "dismissed";

/** When the timer is due, in epoch ms. */
function endsAt(timer: Timer): number {
  return Date.parse(timer.started_at) + timer.duration_seconds * 1000;
}

/**
 * Seconds left, clamped to the timer's own bounds.
 *
 * Floored at zero because a tab asleep for an hour would otherwise report a
 * large negative number, and a ring drawn from a negative remainder sweeps the
 * wrong way. Capped at the duration because a clock that has gone backwards
 * must not appear to add time.
 */
export function remainingSeconds(timer: Timer, now: Date): number {
  const ms = endsAt(timer) - now.getTime();
  const seconds = Math.ceil(ms / 1000);
  return Math.max(0, Math.min(seconds, timer.duration_seconds));
}

/**
 * Dismissal wins over everything.
 *
 * Stopping a timer before it rings sets `dismissed_at`; without checking that
 * first, the same row would turn "finished" when its duration elapsed and
 * reappear on the panel as an alarm nobody set.
 *
 * `finished` is derived from the clock rather than from `finished_at`, so the
 * panel goes red the moment its own corrected time crosses zero instead of
 * waiting for the server to stamp the row.
 */
export function timerState(timer: Timer, now: Date): TimerState {
  if (timer.dismissed_at) return "dismissed";
  return now.getTime() >= endsAt(timer) ? "finished" : "running";
}
