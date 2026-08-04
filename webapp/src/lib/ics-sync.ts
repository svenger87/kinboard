import { createAdminClient } from "@/lib/supabase/server";
import { fetchIcsCalendar } from "@/lib/ics-fetcher";
import { matchPersonForEvent, PersonMappingRule } from "@/lib/calendar-person-matcher";

/**
 * Per-calendar ICS sync helper. Shared by:
 *   - /api/cron/sync-ics  — fan-out across all ICS-backed calendars
 *     in all families on a 30-min schedule
 *   - /api/calendar/sync-ics  — user-triggered "Sync now" for a single
 *     family, called from the /settings/ics manual-sync button
 *
 * The two endpoints are intentionally separate (cron auth via
 * CRON_SECRET vs family-scoped via family_id body) but share this
 * function so the upsert/delete behaviour can't drift.
 */

export interface IcsSyncResult {
  calendarId: string;
  success: boolean;
  synced?: number;
  created?: number;
  updated?: number;
  deleted?: number;
  notModified?: boolean;
  error?: string;
}

/**
 * How long an ETag may be trusted before we re-read the feed regardless.
 *
 * Comfortably inside ICS_WINDOW_FUTURE_DAYS, so the window can never
 * advance past the events we last parsed.
 */
const ETAG_MAX_AGE_DAYS = 7;

async function syncedRecently(
  supabase: any,
  calendarId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("calendars")
    .select("last_synced_at")
    .eq("id", calendarId)
    .maybeSingle();

  if (!data?.last_synced_at) return false;
  const ageMs = Date.now() - new Date(data.last_synced_at).getTime();
  return ageMs < ETAG_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

export async function syncIcsCalendar(
  calendarId: string,
  icsUrl: string,
  previousEtag: string | null,
  calendarPersonId: string | null,
  mappingRules: PersonMappingRule[],
): Promise<IcsSyncResult> {
  const supabase = createAdminClient();

  // Honour the stored ETag only if we've re-parsed this feed recently.
  //
  // The sync window is relative to now (see icsSyncWindow), but a
  // conditional GET is keyed on content. A feed that never changes —
  // school holidays, a club fixture list, a shared calendar set up once —
  // answers 304 forever, so the window advances past events we never
  // parsed and the far end of the calendar goes quietly empty. A full
  // re-read every so often fills it in, and still leaves the ETag doing
  // its job the rest of the time.
  const effectiveEtag = (await syncedRecently(supabase, calendarId))
    ? previousEtag
    : null;

  let fetchResult;
  try {
    fetchResult = await fetchIcsCalendar(icsUrl, effectiveEtag);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown fetch error";
    console.error(`[ics-sync] Fetch failed for calendar ${calendarId}: ${msg}`);
    return { calendarId, success: false, error: msg };
  }

  const now = new Date().toISOString();

  if (fetchResult.notModified) {
    // Server returned 304 — no parse needed, just bump last_synced_at

    await (supabase as any)
      .from("calendars")
      .update({ last_synced_at: now })
      .eq("id", calendarId);
    console.log(`[ics-sync] Calendar ${calendarId}: 304 Not Modified`);
    return { calendarId, success: true, notModified: true, synced: 0, created: 0, updated: 0, deleted: 0 };
  }

  const { events } = fetchResult;
  const freshUids = new Set(events.map((e) => `ics:${e.uid}`));

  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const ev of events) {
    const googleEventId = `ics:${ev.uid}`;

    let personId: string | null = calendarPersonId;
    if (!personId && mappingRules.length > 0) {
      personId = matchPersonForEvent(ev.title, mappingRules) ?? null;
    }

    const eventData = {
      calendar_id: calendarId,
      google_event_id: googleEventId,
      title: ev.title,
      description: ev.description,
      location: ev.location,
      start_at: ev.start_at,
      end_at: ev.end_at,
      all_day: ev.all_day,
      person_id: personId,
      updated_at: now,
    };


    const { data: existing } = await (supabase as any)
      .from("events")
      .select("id")
      .eq("calendar_id", calendarId)
      .eq("google_event_id", googleEventId)
      // maybeSingle, not single: `.single()` errors when more than one
      // row matches as well as when none does, and both surfaced as null
      // — so an existing duplicate sent this down the insert path and
      // added another one on every sync.
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing) {

      await (supabase as any)
        .from("events")
        .update(eventData)
        .eq("id", existing.id);
      updated++;
    } else {

      await (supabase as any).from("events").insert(eventData);
      created++;
    }
  }

  // Delete events present in the previous fetch but not the current one

  const { data: existingIcsEvents } = await (supabase as any)
    .from("events")
    .select("id, google_event_id")
    .eq("calendar_id", calendarId)
    .like("google_event_id", "ics:%");

  for (const row of existingIcsEvents ?? []) {
    if (!freshUids.has(row.google_event_id)) {

      await (supabase as any).from("events").delete().eq("id", row.id);
      deleted++;
    }
  }

  // Persist updated ETag + last_synced_at

  await (supabase as any)
    .from("calendars")
    .update({
      ics_etag: fetchResult.etag,
      last_synced_at: now,
    })
    .eq("id", calendarId);

  console.log(
    `[ics-sync] Calendar ${calendarId}: synced=${events.length}, created=${created}, updated=${updated}, deleted=${deleted}`,
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

/**
 * Sync every ICS-backed calendar for a single family. The shape mirrors
 * the cron's per-family iteration but bounded to one family — used by
 * the user-triggered "Sync now" button on /settings/ics.
 */
export async function syncFamilyIcsCalendars(familyId: string) {
  const supabase = createAdminClient();


  const { data: icsCalendars, error } = await (supabase as any)
    .from("calendars")
    .select("id, family_id, ics_url, ics_etag, person_id")
    .eq("family_id", familyId)
    .not("ics_url", "is", null);

  if (error) {
    throw new Error(`Database error: ${error.message ?? "unknown"}`);
  }

  if (!icsCalendars || icsCalendars.length === 0) {
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      results: [] as IcsSyncResult[],
    };
  }

  // Reuse the per-family mapping rules saved on the google_calendar
  // settings key (same conventions as the cron path).

  const { data: settingsRow } = await (supabase as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", "google_calendar")
    .single();

  const mappingRules: PersonMappingRule[] = settingsRow?.value?.mapping_rules ?? [];

  const results = await Promise.allSettled(
    icsCalendars.map(
      (cal: {
        id: string;
        ics_url: string;
        ics_etag: string | null;
        person_id: string | null;
      }) =>
        syncIcsCalendar(cal.id, cal.ics_url, cal.ics_etag, cal.person_id, mappingRules),
    ),
  );

  const succeeded = results.filter(
    (r): r is PromiseFulfilledResult<IcsSyncResult> => r.status === "fulfilled" && r.value.success,
  ).length;
  const failed = results.length - succeeded;

  return {
    processed: icsCalendars.length,
    succeeded,
    failed,
    results: results.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : ({ calendarId: "unknown", success: false, error: String(r.reason) } as IcsSyncResult),
    ),
  };
}
