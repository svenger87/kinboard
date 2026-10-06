import type { Timer } from "@/types/database";

export type TimerState = "running" | "paused" | "finished" | "dismissed";

/**
 * When the timer is due, in epoch ms: its length after it was started, plus
 * the time it has spent paused. For a paused timer this is the end it had
 * when it was paused; resuming moves it by the length of the pause.
 */
export function endsAt(timer: Timer): number {
  return Date.parse(timer.started_at) + (timer.duration_seconds + (timer.paused_seconds ?? 0)) * 1000;
}

/** Milliseconds since the timer ran out; negative while it is still counting. */
export function msPastEnd(timer: Timer, now: Date): number {
  return now.getTime() - endsAt(timer);
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
  // A paused timer's clock stopped when it was paused.
  const at = timer.paused_at ? Date.parse(timer.paused_at) : now.getTime();
  const ms = endsAt(timer) - at;
  const seconds = Math.ceil(ms / 1000);
  return Math.max(0, Math.min(seconds, timer.duration_seconds));
}

/**
 * Dismissal wins over everything, then a pause.
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
  // Paused before its end, so it can't have run out: it waits, on every screen.
  if (timer.paused_at) return "paused";
  return now.getTime() >= endsAt(timer) ? "finished" : "running";
}
