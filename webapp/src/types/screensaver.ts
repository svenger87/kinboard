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
  // The panels' colour (Settings -> Screensaver -> Panel colour), one of
  // SCREENSAVER_PANEL_COLORS; absent means black, the colour the panels
  // always were — see screensaverPanelColor below.
  panelColor?: ScreensaverPanelColor;
  // The colour of the writing on the panels (Settings -> Screensaver ->
  // Panel text colour). Absent means derived from the panel colour —
  // white on the dark panels, black on the light ones; a stored value is
  // an explicit choice and wins — see screensaverPanelTextColor below.
  panelTextColor?: ScreensaverPanelTextColor;
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

/** The panel colours Settings -> Screensaver offers, darkest to lightest. */
export const SCREENSAVER_PANEL_COLORS = ["black", "graphite", "grey", "silver", "white"] as const;
export type ScreensaverPanelColor = (typeof SCREENSAVER_PANEL_COLORS)[number];

/** The writing colours the panels offer. */
export const SCREENSAVER_PANEL_TEXT_COLORS = ["white", "black"] as const;
export type ScreensaverPanelTextColor = (typeof SCREENSAVER_PANEL_TEXT_COLORS)[number];

/** Each panel colour as an "r g b" triplet, for the panels' CSS variable. */
export const SCREENSAVER_PANEL_RGB: Record<ScreensaverPanelColor, string> = {
  black: "0 0 0",
  graphite: "38 38 42",
  grey: "115 115 118",
  silver: "209 209 214",
  white: "255 255 255",
};

/** Each writing colour as an "r g b" triplet. */
export const SCREENSAVER_PANEL_TEXT_RGB: Record<ScreensaverPanelTextColor, string> = {
  white: "255 255 255",
  black: "0 0 0",
};

/**
 * The accents inside the panels, per writing colour: the rain figure that
 * stands out in the forecast, and the amber of a holiday icon, a lessons
 * "bring" line. The light versions (sky-300,
 * amber-300) all but vanish on a light panel, so black writing takes the
 * deep versions (sky-700, amber-800) instead.
 */
export const SCREENSAVER_PANEL_ACCENT_RGB: Record<ScreensaverPanelTextColor, string> = {
  white: "125 211 252",
  black: "3 105 161",
};
export const SCREENSAVER_PANEL_AMBER_RGB: Record<ScreensaverPanelTextColor, string> = {
  white: "252 211 77",
  black: "146 64 14",
};

/**
 * A stored panel colour as one of the offered names; anything else
 * (never set, hand-edited) is black, the colour the panels always were.
 */
export function screensaverPanelColor(value: unknown): ScreensaverPanelColor {
  return (SCREENSAVER_PANEL_COLORS as readonly unknown[]).includes(value)
    ? (value as ScreensaverPanelColor)
    : "black";
}

/**
 * The writing colour for a panel colour: a stored "white" or "black" is
 * an explicit choice and wins; anything else derives from the panel —
 * white on the dark panels (black, graphite), black on the light ones
 * (grey, silver, white), so black writing on a silver panel is what a
 * family gets by picking the panel colour alone.
 */
export function screensaverPanelTextColor(value: unknown, panelColor: ScreensaverPanelColor): ScreensaverPanelTextColor {
  if ((SCREENSAVER_PANEL_TEXT_COLORS as readonly unknown[]).includes(value)) {
    return value as ScreensaverPanelTextColor;
  }
  return panelColor === "black" || panelColor === "graphite" ? "white" : "black";
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
  panelColor: "black",
  // No panelTextColor here on purpose: its default is derived from the
  // panel colour, not a constant — a stored object that gained "white"
  // from these defaults would keep white writing on a silver panel.
};

export interface PresenceState {
  detected: boolean;
  lastSeen: number | null;
  distance?: number;
  stale: boolean;
  isEnabled: boolean;
}
