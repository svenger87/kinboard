/**
 * What the app does when the presence sensor stops seeing anyone.
 *
 * `display_power` is kept in the union for stored settings that already
 * contain it, but nothing in the webapp acts on it — and nothing can. Cutting
 * power to a panel means talking to the compositor (Mutter's `PowerSaveMode`
 * over the session D-Bus, or DPMS), and a browser tab has no such reach: the
 * Wake Lock API can only keep a screen awake, never put it to sleep.
 *
 * The real DPMS behaviour lives on the kiosk itself, in kiosk/presence-sensor.py
 * (`set_display_power`), which switches the panel off after its own hardcoded
 * delay and has never read this setting. So a family choosing "display off"
 * here changed nothing either way — see the note on the screensaver settings
 * page, which now says so instead of offering the choice.
 */
export type PresenceControlMode = 'screensaver' | 'display_power';

export interface ScreensaverSettings {
  // Timeout in seconds before screensaver activates (0 = disabled)
  screensaverTimeout: number;
  // Seconds to wait after no presence before taking action
  presenceTimeout: number;
  // What to control when no presence is detected
  presenceControlMode: PresenceControlMode;
  // Photo rotation interval in seconds (how often photos change)
  photoRotationInterval: number;
  showNews?: boolean;
  largeDetails?: boolean;
  // How many events the screensaver lists, 1 to 5 (#282).
  eventCount?: number;
  // Whether it lists birthdays at all, and how many, 1 to 5.
  showBirthdays?: boolean;
  birthdayCount?: number;
  // The line under the clock in the hour before an event (RFC-021 §3.2).
  showNextEvent?: boolean;
  // A dim clock and nothing else during the family's bedtime (RFC-021 §3.4).
  night?: boolean;
  // A strip of the next forecast slots under the weather chip (#282): the
  // time, an icon, the temperature and the chance of rain.
  showForecast?: boolean;
  // Each child's lessons and what to bring, in the stack with the events
  // (#282); in the evening the next school day, from the schedule widget's
  // "next school day from" time.
  showLessons?: boolean;
  // Home's weather effects (snow, rain, frost...) over the photos too, with
  // the thresholds from Settings -> Weather; separate from Home's own switch.
  weatherEffects?: boolean;
  // How solid the screensaver's dark panels are over the photos
  // (weather, events, news...), as a percentage from 30 to 95
  // in steps of 5; absent means the default, 70 — see
  // screensaverOverlayOpacity below.
  overlayOpacity?: number;
}

/** The choices for both lists. */
export const SCREENSAVER_LIST_COUNTS = [1, 2, 3, 4, 5] as const;

/**
 * A stored list length as a whole number from 1 to 5; anything else (never
 * set, hand-edited, a string) is `fallback`, which is what the screensaver
 * showed before the setting existed: four events, three birthdays.
 */
export function screensaverListCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5 ? value : fallback;
}

/** Panel opacity bounds and default, as percentages (Settings -> Screensaver). */
export const SCREENSAVER_OVERLAY_OPACITY_MIN = 30;
export const SCREENSAVER_OVERLAY_OPACITY_MAX = 95;
export const SCREENSAVER_OVERLAY_OPACITY_STEP = 5;
export const SCREENSAVER_OVERLAY_OPACITY_DEFAULT = 70;

/**
 * A stored panel opacity as a percentage from 30 to 95 on the slider's
 * 5-point steps; anything else (never set, hand-edited, a string) is
 * the default, 70 — solid enough that the panels read as cards over a
 * bright photo, where the old fixed 40% fill washed out.
 */
export function screensaverOverlayOpacity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return SCREENSAVER_OVERLAY_OPACITY_DEFAULT;
  const clamped = Math.min(SCREENSAVER_OVERLAY_OPACITY_MAX, Math.max(SCREENSAVER_OVERLAY_OPACITY_MIN, value));
  return Math.round(clamped / SCREENSAVER_OVERLAY_OPACITY_STEP) * SCREENSAVER_OVERLAY_OPACITY_STEP;
}

export const DEFAULT_SCREENSAVER_SETTINGS: ScreensaverSettings = {
  screensaverTimeout: 120,
  presenceTimeout: 30,
  presenceControlMode: 'screensaver',
  photoRotationInterval: 30,
  showNews: true,
  largeDetails: false,
  eventCount: 4,
  showBirthdays: true,
  birthdayCount: 3,
  showNextEvent: true,
  night: false,
  showForecast: false,
  showLessons: false,
  weatherEffects: false,
  overlayOpacity: SCREENSAVER_OVERLAY_OPACITY_DEFAULT,
};

export interface PresenceState {
  detected: boolean;
  lastSeen: number | null;
  distance?: number;
  stale: boolean;
  isEnabled: boolean;
}
