export interface WritableCalendar {
  id: string;
  google_calendar_id: string | null;
  ics_url: string | null;
  caldav_url: string | null;
  caldav_server_url: string | null;
  caldav_read_only: boolean | null;
}

/** Where a new event in this calendar goes; subscriptions take nothing. */
export function calendarWriteMode(calendar: WritableCalendar): "local" | "google" | "caldav" | "read_only" {
  if (calendar.ics_url || calendar.caldav_read_only) return "read_only";
  if (calendar.caldav_url) return "caldav";
  if (calendar.google_calendar_id) return "google";
  return "local";
}
