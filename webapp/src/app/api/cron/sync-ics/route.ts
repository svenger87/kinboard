import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchIcsCalendar } from "@/lib/ics-fetcher";
import { matchPersonForEvent, PersonMappingRule } from "@/lib/calendar-person-matcher";

const CRON_SECRET = process.env.CRON_SECRET;

interface IcsSyncResult {
  calendarId: string;
  success: boolean;
  synced?: number;
  created?: number;
  updated?: number;
  deleted?: number;
  notModified?: boolean;
  error?: string;
}

async function syncIcsCalendar(
  calendarId: string,
  icsUrl: string,
  previousEtag: string | null,
  calendarPersonId: string | null,
  mappingRules: PersonMappingRule[],
): Promise<IcsSyncResult> {
  const supabase = createAdminClient();

  let fetchResult;
  try {
    fetchResult = await fetchIcsCalendar(icsUrl, previousEtag);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown fetch error";
    console.error(`[sync-ics] Fetch failed for calendar ${calendarId}: ${msg}`);
    return { calendarId, success: false, error: msg };
  }

  const now = new Date().toISOString();

  if (fetchResult.notModified) {
    // Server returned 304 — no parse needed, just bump last_synced_at

    await (supabase as any)
      .from("calendars")
      .update({ last_synced_at: now })
      .eq("id", calendarId);

    console.log(`[sync-ics] Calendar ${calendarId}: 304 Not Modified`);
    return { calendarId, success: true, notModified: true, synced: 0, created: 0, updated: 0, deleted: 0 };
  }

  const { events } = fetchResult;
  const freshUids = new Set(events.map((e) => `ics:${e.uid}`));

  let created = 0;
  let updated = 0;
  let deleted = 0;

  // Upsert each event
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
      .single();

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

  // Delete events that were in the table but are not in the fresh fetch
  // (handles ICS-side deletions)

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
    `[sync-ics] Calendar ${calendarId}: synced=${events.length}, created=${created}, updated=${updated}, deleted=${deleted}`
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

// POST: sync all ICS-backed calendars across all families
export async function POST(request: NextRequest) {
  if (!CRON_SECRET) {
    console.error("[sync-ics] CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
    console.warn("[sync-ics] Unauthorized access attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[sync-ics] Starting ICS sync");

  const supabase = createAdminClient();

  // Fetch all ICS-backed calendars

  const { data: icsCalendars, error } = await (supabase as any)
    .from("calendars")
    .select("id, family_id, ics_url, ics_etag, person_id")
    .not("ics_url", "is", null);

  if (error) {
    console.error("[sync-ics] Error fetching ICS calendars:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!icsCalendars || icsCalendars.length === 0) {
    console.log("[sync-ics] No ICS calendars configured");
    return NextResponse.json({
      processed: 0,
      succeeded: 0,
      failed: 0,
      message: "No ICS calendars configured",
      timestamp: new Date().toISOString(),
    });
  }

  console.log(`[sync-ics] Found ${icsCalendars.length} ICS calendar(s)`);

  // Gather mapping rules per family (reuse google-calendar pattern from settings key)
  const familyIds = [...new Set(icsCalendars.map((c: { family_id: string }) => c.family_id))] as string[];
  const mappingRulesByFamily = new Map<string, PersonMappingRule[]>();

  for (const familyId of familyIds) {

    const { data: settingsRow } = await (supabase as any)
      .from("settings")
      .select("value")
      .eq("family_id", familyId)
      .eq("key", "google_calendar")
      .single();

    const rules: PersonMappingRule[] = settingsRow?.value?.mapping_rules ?? [];
    mappingRulesByFamily.set(familyId, rules);
  }

  // Process each calendar independently
  const results = await Promise.allSettled(
    icsCalendars.map((cal: { id: string; family_id: string; ics_url: string; ics_etag: string | null; person_id: string | null }) =>
      syncIcsCalendar(
        cal.id,
        cal.ics_url,
        cal.ics_etag,
        cal.person_id,
        mappingRulesByFamily.get(cal.family_id) ?? [],
      )
    )
  );

  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value.success
  ).length;
  const failed = results.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success)
  ).length;

  results.forEach((result, index) => {
    const calId = icsCalendars[index].id;
    if (result.status === "rejected") {
      console.error(`[sync-ics] Calendar ${calId}: rejected — ${result.reason}`);
    } else if (!result.value.success) {
      console.error(`[sync-ics] Calendar ${calId}: failed — ${result.value.error}`);
    }
  });

  console.log(`[sync-ics] Done: ${succeeded} succeeded, ${failed} failed`);

  return NextResponse.json({
    processed: icsCalendars.length,
    succeeded,
    failed,
    timestamp: new Date().toISOString(),
  });
}
