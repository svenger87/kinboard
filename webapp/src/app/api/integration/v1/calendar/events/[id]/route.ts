import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { destructiveLimitResponse } from "@/lib/integration-limits";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import {
  calendarWriteMode,
  deleteVerdict,
  syncDeletedCalendarEvent,
  syncUpdatedCalendarEvent,
  type StoredCalendarEvent,
} from "@/lib/calendar-write-through";
import { EVENT_COLUMNS, loadFamilyEvent } from "@/lib/family-event-scope";
import { isRecurrenceInstance } from "@/lib/caldav-serialize";
import { parseEventPatch } from "@/lib/integration-event-input";
import { familyTimeZone } from "@/lib/family-time";
import { familyPersonId } from "@/lib/integration-tasks";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the response shows: the same shape POST answers with. */
const RESPONSE_COLUMNS = ["id", "calendar_id", "title", "description", "start_at", "end_at", "all_day", "location", "person_id"] as const;

/**
 * PATCH/DELETE /api/integration/v1/calendar/events/{id}
 *
 * Editing and deleting one event, `calendar:write`, written through to the
 * event's Google or CalDAV calendar.
 *
 * `events` has no `family_id`; an event belongs to a family through its
 * calendar. `loadFamilyEvent` (lib/family-event-scope.ts) reads the
 * event by id, then its calendar by id **and** `family_id =
 * context.familyId` — an event in another family's calendar is a 404
 * indistinguishable from one that does not exist. The update and delete
 * below then filter on that calendar's id as well as the event's. A read-only calendar
 * (an ICS subscription, a read-only CalDAV collection) is a 404 too, as it
 * is for POST: its events are a mirror, and the next sync would undo any
 * edit made here.
 *
 * `person_id` assigns the event to a person of this family (null: nobody),
 * checked as a task's assignee is (`familyPersonId`); a person of another
 * family is refused like one that does not exist. A Google event carries
 * the assignee in its private extended property, as the screens write it,
 * or the next Google sync would put the old one back.
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
    const limited = destructiveLimitResponse(context);
    if (limited) return limited;
    if (!UUID_RE.test(id)) return notFound();

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    try {
      const found = await loadFamilyEvent(createAdminClient(), context.familyId, id);
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

      const { columns } = patch.value;
      if (typeof columns.person_id === "string") {
        const person = await familyPersonId(createAdminClient(), context.familyId, columns.person_id);
        if (!person.ok) {
          return NextResponse.json({ error: person.error, code: "invalid_request" }, { status: 400 });
        }
      }

      const { data: updated, error } = await (createAdminClient() as any)
        .from("events")
        .update(columns)
        .eq("id", event.id)
        .eq("calendar_id", calendar.id)
        .select(`${EVENT_COLUMNS}, person_id`)
        .single();
      if (error) throw error;

      // The assignee goes to the provider only when this edit set it, so an
      // edit of the title never pins a person Google sync had derived from
      // the calendar.
      const { person_id: assignee, ...stored } = updated as StoredCalendarEvent;
      const sync = await syncUpdatedCalendarEvent(
        context.familyId,
        calendar,
        "person_id" in columns ? { ...stored, person_id: assignee ?? null } : stored,
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
    const limited = destructiveLimitResponse(context);
    if (limited) return limited;
    if (!UUID_RE.test(id)) return notFound();

    try {
      const found = await loadFamilyEvent(createAdminClient(), context.familyId, id);
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
