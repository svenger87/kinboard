import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { syncIcsCalendar, IcsSyncResult } from "@/lib/ics-sync";
import type { PersonMappingRule } from "@/lib/calendar-person-matcher";

// Force Node.js runtime + dynamic — node-ical (transitive: http, https,
// fs) is Node-only and Next's static page-data collector fails to bundle
// it for prerender without these directives.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

// POST: sync all ICS-backed calendars across all families. Auth via
// CRON_SECRET. The user-triggered single-family equivalent lives at
// /api/calendar/sync-ics (different auth, same per-calendar work via
// the shared `syncIcsCalendar` helper in lib/ics-sync.ts).
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

  console.log("[sync-ics] Starting cross-family ICS sync");

  const supabase = createAdminClient();


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

  // Mapping rules per family (same convention as the user-triggered path
  // — pulled from the google_calendar settings key).
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

  const results = await Promise.allSettled(
    icsCalendars.map(
      (cal: {
        id: string;
        family_id: string;
        ics_url: string;
        ics_etag: string | null;
        person_id: string | null;
      }) =>
        syncIcsCalendar(
          cal.id,
          cal.ics_url,
          cal.ics_etag,
          cal.person_id,
          mappingRulesByFamily.get(cal.family_id) ?? [],
        ),
    ),
  );

  const succeeded = results.filter(
    (r): r is PromiseFulfilledResult<IcsSyncResult> => r.status === "fulfilled" && r.value.success,
  ).length;
  const failed = results.length - succeeded;

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
