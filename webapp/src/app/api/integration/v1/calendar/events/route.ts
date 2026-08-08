import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";

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
