import { NextRequest, NextResponse } from "next/server";
import { logApiError } from "@/lib/api-error";
import { liveSchoolSyncDeps } from "@/lib/school-sync/live";
import { runSchoolSyncCron } from "@/lib/school-sync/cron";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Syncs school holidays from OpenHolidays for every family that has it on --
 * including those whose default, on, nobody has saved yet -- and has not
 * synced successfully for a week (RFC-014 §5.2). ofelia runs it `@every 24h`
 * from container start, so installs spread across the day rather than all
 * asking one small API at 03:00. The run itself is runSchoolSyncCron.
 */
export async function POST(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deps = liveSchoolSyncDeps();
  if (!deps.installEnabled) return NextResponse.json({ skipped: "SCHOOL_HOLIDAY_SYNC=off" });

  const now = deps.now();
  let result;
  try {
    result = await runSchoolSyncCron(deps);
  } catch (err) {
    await logApiError("cron/sync-school-holidays", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if ("due" in result && (result.due > 0 || result.adopted > 0)) {
    console.log(`[sync-school-holidays] ${JSON.stringify(result)}`);
  }
  return NextResponse.json({ ...result, timestamp: now.toISOString() });
}
