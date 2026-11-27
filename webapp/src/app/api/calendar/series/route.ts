import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { familyIdFrom } from "@/lib/family-scope";
import { takesRepeatingEvents } from "@/lib/local-calendars";
import { parseSeriesCreate } from "@/lib/event-series-input";
import { createSeries } from "@/lib/event-series";

// POST: a repeating event in one of the family's own (local) calendars. The
// series and its first occurrences are written here, on the service role;
// occurrences further ahead come from the daily cron (lib/event-series.ts).
// Any device in the family may add events, as with a single one.
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const familyId = familyIdFrom(request, body);
  if (!familyId) {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const input = parseSeriesCreate(body);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: calendar } = await admin
    .from("calendars")
    .select("id, google_calendar_id, ics_url, caldav_url, is_holidays, is_waste_collection")
    .eq("id", input.value.calendarId)
    .eq("family_id", familyId)
    .maybeSingle();
  if (!calendar) {
    return NextResponse.json({ error: "calendar not found" }, { status: 404 });
  }
  if (!takesRepeatingEvents(calendar)) {
    return NextResponse.json({ error: "repeating events are only for Kinboard's own calendars" }, { status: 400 });
  }
  if (input.value.fields.personId) {
    const { data: person } = await admin
      .from("people")
      .select("id")
      .eq("id", input.value.fields.personId)
      .eq("family_id", familyId)
      .maybeSingle();
    if (!person) return NextResponse.json({ error: "person not found" }, { status: 404 });
  }

  try {
    const created = await createSeries(admin, { ...input.value, familyId, now: new Date() });
    return NextResponse.json({ series_id: created.id, occurrences: created.occurrences }, { status: 201 });
  } catch (error) {
    console.error("event series: create failed", error);
    return NextResponse.json({ error: "could not save the repeating event" }, { status: 500 });
  }
}
