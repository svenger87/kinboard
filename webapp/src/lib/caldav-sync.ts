import { createAdminClient } from "@/lib/supabase/server";
import {
  createCaldavClient,
  fetchCaldavCtag,
  fetchCaldavEvents,
  CaldavAuthError,
} from "@/lib/caldav-client";
import { caldavExternalId, CALDAV_ID_PREFIX } from "@/lib/caldav-serialize";
import { getCaldavCredentials } from "@/lib/caldav-credentials";
import { matchPersonForEvent, PersonMappingRule } from "@/lib/calendar-person-matcher";

/**
 * Per-calendar CalDAV sync. Shared by:
 *   - /api/cron/sync-caldav      — fan-out across every CalDAV calendar
 *     in every family, on the same 30-minute cadence as the ICS job
 *   - /api/calendar/sync-caldav  — user-triggered "Sync now" for one
 *     family, from the /settings/caldav button
 *
 * Structurally a twin of lib/ics-sync.ts, for the same reason that file
 * exists: two entry points with different auth must not grow two
 * different notions of what a sync does to the events table.
 *
 * Direction of travel: server → Kinboard. Writes go the other way through
 * /api/caldav/events at the moment the user edits, not on a schedule, so
 * a sync that runs between an edit and its PUT can't resurrect the old
 * version (the local row is already updated and its ETag already bumped).
 */

export interface CaldavSyncResult {
  calendarId: string;
  success: boolean;
  synced?: number;
  created?: number;
  updated?: number;
  deleted?: number;
  notModified?: boolean;
  error?: string;
}

export interface CaldavCalendarRow {
  id: string;
  family_id: string;
  caldav_url: string;
  caldav_server_url: string | null;
  caldav_ctag: string | null;
  person_id: string | null;
}

export async function syncCaldavCalendar(
  calendar: CaldavCalendarRow,
  mappingRules: PersonMappingRule[],
): Promise<CaldavSyncResult> {
  const supabase = createAdminClient();
  const calendarId = calendar.id;
  const now = new Date().toISOString();

  const fail = async (message: string): Promise<CaldavSyncResult> => {
    console.error(`[caldav-sync] Calendar ${calendarId}: ${message}`);
    // Persisted so the settings UI can explain a stale calendar. Expired
    // app passwords are the common case and are otherwise invisible —
    // the calendar just quietly stops updating.
    await (supabase as any)
      .from("calendars")
      .update({ caldav_last_error: message })
      .eq("id", calendarId);
    return { calendarId, success: false, error: message };
  };

  const credentials = await getCaldavCredentials(calendar.family_id, calendarId);
  if (!credentials) {
    return fail("No stored credentials for this calendar — reconnect it in settings");
  }

  let client;
  try {
    client = await createCaldavClient({
      serverUrl: calendar.caldav_server_url ?? calendar.caldav_url,
      username: credentials.username,
      password: credentials.password,
    });
  } catch (err) {
    return fail(
      err instanceof CaldavAuthError
        ? err.message
        : `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Cheap change check before the expensive REPORT — the CalDAV analogue
  // of the ICS path's conditional GET. A server that doesn't publish a
  // CTag returns null, which never equals the stored value, so those
  // calendars simply always do the full fetch.
  let ctag: string | null = null;
  try {
    ctag = await fetchCaldavCtag(client, calendar.caldav_url);
  } catch (err) {
    // Not fatal: a missing or unreadable CTag costs efficiency, not
    // correctness. Fall through to the full fetch.
    console.warn(
      `[caldav-sync] Calendar ${calendarId}: CTag probe failed, doing full sync — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (ctag && calendar.caldav_ctag && ctag === calendar.caldav_ctag) {
    await (supabase as any)
      .from("calendars")
      .update({ last_synced_at: now, caldav_last_error: null })
      .eq("id", calendarId);
    console.log(`[caldav-sync] Calendar ${calendarId}: CTag unchanged`);
    return {
      calendarId,
      success: true,
      notModified: true,
      synced: 0,
      created: 0,
      updated: 0,
      deleted: 0,
    };
  }

  let events;
  try {
    events = await fetchCaldavEvents(client, calendar.caldav_url);
  } catch (err) {
    return fail(
      err instanceof CaldavAuthError
        ? err.message
        : `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const freshIds = new Set(events.map((e) => caldavExternalId(e.uid)));

  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const ev of events) {
    const externalId = caldavExternalId(ev.uid);

    let personId: string | null = calendar.person_id;
    if (!personId && mappingRules.length > 0) {
      personId = matchPersonForEvent(ev.title, mappingRules) ?? null;
    }

    const eventData = {
      calendar_id: calendarId,
      google_event_id: externalId,
      title: ev.title,
      description: ev.description,
      location: ev.location,
      start_at: ev.start_at,
      end_at: ev.end_at,
      all_day: ev.all_day,
      person_id: personId,
      caldav_href: ev.href,
      caldav_etag: ev.etag,
      updated_at: now,
    };

    const { data: existing } = await (supabase as any)
      .from("events")
      .select("id")
      .eq("calendar_id", calendarId)
      .eq("google_event_id", externalId)
      .maybeSingle();

    if (existing) {
      await (supabase as any).from("events").update(eventData).eq("id", existing.id);
      updated++;
    } else {
      await (supabase as any).from("events").insert(eventData);
      created++;
    }
  }

  // Events the server no longer returns are gone — deleted upstream, or
  // aged out of the sync window. Scoped to the `caldav:` prefix so a
  // local-only event someone added to this calendar (or one whose PUT
  // failed and never got an external id) is never collateral damage.
  const { data: existingCaldavEvents } = await (supabase as any)
    .from("events")
    .select("id, google_event_id")
    .eq("calendar_id", calendarId)
    .like("google_event_id", `${CALDAV_ID_PREFIX}%`);

  for (const row of existingCaldavEvents ?? []) {
    if (!freshIds.has(row.google_event_id)) {
      await (supabase as any).from("events").delete().eq("id", row.id);
      deleted++;
    }
  }

  await (supabase as any)
    .from("calendars")
    .update({
      caldav_ctag: ctag,
      last_synced_at: now,
      caldav_last_error: null,
    })
    .eq("id", calendarId);

  console.log(
    `[caldav-sync] Calendar ${calendarId}: synced=${events.length}, created=${created}, updated=${updated}, deleted=${deleted}`,
  );

  return {
    calendarId,
    success: true,
    synced: events.length,
    created,
    updated,
    deleted,
  };
}

const CALDAV_COLUMNS =
  "id, family_id, caldav_url, caldav_server_url, caldav_ctag, person_id";

/**
 * Per-family mapping rules. They live on the `google_calendar` settings
 * key for historical reasons — the rule editor shipped with the Google
 * integration — and the ICS path already reads them from there. Sharing
 * the location means one rule set colours events from every provider.
 */
export async function getMappingRules(familyId: string): Promise<PersonMappingRule[]> {
  const supabase = createAdminClient();
  const { data } = await (supabase as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", "google_calendar")
    .maybeSingle();
  return data?.value?.mapping_rules ?? [];
}

/** Sync every CalDAV calendar belonging to one family. */
export async function syncFamilyCaldavCalendars(familyId: string) {
  const supabase = createAdminClient();

  const { data: calendars, error } = await (supabase as any)
    .from("calendars")
    .select(CALDAV_COLUMNS)
    .eq("family_id", familyId)
    .not("caldav_url", "is", null);

  if (error) {
    throw new Error(`Database error: ${error.message ?? "unknown"}`);
  }

  if (!calendars || calendars.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, results: [] as CaldavSyncResult[] };
  }

  const mappingRules = await getMappingRules(familyId);

  return summarize(
    calendars as CaldavCalendarRow[],
    await Promise.allSettled(
      (calendars as CaldavCalendarRow[]).map((cal) => syncCaldavCalendar(cal, mappingRules)),
    ),
  );
}

/** Sync every CalDAV calendar across every family — the cron entry point. */
export async function syncAllCaldavCalendars() {
  const supabase = createAdminClient();

  const { data: calendars, error } = await (supabase as any)
    .from("calendars")
    .select(CALDAV_COLUMNS)
    .not("caldav_url", "is", null);

  if (error) {
    throw new Error(`Database error: ${error.message ?? "unknown"}`);
  }

  if (!calendars || calendars.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, results: [] as CaldavSyncResult[] };
  }

  const rows = calendars as CaldavCalendarRow[];

  // One settings lookup per family, not per calendar — a family with six
  // Nextcloud calendars would otherwise re-read the same row six times.
  const rulesByFamily = new Map<string, PersonMappingRule[]>();
  for (const familyId of new Set(rows.map((c) => c.family_id))) {
    rulesByFamily.set(familyId, await getMappingRules(familyId));
  }

  return summarize(
    rows,
    await Promise.allSettled(
      rows.map((cal) => syncCaldavCalendar(cal, rulesByFamily.get(cal.family_id) ?? [])),
    ),
  );
}

function summarize(
  calendars: CaldavCalendarRow[],
  settled: PromiseSettledResult<CaldavSyncResult>[],
) {
  const results = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : ({
          calendarId: calendars[i]?.id ?? "unknown",
          success: false,
          error: String(r.reason),
        } as CaldavSyncResult),
  );

  const succeeded = results.filter((r) => r.success).length;

  return {
    processed: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
}
