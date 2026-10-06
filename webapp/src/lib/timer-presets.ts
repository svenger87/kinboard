/**
 * The timer widget's one-tap presets (RFC-004 §5.1), which a family can change
 * under Settings → Widgets → Timers. Stored as the `timer_widget` setting,
 * `{ "presets": [3, 5, 10, 15] }`, in whole minutes; no setting means the
 * defaults.
 *
 * The presets are the only way a screen starts a timer, so the widget always
 * keeps at least one, and never shows one it could not start.
 */

/** Until a family picks its own, and whenever what is stored can't be read. */
export const DEFAULT_TIMER_PRESETS: readonly number[] = [3, 5, 10, 15];

/** Enough for the widget to stay a row or two of buttons on a wall display. */
export const MAX_TIMER_PRESETS = 8;

/**
 * A timer's own limit, in minutes: MAX_TIMER_SECONDS in lib/timers.ts, which
 * is server-only (it brings the admin client) and so can't be imported here.
 * e2e/timer-presets.spec.ts keeps the two equal.
 */
export const MAX_TIMER_PRESET_MINUTES = 1440;

export interface TimerWidgetSettings {
  /** Whole minutes, each from 1 to MAX_TIMER_PRESET_MINUTES, no repeats; 1 to MAX_TIMER_PRESETS of them. */
  presets: number[];
}

export function isTimerPresetMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_TIMER_PRESET_MINUTES;
}

/** What PUT /api/settings accepts for `timer_widget`. */
export function isTimerWidgetSettings(value: unknown): value is TimerWidgetSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  // Nothing but `presets`: the route stores the value as it is sent.
  if (Object.keys(value).some((key) => key !== "presets")) return false;
  const { presets } = value as { presets?: unknown };
  return (
    Array.isArray(presets) &&
    presets.length >= 1 &&
    presets.length <= MAX_TIMER_PRESETS &&
    presets.every(isTimerPresetMinutes) &&
    new Set(presets).size === presets.length
  );
}

/**
 * The buttons for a stored `timer_widget` value, smallest first. The route
 * refuses anything else, but a row written some other way must not take the
 * widget's buttons away: what can't be used is skipped, and with nothing
 * left the defaults come back.
 */
export function timerPresets(value: unknown): number[] {
  const stored = typeof value === "object" && value !== null ? (value as { presets?: unknown }).presets : undefined;
  const usable = Array.isArray(stored)
    ? [...new Set(stored.filter(isTimerPresetMinutes))].sort((a, b) => a - b).slice(0, MAX_TIMER_PRESETS)
    : [];
  return usable.length > 0 ? usable : [...DEFAULT_TIMER_PRESETS];
}

/** `presets` with `minutes` added in order; unchanged if it is already there, out of range, or the list is full. */
export function withTimerPreset(presets: readonly number[], minutes: number): number[] {
  if (!isTimerPresetMinutes(minutes) || presets.includes(minutes) || presets.length >= MAX_TIMER_PRESETS) {
    return [...presets];
  }
  return [...presets, minutes].sort((a, b) => a - b);
}

/** `presets` without `minutes`, but never without a preset at all. */
export function withoutTimerPreset(presets: readonly number[], minutes: number): number[] {
  const rest = presets.filter((preset) => preset !== minutes);
  return rest.length > 0 ? rest : [...presets];
}

export function isDefaultTimerPresets(presets: readonly number[]): boolean {
  return presets.length === DEFAULT_TIMER_PRESETS.length && presets.every((preset, i) => preset === DEFAULT_TIMER_PRESETS[i]);
}
