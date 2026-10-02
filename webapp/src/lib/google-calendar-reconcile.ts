import type { createAdminClient } from "@/lib/supabase/server";

/**
 * What happens to a Google calendar the family unticked.
 *
 * Settings -> Google Calendar only ever rewrote `enabled_calendars`, and the
 * syncs only ever looped over that list. So a calendar that left the list
 * simply stopped being looked at: its `calendars` row and every event on it
 * stayed, on every screen, for ever. Measured on a live instance: the family
 * unticked "Feiertage in Deutschland", the setting no longer named it, and
 * the row still carried 106 events and `is_holidays = true`, so it went on
 * deciding which days were school days as well.
 *
 * The rule now: a Google-backed row (`google_calendar_id` set) whose Google
 * id is not in `enabled_calendars` keeps its row but loses the events it got
 * from Google, and is marked `sync_enabled = false`. Keeping the row keeps what the family set on
 * it -- colour, person, `is_holidays`, `is_waste_collection` -- so ticking it
 * again brings it back as it was, and the next sync refetches the events.
 *
 * `sync_enabled` was never read or written by the app before this; only the
 * demo seed sets it, to false, on a *local* holidays calendar that must stay
 * on screen. So "hidden" is not `sync_enabled = false` on its own -- it is
 * `sync_enabled = false` on a Google-backed row. ICS, CalDAV and local
 * calendars are never touched here and never hidden by it.
 */

type Db = ReturnType<typeof createAdminClient>;

/**
 * PostgREST `or` filter for calendars that are on screen: anything not
 * backed by Google, and Google calendars that are still ticked.
 *
 * `not.is.false` rather than `is.true`, so a row whose `sync_enabled` is NULL
 * (the column is nullable, default true) still counts as on.
 *
 * On `calendars` itself: `.or(VISIBLE_CALENDARS)`. On an embedded calendar:
 * `.or(VISIBLE_CALENDARS, { referencedTable: "calendar" })` with the
 * embedding's alias, and `!inner`, so an event whose calendar fails the test
 * is dropped rather than returned with a null calendar.
 */
export const VISIBLE_CALENDARS = "google_calendar_id.is.null,sync_enabled.not.is.false";

/** The same rule as VISIBLE_CALENDARS, for rows already in hand. */
export function isVisibleCalendar(row: {
  google_calendar_id?: string | null;
  sync_enabled?: boolean | null;
}): boolean {
  if (row.google_calendar_id === null || row.google_calendar_id === undefined) return true;
  return row.sync_enabled !== false;
}

export interface GoogleCalendarRow {
  id: string;
  google_calendar_id: string | null;
  sync_enabled: boolean | null;
}

/**
 * Which of a family's Google-backed rows to switch off, and which to switch
 * back on, for this `enabled_calendars` list.
 *
 * `off` lists every unticked row, already-off ones included: their events are
 * deleted again on every run, which is a no-op normally and cleans up after a
 * sync that was mid-flight when the calendar was unticked and wrote events
 * into it anyway.
 */
export function planGoogleCalendarReconcile(
  rows: GoogleCalendarRow[],
  enabledGoogleIds: string[],
): { off: string[]; on: string[] } {
  const enabled = new Set(enabledGoogleIds);
  const off: string[] = [];
  const on: string[] = [];
  for (const row of rows) {
    // Not Google's: ICS, CalDAV and local calendars are none of this code's business.
    if (!row.google_calendar_id) continue;
    if (enabled.has(row.google_calendar_id)) {
      if (row.sync_enabled === false) on.push(row.id);
    } else {
      off.push(row.id);
    }
  }
  return { off, on };
}

export interface ReconcileResult {
  disabled: number;
  enabled: number;
  deletedEvents: number;
}

/**
 * Bring a family's Google-backed calendar rows in line with
 * `enabled_calendars`: unticked rows are switched off and their events
 * deleted, re-ticked rows switched back on.
 *
 * `enabledCalendars` is the stored setting as found. When it is not an array
 * of strings -- a settings row that never had the key, or one holding
 * something else -- nothing is done: an absent list is not a decision to
 * untick everything.
 *
 * Every query is family-scoped: the rows are read with `family_id`, the
 * updates repeat it, and events (which have no family_id of their own) are
 * deleted only by the ids of rows that read returned.
 *
 * Only events with a `google_event_id` -- Google's copies -- are deleted, and
 * hard-deleted: `events` is deliberately outside the soft delete
 * (migration_zzz_soft_delete.sql), and the next sync of a re-ticked calendar
 * fetches them again. Events created in Kinboard that never reached Google
 * are kept (see below). No table holds a foreign key to `events`.
 *
 * Throws on a database error, so a caller that cannot reconcile says so
 * rather than reporting a clean sync.
 */
export async function reconcileGoogleCalendars(
  db: Db,
  familyId: string,
  enabledCalendars: unknown,
): Promise<ReconcileResult> {
  const result: ReconcileResult = { disabled: 0, enabled: 0, deletedEvents: 0 };
  if (!familyId || !Array.isArray(enabledCalendars)) return result;
  // A list with anything but ids in it is not one we can act on: treated like
  // a missing list rather than filtered, which would read as "untick the rest".
  if (!enabledCalendars.every((id) => typeof id === "string")) return result;
  const enabledIds = enabledCalendars as string[];

  const { data: rows, error } = await (db as any)
    .from("calendars")
    .select("id, google_calendar_id, sync_enabled")
    .eq("family_id", familyId)
    .not("google_calendar_id", "is", null);
  if (error) throw error;

  const { off, on } = planGoogleCalendarReconcile((rows ?? []) as GoogleCalendarRow[], enabledIds);

  if (off.length > 0) {
    // Off first, so the calendar leaves every screen even if the event delete
    // below fails; the next run deletes them.
    const { error: offError } = await (db as any)
      .from("calendars")
      .update({ sync_enabled: false })
      .eq("family_id", familyId)
      .in("id", off);
    if (offError) throw offError;
    result.disabled = off.length;

    // Only Google's copies. An event with no google_event_id was created in
    // Kinboard and never reached Google (the write-through keeps the local
    // row when the push fails), so re-ticking could not fetch it back. It
    // stays, hidden with its calendar by VISIBLE_CALENDARS, and is back when
    // the calendar is ticked again: the sync's own prune also only ever
    // touches events that have a google_event_id.
    const { data: gone, error: deleteError } = await (db as any)
      .from("events")
      .delete()
      .in("calendar_id", off)
      .not("google_event_id", "is", null)
      .select("id");
    if (deleteError) throw deleteError;
    result.deletedEvents = (gone ?? []).length;
  }

  if (on.length > 0) {
    const { error: onError } = await (db as any)
      .from("calendars")
      .update({ sync_enabled: true })
      .eq("family_id", familyId)
      .in("id", on);
    if (onError) throw onError;
    result.enabled = on.length;
  }

  return result;
}

/** What the OAuth callback learns from a (re)connect. */
export interface GoogleConnection {
  access_token: string;
  refresh_token?: string | null;
  expiry_date?: number | null;
  token_type: string;
  email?: string;
  connected_at: string;
}

/**
 * The `google_calendar` setting after a (re)connect.
 *
 * The callback used to upsert only the connection, replacing the whole
 * setting. A reconnect -- the Reconnect button after `needs_reauth`, say --
 * therefore dropped `enabled_calendars`, `mapping_rules` and `auto_sync`: the
 * cron stopped, and Settings showed every calendar unticked, so the first
 * tick afterwards saved a one-calendar list and reconcile switched off every
 * other calendar and deleted its events.
 *
 * Now the connection fields are replaced and everything else the family set
 * is kept. The one exception is a reconnect to a *different* Google account
 * (both emails known and different): the old account's calendar ids mean
 * nothing there, so `enabled_calendars` is dropped -- an absent list, which
 * reconcile treats as "do nothing" -- and the family ticks the new account's
 * calendars afresh. Mapping rules and auto-sync are not about an account and
 * stay. The status fields of the dead connection (`needs_reauth`,
 * `auto_sync_error`) are cleared.
 */
export function mergeReconnectedGoogleSettings(
  existing: unknown,
  connection: GoogleConnection,
): Record<string, unknown> {
  const previous =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const previousEmail = typeof previous.email === "string" ? previous.email.toLowerCase() : null;
  const newEmail = connection.email ? connection.email.toLowerCase() : null;
  if (previousEmail && newEmail && previousEmail !== newEmail) {
    delete previous.enabled_calendars;
  }
  return {
    ...previous,
    ...connection,
    needs_reauth: false,
    auto_sync_error: null,
  };
}
