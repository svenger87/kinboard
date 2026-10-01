import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import {
  findStoredResult, fingerprintRequest, storeResult, validateIdempotencyKey,
} from "@/lib/integration-idempotency";
import { calendarWriteMode, syncCreatedCalendarEvent, type WritableCalendar } from "@/lib/calendar-write-through";
import { isValidTimeZone, parseEventInput } from "@/lib/integration-event-input";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/calendar/events?start=&end=
 *
 * Calendar events in a range, for `calendar.kinboard_family`.
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
    const range = parseRange(url.searchParams.get("start"), url.searchParams.get("end"));

    if (!range.ok) {
      const messages: Record<string, string> = {
        missing: "`start` and `end` are both required",
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
      const { data: calendars } = await (supabase as any)
        .from("calendars")
        .select("id")
        .eq("family_id", context.familyId);

      const calendarIds = ((calendars ?? []) as { id: string }[]).map((c) => c.id);
      if (calendarIds.length === 0) {
        return NextResponse.json({ events: [] });
      }

      // Overlap, not containment: an event that started yesterday and ends
      // tomorrow belongs in today's window. Filtering on start_at alone would
      // drop exactly the long events a calendar most needs to show.
      const { data, error } = await (supabase as any)
        .from("events")
        .select("id, title, description, location, start_at, end_at, all_day, person_id")
        .in("calendar_id", calendarIds)
        .lt("start_at", range.end!.toISOString())
        .gt("end_at", range.start!.toISOString())
        .order("start_at", { ascending: true })
        .limit(500);

      if (error) throw error;

      return NextResponse.json({ events: data ?? [] });
    } catch (err) {
      await logApiError("integration/calendar/events", err);
      return NextResponse.json(
        { error: "Could not read the calendar", code: "internal_error" },
        { status: 500 },
      );
    }
  });
}

/**
 * The zone that turns an all-day date into instants: the family's `timezone`
 * setting, as the summary uses, else the container's `TZ` as the rest of the
 * server does.
 */
async function familyTimeZone(familyId: string): Promise<string> {
  const { data } = await (createAdminClient() as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", "timezone")
    .maybeSingle();
  if (isValidTimeZone(data?.value)) return data.value;
  return isValidTimeZone(process.env.TZ) ? process.env.TZ : "Europe/Berlin";
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
      const { data: calendar, error: calendarError } = await (supabase as any)
        .from("calendars")
        .select("id, google_calendar_id, ics_url, caldav_url, caldav_server_url, caldav_read_only")
        .eq("id", event.calendarId)
        .eq("family_id", context.familyId)
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
        })
        .select("id, calendar_id, title, description, start_at, end_at, all_day, location")
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
