// Single source of truth for `settings`-table key strings.
// (The table is keyed (family_id, key); these strings were previously
// scattered as literals across hooks, pages, and API routes.)
export const SETTINGS_KEYS = {
  weatherLocation: "weather_location",
  weatherUnits: "weather_units",
  defaultCalendarId: "default_calendar_id",
  holidayCountry: "holiday_country",
  theme: "theme",
  widgetVisibility: "widget_visibility",
  schedulePackItems: "schedule_pack_items",
  schedulePeriods: "schedule_periods",
  screensaver: "screensaver",
  newsSources: "news_sources",
  enabledPlugins: "enabled_plugins",
  bringSettings: "bring_settings",
  photoSource: "photo_source",
  settingsPin: "settings_pin",
  homeAssistant: "home_assistant",
  googleCalendar: "google_calendar",
  immich: "immich",
  cameras: "cameras",
  unsplash: "unsplash",
  locale: "locale",
} as const;
