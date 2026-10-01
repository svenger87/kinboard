import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import {
  calendarWriteMode,
  deleteVerdict,
  syncDeletedCalendarEvent,
  syncUpdatedCalendarEvent,
  type StoredCalendarEvent,
  type WritableCalendar,
} from "@/lib/calendar-write-through";
import { isRecurrenceInstance } from "@/lib/caldav-serialize";
import { parseEventPatch } from "@/lib/integration-event-input";
import { familyTimeZone } from "@/lib/family-time";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_COLUMNS =
  "id, calendar_id, title, description, location, start_at, end_at, all_day, google_event_id, caldav_href, caldav_etag";
/** What the response shows: the same shape POST answers with. */
const RESPONSE_COLUMNS = ["id", "calendar_id", "title", "description", "start_at", "end_at", "all_day", "location"] as const;

/**
 * PATCH/DELETE /api/integration/v1/calendar/events/{id}
 *
 * Editing and deleting one event, `calendar:write`, written through to the
 * event's Google or CalDAV calendar.
 *
 * `events` has no `family_id`; an event belongs to a family through its
 * calendar. So the event is read by id, then its calendar by id **and**
 * `family_id = context.familyId` — an event in another family's calendar is
 * a 404 indistinguishable from one that does not exist. A read-only calendar
 * (an ICS subscription, a read-only CalDAV collection) is a 404 too, as it
 * is for POST: its events are a mirror, and the next sync would undo any
 * edit made here.
 *
 * PATCH updates the row first, then pushes it (the browser's order,
 * `useUpdateEvent`): the edit stands in Kinboard and `sync` says whether the
 * provider took it. One occurrence of a repeating CalDAV event is refused
 * before anything is written, because the provider half would be refused
 * and the next sync would put the old time back.
 *
 * DELETE asks the provider first and keeps the local row if that fails
 * (`useDeleteEvent`): deleting locally while the event survives upstream
 * means the next sync pulls it straight back. Events have no recycle bin —
 * this is a hard delete, by design.
 */
async function loadEvent(familyId: string, id: string) {
  const supabase = createAdminClient();
  const { data: event, error } = await (supabase as any)
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!event) return null;
  const { data: calendar, error: calendarError } = await (supabase as any)
    .from("calendars")
    .select("id, google_calendar_id, ics_url, caldav_url, caldav_server_url, caldav_read_only")
    .eq("id", event.calendar_id)
    .eq("family_id", familyId)
    .maybeSingle();
  if (calendarError) throw calendarError;
  if (!calendar || calendarWriteMode(calendar as WritableCalendar) === "read_only") return null;
  return { event: event as StoredCalendarEvent, calendar: calendar as WritableCalendar };
}

const notFound = () =>
  NextResponse.json({ error: "No editable event with that ID", code: "not_found" }, { status: 404 });

const recurringConflict = (verb: string) =>
  NextResponse.json(
    { error: `This is one occurrence of a repeating event; ${verb} the series in the calendar app`, code: "conflict" },
    { status: 409 },
  );

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withIntegrationAuth(request, "calendar:write", async (context) => {
    if (!UUID_RE.test(id)) return notFound();

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    try {
      const found = await loadEvent(context.familyId, id);
      if (!found) return notFound();
      const { event, calendar } = found;
      if (calendarWriteMode(calendar) === "caldav" && isRecurrenceInstance(event.google_event_id)) {
        return recurringConflict("edit");
      }

      const timeZone = await familyTimeZone(context.familyId);
      const patch = parseEventPatch(body, event, timeZone);
      if (!patch.ok) {
        return NextResponse.json({ error: patch.error, code: "invalid_request" }, { status: 400 });
      }

      const { data: updated, error } = await (createAdminClient() as any)
        .from("events")
        .update(patch.value.columns)
        .eq("id", event.id)
        .eq("calendar_id", calendar.id)
        .select(EVENT_COLUMNS)
        .single();
      if (error) throw error;

      const sync = await syncUpdatedCalendarEvent(
        context.familyId,
        calendar,
        updated as StoredCalendarEvent,
        patch.value.allDayDates,
        timeZone,
      );
      const shown = Object.fromEntries(RESPONSE_COLUMNS.map((k) => [k, (updated as StoredCalendarEvent)[k]]));
      return NextResponse.json({ event: shown, sync });
    } catch (err) {
      await logApiError("integration/calendar/events/update", err);
      return NextResponse.json({ error: "Could not update the event", code: "internal_error" }, { status: 500 });
    }
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withIntegrationAuth(request, "calendar:write", async (context) => {
    if (!UUID_RE.test(id)) return notFound();

    try {
      const found = await loadEvent(context.familyId, id);
      if (!found) return notFound();
      const { event, calendar } = found;

      const sync = await syncDeletedCalendarEvent(context.familyId, calendar, event);
      const verdict = deleteVerdict(sync);
      if (!verdict.proceed) {
        return NextResponse.json({ error: verdict.error, code: verdict.code, sync }, { status: verdict.status });
      }

      const { error } = await (createAdminClient() as any)
        .from("events")
        .delete()
        .eq("id", event.id)
        .eq("calendar_id", calendar.id);
      if (error) throw error;

      return NextResponse.json({ ok: true, sync });
    } catch (err) {
      await logApiError("integration/calendar/events/delete", err);
      return NextResponse.json({ error: "Could not delete the event", code: "internal_error" }, { status: 500 });
    }
  });
}
