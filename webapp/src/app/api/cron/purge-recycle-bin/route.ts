import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Empties the recycle bin of everything past its family's retention window.
 *
 * The work is a single `purge_expired()` call rather than a delete per table,
 * because a purge has to run with `kinboard.hard_delete` set for its whole
 * transaction — otherwise each cascaded child hits its own soft-delete trigger,
 * survives, and is left pointing at a parent that no longer exists. PostgREST
 * cannot set a transaction-local GUC, so the sweep lives in the database. It
 * reads `settings.recycle_bin.retentionDays` per family; 0 means keep forever.
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

   
  const { data, error } = await (supabase as any).rpc("purge_expired");
  if (error) {
    console.error("[purge-recycle-bin] purge_expired failed:", error);
    return NextResponse.json({ error: "Purge failed" }, { status: 500 });
  }

  const purged = typeof data === "number" ? data : 0;
  if (purged > 0) {
    console.log(`[purge-recycle-bin] purged ${purged} expired row(s)`);
  }
  return NextResponse.json({ purged });
}
