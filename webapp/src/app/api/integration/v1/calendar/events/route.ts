import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { VISIBLE_CALENDARS } from "@/lib/google-calendar-reconcile";
import { logApiError } from "@/lib/api-error";
import {
  findStoredResult, fingerprintRequest, storeResult, validateIdempotencyKey,
} from "@/lib/integration-idempotency";
import { calendarWriteMode, syncCreatedCalendarEvent, type WritableCalendar } from "@/lib/calendar-write-through";
import { parseEventInput } from "@/lib/integration-event-input";
import { familyTimeZone } from "@/lib/family-time";
import { familyPersonId } from "@/lib/integration-tasks";
import {
  defaultSearchWindow, eventsOverlapping, familyCalendarIds, parseSearchQuery, searchEvents,
} from "@/lib/integration-event-search";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/calendar/events?start=&end=[&query=]
 *
 * Calendar events in a range, for `calendar.kinboard_family`.
 *
 * With `query` it is a search (RFC-012, `search_calendar_events`): only
 * events whose title, location or description contains the text, at most
 * 100, earliest first (lib/integration-event-search.ts). A search may leave
 * out `start` and `end` — "when is the dentist?" names no window — and then
 * looks from today to 365 days ahead in the family's zone. Given, they are
 * used unchanged, with the same bounds as a listing. Without `query` both
 * stay required, as below.
 *
 * Separate from /family/summary rather than folded into it, because the two
 * answer different questions. The summary answers "what is true right now",
 * which is what a sensor shows and what a poll wants. A calendar entity is
 * asked for arbitrary windows — Home Assistant requests whatever the user is
 * looking at, which may be next month — and returning a month of events on
 * every 30-second summary poll to serve that would be absurd.
 */

/** A window wider than this is a mistake or a scrape, not a calendar view. */
export const MAX_RANGE_DAYS = 370;

export interface RangeParseResult {
  ok: boolean;
  start?: Date;
  end?: Date;
  reason?: "missing" | "unparseable" | "reversed" | "too_wide";
}

/**
 * Parse and bound the requested window.
 *
 * Both ends are required. A default would be a guess about what the caller
 * meant, and the two plausible guesses — "today" and "everything" — differ by
 * several orders of magnitude in cost.
 */
export function parseRange(startRaw: string | null, endRaw: string | null): RangeParseResult {
  if (!startRaw || !endRaw) return { ok: false, reason: "missing" };

  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, reason: "unparseable" };
  }
  if (end.getTime() <= start.getTime()) return { ok: false, reason: "reversed" };

  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (days > MAX_RANGE_DAYS) return { ok: false, reason: "too_wide" };

  return { ok: true, start, end };
}

export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    const url = new URL(request.url);
    const rawQuery = url.searchParams.get("query");
    const query = rawQuery === null ? null : parseSearchQuery(rawQuery);
    if (query && !query.ok) {
      return NextResponse.json({ error: query.error, code: "invalid_request" }, { status: 400 });
    }
    const startRaw = url.searchParams.get("start");
    const endRaw = url.searchParams.get("end");
    const range: RangeParseResult = query && startRaw === null && endRaw === null
      ? { ok: true, ...defaultSearchWindow(new Date(), await familyTimeZone(context.familyId)) }
      : parseRange(startRaw, endRaw);

    if (!range.ok) {
      const messages: Record<string, string> = {
        missing: query ? "send both `start` and `end`, or neither to search from today" : "`start` and `end` are both required",
        unparseable: "`start` and `end` must be ISO 8601 timestamps",
        reversed: "`end` must be after `start`",
        too_wide: `the window may not exceed ${MAX_RANGE_DAYS} days`,
      };
      return NextResponse.json(
        { error: messages[range.reason ?? "missing"], code: "invalid_request" },
        { status: 400 },
      );
    }

    try {
      const supabase = createAdminClient();

      // Events are scoped by calendar, not directly by family, so the family's
      // calendars come first. Doing it in two queries rather than an embedded
      // filter keeps the family check explicit and impossible to misread.
      const calendarIds = await familyCalendarIds(supabase, context.familyId);
      if (calendarIds.length === 0) {
        return NextResponse.json({ events: [] });
      }

      if (query?.ok) {
        const events = await searchEvents(
          supabase, calendarIds, query.value, range.start!, range.end!,
        );
        return NextResponse.json({ events });
      }

      const data = await eventsOverlapping(supabase, calendarIds, range.start!, range.end!);
      return NextResponse.json({ events: data });
    } catch (err) {
      await logApiError("integration/calendar/events", err);
      return NextResponse.json(
        { error: "Could not read the calendar", code: "internal_error" },
        { status: 500 },
      );
    }
  });
}

/** Create a family event, then write through to its connected provider. */
export async function POST(request: NextRequest) {
  return withIntegrationAuth(request, "calendar:write", async (context) => {
    const key = validateIdempotencyKey(request.headers.get("idempotency-key"));
    if (!key.ok) {
      return NextResponse.json({ error: "An Idempotency-Key is required", code: "invalid_request" }, { status: 400 });
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : {};
    } catch {
      body = {};
    }
    const timeZone = await familyTimeZone(context.familyId);
    const input = parseEventInput(body, timeZone);
    if (!input.ok) {
      return NextResponse.json({ error: input.error, code: "invalid_request" }, { status: 400 });
    }
    const event = input.value;

    const hash = fingerprintRequest("calendar/events", body);
    const previous = await findStoredResult(context.familyId, key.key);
    if (previous) {
      if (previous.request_hash !== hash) {
        return NextResponse.json({ error: "Idempotency-Key reused with different arguments", code: "conflict" }, { status: 409 });
      }
      return NextResponse.json(previous.response, { status: previous.status, headers: { "idempotent-replay": "true" } });
    }

    try {
      const supabase = createAdminClient();
      if (typeof event.personId === "string") {
        const person = await familyPersonId(supabase, context.familyId, event.personId);
        if (!person.ok) {
          return NextResponse.json({ error: person.error, code: "invalid_request" }, { status: 400 });
        }
      }
      const { data: calendar, error: calendarError } = await (supabase as any)
        .from("calendars")
        .select("id, google_calendar_id, ics_url, caldav_url, caldav_server_url, caldav_read_only")
        .eq("id", event.calendarId)
        .eq("family_id", context.familyId)
        // An unticked Google calendar is not offered, so not writable either.
        .or(VISIBLE_CALENDARS)
        .maybeSingle();
      if (calendarError) throw calendarError;
      if (!calendar || calendarWriteMode(calendar as WritableCalendar) === "read_only") {
        return NextResponse.json({ error: "No writable calendar with that ID", code: "not_found" }, { status: 404 });
      }
      const { data, error } = await (supabase as any)
        .from("events")
        .insert({
          calendar_id: event.calendarId,
          title: event.title,
          start_at: event.startAt,
          end_at: event.endAt,
          all_day: event.allDay,
          ...(event.description !== undefined ? { description: event.description } : {}),
          ...(event.location !== undefined ? { location: event.location } : {}),
          ...(event.personId !== undefined ? { person_id: event.personId } : {}),
        })
        .select("id, calendar_id, title, description, start_at, end_at, all_day, location, person_id")
        .single();
      if (error) throw error;
      const sync = await syncCreatedCalendarEvent(
        context.familyId,
        calendar as WritableCalendar,
        data,
        event.allDayDates,
        timeZone,
      );
      const response = { event: data, sync };
      await storeResult({ familyId: context.familyId, key: key.key, service: "calendar/events", requestHash: hash, status: 201, response });
      return NextResponse.json(response, { status: 201 });
    } catch (err) {
      await logApiError("integration/calendar/events/create", err);
      return NextResponse.json({ error: "Could not create event", code: "internal_error" }, { status: 500 });
    }
  });
}
