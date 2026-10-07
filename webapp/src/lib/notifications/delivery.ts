/**
 * Which devices a queued push may reach, per device: its switch for that
 * kind of push, and its quiet hours. Taken out of
 * api/cron/process-notifications unchanged, so the rule can be tested
 * without a cron tick, and so every type -- the reward pushes included --
 * passes through the same one.
 */

import { REWARD_DECIDED, REWARD_PREFERENCE_COLUMN, REWARD_REQUESTED } from "./rewards";

/** The notification_preferences column that switches a type off, or null when none does. */
export function getPreferenceColumn(type: string): string | null {
  switch (type) {
    case "shopping_collaborative":
      return "shopping_collaborative";
    case "todo_created":
    case "todo_assigned":
      return "todo_collaborative";
    case "calendar_reminder":
      return "calendar_reminders";
    case "birthday_reminder":
      return "birthday_reminders";
    case "meal_prep_reminder":
      return "meal_prep_reminders";
    case REWARD_REQUESTED:
    case REWARD_DECIDED:
      return REWARD_PREFERENCE_COLUMN;
    default:
      return null;
  }
}

export interface DevicePreferences {
  device_id: string | null;
  quiet_hours_enabled?: boolean | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  [column: string]: unknown;
}

/**
 * Whether `currentTime` ("HH:MM", the server's clock) falls in the device's
 * quiet hours. Both ends count as quiet; a window that crosses midnight
 * (22:00-07:00) is quiet before the end and after the start.
 */
export function inQuietHours(prefs: DevicePreferences, currentTime: string): boolean {
  if (!prefs.quiet_hours_enabled) return false;
  const start = prefs.quiet_hours_start || "22:00";
  const end = prefs.quiet_hours_end || "07:00";
  if (start > end) return currentTime >= start || currentTime <= end;
  return currentTime >= start && currentTime <= end;
}

/** "HH:MM" on the server's clock, as the quiet hours are compared. */
export function clockTime(now: Date): string {
  return `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
}

/**
 * The subscriptions a push of this type may go to now. A device with no
 * preferences row gets everything, as before; one whose switch for the type
 * is off, or that is in its quiet hours, gets nothing.
 */
export function eligibleSubscriptions<S extends { device_id: string }>(
  subscriptions: readonly S[],
  preferences: readonly DevicePreferences[],
  type: string,
  currentTime: string,
): S[] {
  const column = getPreferenceColumn(type);
  const byDevice = new Map(preferences.map((p) => [p.device_id, p]));
  return subscriptions.filter((sub) => {
    const prefs = byDevice.get(sub.device_id);
    if (!prefs) return true;
    if (column && prefs[column] === false) return false;
    return !inQuietHours(prefs, currentTime);
  });
}

/**
 * The same, from the preferences read as it came back. An unreadable
 * preferences table means nobody, never everybody: sending anyway would
 * ignore every device's quiet hours and switches, and a push that wakes a
 * house at 3 a.m. cannot be unsent. Logged, so a missing push can be traced.
 */
export function eligibleFromRead<S extends { device_id: string }>(
  subscriptions: readonly S[],
  read: { data: unknown; error: unknown },
  type: string,
  currentTime: string,
  log: (message: string, error: unknown) => void = (m, e) => console.error(m, e),
): S[] {
  if (read.error) {
    log(`[process-notifications] Could not read notification preferences, sending ${type} to nobody:`, read.error);
    return [];
  }
  return eligibleSubscriptions(subscriptions, (read.data ?? []) as DevicePreferences[], type, currentTime);
}
