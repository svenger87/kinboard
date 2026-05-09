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
  vehicles: boolean;
  stonks: boolean;
}

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
  vehicles: false,
  stonks: false,
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
