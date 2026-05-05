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
  tesla: boolean;
}

// Defaults are curated for kiosk glanceability — 6 widgets fill a 4-col landscape grid
// cleanly (1.5 rows) without overflow. Opt-in extras (birthday, wasteCollection, notes,
// tesla) require user-specific setup, so they start disabled and users enable via
// /settings/widgets. Existing families keep whatever they saved in widget_visibility.
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
  tesla: false,
};
