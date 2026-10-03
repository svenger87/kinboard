import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import { isValidTimeZone } from "@/lib/integration-event-input";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Closes the due days of repeating tasks that take turns or track whether
 * they were done (#341), every quarter of an hour.
 *
 * A due day stays open until the next one arrives. When it does, the old day
 * is closed: with tracking on, a day nobody ticked is written down as missed,
 * with whose turn it was; and a rotating task's `person_id` moves on to the
 * new turn's person, so everything that reads it -- the person filter, the
 * reminders, the family widget -- shows today's.
 *
 * Written down rather than worked out on read, so that history never changes
 * under an edit. The work is one `close_todo_days()` call: the schedule
 * lives in the database, next to the trigger that applies it to ticks
 * (migration_zzzzzy_todo_turns.sql). Each family's own `timezone` setting
 * decides when its day ends; the server's TZ stands in for a family without
 * one, as everywhere else on the server.
 */
export async function POST(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await (supabase as any).rpc("close_todo_days", {
    p_fallback_tz: isValidTimeZone(process.env.TZ) ? process.env.TZ : null,
  });

  if (error) {
    await logApiError("close-task-days", error);
    return NextResponse.json({ error: "Closing task days failed" }, { status: 500 });
  }

  const written = typeof data === "number" ? data : 0;
  if (written > 0) {
    console.log(`[close-task-days] wrote ${written} missed day(s)`);
  }
  return NextResponse.json({ ok: true, written });
}
