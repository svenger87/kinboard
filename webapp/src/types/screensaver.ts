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
};

export interface PresenceState {
  detected: boolean;
  lastSeen: number | null;
  distance?: number;
  stale: boolean;
  isEnabled: boolean;
}
