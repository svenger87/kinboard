import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Trims the domain event outbox.
 *
 * The outbox is a catch-up log, not an archive. RFC-001 §7: a Bridge that was
 * offline for a week has to be able to resume from its cursor, and nothing
 * needs events from last spring. Left unswept the table grows for the life of
 * the installation — every completed task and every shopping item, forever, on
 * hardware that is often a Raspberry Pi.
 *
 * Thirty days is the default because it comfortably covers the longest outage
 * a household is likely to notice and fix, while keeping the table small
 * enough that the cursor index stays in memory.
 *
 * Deliberately NOT configurable per family, unlike the recycle bin. The
 * recycle bin's retention is a user-facing promise about their own data
 * ("we'll keep deleted things for 30 days"); this is an internal delivery
 * buffer whose length is an operational detail. A setting here would be a
 * knob with no meaningful answer.
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

  const keepDays = Number(process.env.DOMAIN_EVENT_RETENTION_DAYS ?? 30);


  const { data, error } = await (supabase as any).rpc("purge_domain_events", {
    p_keep_days: Number.isFinite(keepDays) && keepDays > 0 ? Math.floor(keepDays) : 30,
  });

  if (error) {
    await logApiError("purge-domain-events", error);
    return NextResponse.json({ error: "Purge failed" }, { status: 500 });
  }

  const purged = typeof data === "number" ? data : 0;
  if (purged > 0) {
    console.log(`[purge-domain-events] purged ${purged} event(s)`);
  }

  return NextResponse.json({ ok: true, purged });
}
