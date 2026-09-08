import type { MediaPlayerState } from "@/plugins/media/types";

/**
 * Where the playhead is now, extrapolated from the last reading.
 *
 * Only `playing` advances — a paused player's position is whatever it was when
 * it paused, and advancing it would make a stopped track appear to run.
 */
export function interpolatedPosition(
  state: MediaPlayerState,
  now: Date,
): number | undefined {
  if (state.position === undefined) return undefined;
  if (state.status !== "playing" || !state.positionUpdatedAt) return state.position;

  const since = (now.getTime() - new Date(state.positionUpdatedAt).getTime()) / 1000;
  // A clock that has gone backwards must not produce a negative position.
  const elapsed = Number.isFinite(since) && since > 0 ? since : 0;

  const advanced = state.position + elapsed;
  return state.duration !== undefined ? Math.min(advanced, state.duration) : advanced;
}
