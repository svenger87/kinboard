export interface WidgetVisibility {
  weather: boolean;
  upcomingEvents: boolean;
  schedule: boolean;
  birthday: boolean;
  weekOverview: boolean;
  mealPlan: boolean;
  wasteCollection: boolean;
  notes: boolean;
  tasks: boolean;
  shopping: boolean;
  vehicles: boolean;
  stonks: boolean;
  pocketMoney: boolean;
  photos: boolean;
  timers: boolean;
  media: boolean;
  messages: boolean;
  countdown: boolean;
}

export const DEFAULT_WIDGET_ORDER: (keyof WidgetVisibility)[] = [
  "weather", "upcomingEvents", "schedule", "birthday", "weekOverview",
  "mealPlan", "wasteCollection", "tasks", "shopping", "notes",
  "vehicles", "stonks", "pocketMoney", "photos", "timers", "media", "messages",
  "countdown",
];

// Defaults are curated for kiosk glanceability — 6 widgets fill a 4-col landscape grid
// cleanly (1.5 rows) without overflow. Opt-in extras (birthday, wasteCollection, notes,
// vehicles) require user-specific setup, so they start disabled and users enable via
// /settings/widgets. Existing families keep whatever they saved in widget_visibility;
// the dashboard's read-side migration treats a saved `tesla: true` as `vehicles: true`
// so users who had the legacy Tesla widget enabled keep seeing the Vehicles widget
// after upgrade. See migrateLegacyWidgetVisibility().
export const DEFAULT_WIDGET_VISIBILITY: WidgetVisibility = {
  weather: true,
  upcomingEvents: true,
  weekOverview: true,
  schedule: true,
  tasks: true,
  mealPlan: true,
  birthday: false,
  wasteCollection: false,
  notes: false,
  shopping: false,
  vehicles: false,
  stonks: false,
  pocketMoney: false,
  // Opt-in: it needs a photo source connected before it can show anything.
  photos: false,
  // On by default: unlike the media player it needs no setup to be useful,
  // so defaulting off would mean nobody finds it.
  timers: true,
  // Opt-in: shows nothing until a household has configured a media player.
  media: false,
  // On by default, same reasoning as timers — and the widget switch is the
  // feature switch: RFC-005 §6.
  messages: true,
  countdown: false,
};

// Read-side migration: legacy widget_visibility blobs persisted before
// the Tesla → Vehicles rename had `tesla: boolean`. New code reads
// `vehicles: boolean`. To avoid silently disabling the widget for
// users who had Tesla on, copy the legacy field forward when present.
//
// The legacy field is left in the saved blob unchanged — server-side
// migration of every family's widget_visibility row is unnecessary
// extra work; this 4-line read-side shim handles the same intent.
export function migrateLegacyWidgetVisibility(
  saved: WidgetVisibility & { tesla?: boolean },
): WidgetVisibility {
  if (saved.vehicles === undefined && saved.tesla !== undefined) {
    return { ...saved, vehicles: saved.tesla };
  }
  return saved;
}

/**
 * Settings for the Stundenplan widget that are not "is it visible".
 *
 * Kept out of `WidgetVisibility` on purpose: that type is read as "one
 * boolean per widget" — `settings/widgets/page.tsx` counts its true values
 * against `WIDGET_CONFIGS.length` — so a flag that is not a widget would
 * make the enabled count wrong the moment it is switched on.
 */
export interface ScheduleWidgetSettings {
  /**
   * Render one card per timetabled child instead of a single card with the
   * manual child switcher (discussion #264). Off by default: one card is
   * the right shape for a single child, and a wall that is already full
   * should not grow widgets without being asked.
   */
  perChild: boolean;
  equalSize?: boolean;
  tomorrowFrom?: string;
}

export const DEFAULT_SCHEDULE_WIDGET_SETTINGS: ScheduleWidgetSettings = {
  perChild: false,
  equalSize: false,
  tomorrowFrom: "off",
};
