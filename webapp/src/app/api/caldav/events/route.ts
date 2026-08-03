import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  createCaldavClient,
  createCaldavEvent,
  deleteCaldavEvent,
  updateCaldavEvent,
  CaldavAuthError,
  CaldavConflictError,
} from "@/lib/caldav-client";
import {
  buildCaldavCalendarObject,
  caldavExternalId,
  caldavUidFromExternalId,
  isRecurrenceInstance,
  newCaldavUid,
} from "@/lib/caldav-serialize";
import { getCaldavCredentials } from "@/lib/caldav-credentials";
import type { ExportEvent } from "@/lib/ics-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Write-through to a CalDAV server — the half of discussion #18 that ICS
 * feeds structurally can't do.
 *
 * Mirrors /api/google/events: the client mutates its local row first,
 * then calls here to push. That ordering keeps the UI instant and means a
 * server that's briefly unreachable degrades to "the edit is in Kinboard
 * but not yet on the server" rather than to a lost edit. The difference
 * from the Google route is that failures here are *reported* rather than
 * swallowed — CalDAV servers are self-hosted and often down, so the hooks
 * surface a toast instead of a console.warn nobody reads.
 *
 * CalDAV has no partial update: a PUT replaces the whole resource. So the
 * update path re-reads the event row and serializes it in full rather
 * than trusting the caller to send every field.
 */

const TIME_ZONE = process.env.TZ ?? "Europe/Berlin";

interface CalendarContext {
  familyId: string;
  calendarId: string;
  caldavUrl: string;
  serverUrl: string;
  readOnly: boolean;
}

interface EventRow {
  id: string;
  calendar_id: string;
  google_event_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  caldav_href: string | null;
  caldav_etag: string | null;
}

function toExportEvent(row: EventRow): ExportEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    start_at: row.start_at,
    end_at: row.end_at,
    all_day: row.all_day,
  };
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Load a calendar and confirm it is CalDAV-backed and writable. */
async function loadCalendar(
  familyId: string,
  calendarId: string,
): Promise<CalendarContext | NextResponse> {
  const supabase = createAdminClient();

  const { data } = await (supabase as any)
    .from("calendars")
    .select("id, family_id, caldav_url, caldav_server_url, caldav_read_only")
    .eq("id", calendarId)
    .eq("family_id", familyId)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ error: "Calendar not found" }, { status: 404 });
  }
  if (!data.caldav_url) {
    // Not an error the user caused — the client routes by calendar type,
    // so this means a local-only or Google calendar reached the wrong
    // endpoint. Report it as a no-op rather than a failure.
    return NextResponse.json({ ok: true, skipped: "not-a-caldav-calendar" });
  }
  if (data.caldav_read_only) {
    return NextResponse.json(
      { error: "This calendar is read-only on the server" },
      { status: 403 },
    );
  }

  return {
    familyId,
    calendarId,
    caldavUrl: data.caldav_url,
    serverUrl: data.caldav_server_url ?? data.caldav_url,
    readOnly: false,
  };
}

async function connect(ctx: CalendarContext) {
  const credentials = await getCaldavCredentials(ctx.familyId, ctx.calendarId);
  if (!credentials) {
    throw new CaldavAuthError();
  }
  return createCaldavClient({
    serverUrl: ctx.serverUrl,
    username: credentials.username,
    password: credentials.password,
  });
}

/** Map a thrown CalDAV error onto a status the client can branch on. */
function errorResponse(err: unknown, operation: string): NextResponse {
  if (err instanceof CaldavConflictError) {
    return NextResponse.json({ error: err.message, conflict: true }, { status: 409 });
  }
  if (err instanceof CaldavAuthError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  const message = err instanceof Error ? err.message : `CalDAV ${operation} failed`;
  console.error(`[caldav-events] ${operation} failed: ${message}`);
  return NextResponse.json({ error: message }, { status: 502 });
}

const EVENT_COLUMNS =
  "id, calendar_id, google_event_id, title, description, location, start_at, end_at, all_day, caldav_href, caldav_etag";

/**
 * PUT a brand-new resource for an event that has no server-side identity
 * yet. Shared by POST and by PATCH's repair path (an event whose original
 * create never reached the server).
 */
async function createOnServer(
  familyId: string,
  eventId: string,
  calendarId: string,
): Promise<NextResponse> {
  const ctx = await loadCalendar(familyId, calendarId);
  if (ctx instanceof NextResponse) return ctx;

  const supabase = createAdminClient();
  const { data: row } = await (supabase as any)
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", eventId)
    .eq("calendar_id", calendarId)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const uid = newCaldavUid();
  const iCalString = buildCaldavCalendarObject(toExportEvent(row as EventRow), uid, TIME_ZONE);

  try {
    const client = await connect(ctx);
    const { href, etag } = await createCaldavEvent(client, ctx.caldavUrl, uid, iCalString);

    await (supabase as any)
      .from("events")
      .update({
        google_event_id: caldavExternalId(uid),
        caldav_href: href,
        caldav_etag: etag,
      })
      .eq("id", eventId);

    return NextResponse.json({ ok: true, uid, href, etag });
  } catch (err) {
    return errorResponse(err, "create");
  }
}

// POST: push a newly-created Kinboard event to the server.
export async function POST(request: NextRequest) {
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const familyId = typeof body.family_id === "string" ? body.family_id : "";
  const eventId = typeof body.event_id === "string" ? body.event_id : "";
  const calendarId = typeof body.calendar_id === "string" ? body.calendar_id : "";

  if (!familyId || !eventId || !calendarId) {
    return NextResponse.json(
      { error: "family_id, event_id and calendar_id are required" },
      { status: 400 },
    );
  }

  return createOnServer(familyId, eventId, calendarId);
}

// PATCH: replace the resource with the event's current state.
export async function PATCH(request: NextRequest) {
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const familyId = typeof body.family_id === "string" ? body.family_id : "";
  const eventId = typeof body.event_id === "string" ? body.event_id : "";

  if (!familyId || !eventId) {
    return NextResponse.json(
      { error: "family_id and event_id are required" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data: row } = await (supabase as any)
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const ctx = await loadCalendar(familyId, row.calendar_id);
  if (ctx instanceof NextResponse) return ctx;

  if (isRecurrenceInstance(row.google_event_id)) {
    return NextResponse.json(
      {
        error:
          "This is one occurrence of a repeating event — edit the series in your calendar app",
        recurring: true,
      },
      { status: 409 },
    );
  }

  const uid = caldavUidFromExternalId(row.google_event_id);
  if (!uid || !row.caldav_href) {
    // The event exists locally but was never written to the server —
    // usually a create whose PUT failed. Creating it now is the right
    // repair, and leaves the caller with a synced event either way.
    return createOnServer(familyId, eventId, row.calendar_id);
  }

  const iCalString = buildCaldavCalendarObject(toExportEvent(row as EventRow), uid, TIME_ZONE);

  try {
    const client = await connect(ctx);
    const { etag } = await updateCaldavEvent(
      client,
      row.caldav_href,
      iCalString,
      row.caldav_etag,
    );

    await (supabase as any)
      .from("events")
      .update({ caldav_etag: etag })
      .eq("id", eventId);

    return NextResponse.json({ ok: true, etag });
  } catch (err) {
    return errorResponse(err, "update");
  }
}

// DELETE: remove the resource from the server.
export async function DELETE(request: NextRequest) {
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const familyId = typeof body.family_id === "string" ? body.family_id : "";
  const eventId = typeof body.event_id === "string" ? body.event_id : "";

  if (!familyId || !eventId) {
    return NextResponse.json(
      { error: "family_id and event_id are required" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data: row } = await (supabase as any)
    .from("events")
    .select("id, calendar_id, google_event_id, caldav_href, caldav_etag")
    .eq("id", eventId)
    .maybeSingle();

  // Nothing on the server to remove — the local delete stands alone.
  if (!row?.caldav_href) {
    return NextResponse.json({ ok: true, skipped: "no-remote-resource" });
  }

  const ctx = await loadCalendar(familyId, row.calendar_id);
  if (ctx instanceof NextResponse) return ctx;

  if (isRecurrenceInstance(row.google_event_id)) {
    return NextResponse.json(
      {
        error:
          "This is one occurrence of a repeating event — delete the series in your calendar app",
        recurring: true,
      },
      { status: 409 },
    );
  }

  try {
    const client = await connect(ctx);
    await deleteCaldavEvent(client, row.caldav_href, row.caldav_etag);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "delete");
  }
}
