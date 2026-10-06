// Single source of truth for `settings`-table key strings.
// (The table is keyed (family_id, key); these strings were previously
// scattered as literals across hooks, pages, and API routes.)
export const SETTINGS_KEYS = {
  weatherLocation: "weather_location",
  weatherUnits: "weather_units",
  defaultCalendarId: "default_calendar_id",
  // RFC-014 §4.2: { code, chosen }. Replaces holiday_country, which is kept
  // one release, read by nothing, then dropped.
  holidayRegion: "holiday_region",
  // RFC-014 §5.1: { enabled, region, group, pending, last_success_at,
  // last_error_at, last_error }. Written only by the server (plan ruling 20).
  schoolHolidaySync: "school_holiday_sync",
  theme: "theme",
  widgetVisibility: "widget_visibility",
  scheduleWidget: "schedule_widget",
  // { presets: number[] }, the timer widget's buttons in whole minutes;
  // absent means 3, 5, 10 and 15 (lib/timer-presets.ts).
  timerWidget: "timer_widget",
  countdowns: "countdowns",
  taskDisplay: "task_display",
  calendarDisplay: "calendar_display",
  schedulePackItems: "schedule_pack_items",
  schedulePeriods: "schedule_periods",
  // How many days ahead ICS and CalDAV calendars sync (discussion #349).
  // One of CALENDAR_SYNC_RANGE_DAYS in lib/calendar-sync-range.ts; missing
  // or invalid means 60.
  calendarSyncRange: "calendar_sync_range",
  screensaver: "screensaver",
  newsSources: "news_sources",
  newsCustomFeeds: "news_custom_feeds",
  enabledPlugins: "enabled_plugins",
  bringSettings: "bring_settings",
  photoSource: "photo_source",
  settingsPin: "settings_pin",
  homeAssistant: "home_assistant",
  googleCalendar: "google_calendar",
  immich: "immich",
  dlna: "dlna",
  icloud: "icloud",
  cameras: "cameras",
  unsplash: "unsplash",
  locale: "locale",
  weekStart: "week_start",
  // The family's IANA time zone (Settings → Language). Absent means automatic,
  // the server's own: serverTimeZone() in lib/family-time.ts, family_time_zone()
  // in the database. Decides the family's "today" for tasks and Home Assistant.
  timezone: "timezone",
  currency: "currency",
  // Per family, JSON boolean. Off (absent) by default: while no family has
  // switched it on, the OAuth and MCP routes answer 404 (RFC-010, lib/oauth/enabled.ts).
  assistantsEnabled: "assistants_enabled",
} as const;
