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
}

export const DEFAULT_SCREENSAVER_SETTINGS: ScreensaverSettings = {
  screensaverTimeout: 120,
  presenceTimeout: 30,
  presenceControlMode: 'screensaver',
  photoRotationInterval: 30,
};

export interface PresenceState {
  detected: boolean;
  lastSeen: number | null;
  distance?: number;
  stale: boolean;
  isEnabled: boolean;
}
