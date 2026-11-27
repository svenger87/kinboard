import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { familyIdFrom } from "@/lib/family-scope";
import { parseSeriesUpdate } from "@/lib/event-series-input";
import { SERIES_COLUMNS, deleteSeries, updateSeries, type OccurrenceRef, type SeriesRow } from "@/lib/event-series";

// The family's own series only: a series of another family is the same 404
// as one that doesn't exist.
async function loadSeries(admin: any, id: string, familyId: string): Promise<SeriesRow | null> {
  const { data } = await admin.from("event_series").select(SERIES_COLUMNS).eq("id", id).eq("family_id", familyId).maybeSingle();
  return (data as SeriesRow | null) ?? null;
}

async function loadOccurrence(admin: any, id: string, series: SeriesRow) {
  const { data } = await admin
    .from("events")
    .select("id, start_at, end_at, all_day, series_day")
    .eq("id", id)
    .eq("series_id", series.id)
    .eq("calendar_id", series.calendar_id)
    .maybeSingle();
  return (data as OccurrenceRef | null) ?? null;
}

// The series was written by something else between reading it and writing
// it (another screen, the nightly job): the edit is not made on stale data.
const CHANGED_MEANWHILE = { error: "the repeating event changed meanwhile; try again" };

// PATCH: change every occurrence of a series ("All events"), from an edit made
// on one of them (lib/event-series.ts updateSeries). `rule: null` stops the
// repeat and keeps that occurrence on its own.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const familyId = familyIdFrom(request, body);
  if (!familyId) {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();
  const series = await loadSeries(admin, id, familyId);
  if (!series) return NextResponse.json({ error: "not found" }, { status: 404 });

  const input = parseSeriesUpdate(body, series.time_zone);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

  const occurrence = await loadOccurrence(admin, input.value.occurrenceId, series);
  if (!occurrence) return NextResponse.json({ error: "not found" }, { status: 404 });

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
    const result = await updateSeries(admin, series, occurrence, input.value, new Date());
    if (result.status === "stale") return NextResponse.json(CHANGED_MEANWHILE, { status: 409 });
    if (result.status === "gone") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("event series: update failed", error);
    return NextResponse.json({ error: "could not save the repeating event" }, { status: 500 });
  }
}

// DELETE: the whole series, or with ?from=<occurrence id> that occurrence and
// every later one ("This and following"). A single occurrence is deleted like
// any event, by its own row.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const familyId = familyIdFrom(request);
  if (!familyId) {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();
  const series = await loadSeries(admin, id, familyId);
  if (!series) return NextResponse.json({ error: "not found" }, { status: 404 });

  const fromId = request.nextUrl.searchParams.get("from");
  let from: OccurrenceRef | undefined;
  if (fromId) {
    const occurrence = await loadOccurrence(admin, fromId, series);
    if (!occurrence) return NextResponse.json({ error: "not found" }, { status: 404 });
    from = occurrence;
  }

  try {
    return NextResponse.json(await deleteSeries(admin, series, from));
  } catch (error) {
    console.error("event series: delete failed", error);
    return NextResponse.json({ error: "could not delete the repeating event" }, { status: 500 });
  }
}
