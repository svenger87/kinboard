import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { readEventsAfter, currentEventCursor } from "@/lib/integration-store";

export const dynamic = "force-dynamic";

/**
 * Bounded so one request cannot ask the database for the entire retention
 * window. A consumer that is far behind pages forward with the cursor it gets
 * back; that is what the cursor is for.
 */
export const MAX_EVENT_LIMIT = 200;
export const DEFAULT_EVENT_LIMIT = 100;

/** Reject anything that is not a non-negative integer, rather than coercing. */
export function parseAfter(raw: string | null): { ok: true; value: number | null } | { ok: false } {
  if (raw === null || raw === "") return { ok: true, value: null };
  if (!/^\d+$/.test(raw)) return { ok: false };
  const n = Number(raw);
  return Number.isSafeInteger(n) ? { ok: true, value: n } : { ok: false };
}

export function parseLimit(raw: string | null): number {
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_EVENT_LIMIT;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) return DEFAULT_EVENT_LIMIT;
  return Math.min(n, MAX_EVENT_LIMIT);
}

/**
 * GET /api/integration/v1/events?after=<id>&limit=<n>
 *
 * The consumer contract for the outbox. A client stores the last id it
 * processed and asks for everything above it; on reconnect it resumes from
 * there, so a restart of either system loses nothing — RFC-001 §7, and an
 * explicit acceptance criterion.
 *
 * `cursor` in the response is the id to send next time. It is the highest id
 * *returned*, not the current head: if the page was truncated by `limit`,
 * sending back the head would silently skip everything in between.
 *
 * Omitting `after` deliberately returns the oldest retained events rather than
 * the newest. A consumer that has never connected should call /info first and
 * start from the head; one that asks for everything is asking to catch up, and
 * catching up starts at the beginning.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "events:read", async (context) => {
    const url = new URL(request.url);

    const after = parseAfter(url.searchParams.get("after"));
    if (!after.ok) {
      return NextResponse.json(
        { error: "`after` must be a non-negative integer", code: "invalid_request" },
        { status: 400 },
      );
    }
    const limit = parseLimit(url.searchParams.get("limit"));

    const events = await readEventsAfter(context.familyId, after.value, limit);

    const cursor =
      events.length > 0
        ? events[events.length - 1].id
        : (after.value ?? (await currentEventCursor(context.familyId)));

    return NextResponse.json({
      events,
      cursor,
      // Tells a catching-up consumer to come back immediately rather than
      // waiting for the next poll interval.
      has_more: events.length === limit,
    });
  });
}
