import { NextRequest, NextResponse } from "next/server";
import { logApiError } from "@/lib/api-error";
import { liveSchoolSyncDeps } from "@/lib/school-sync/live";
import { isDue, syncFamily } from "@/lib/school-sync/sync";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Syncs school holidays from OpenHolidays for every family that turned it on
 * and has not synced successfully for a week (RFC-014 §5.2). ofelia runs it
 * `@every 24h` from container start, so installs spread across the day
 * rather than all asking one small API at 03:00. One family at a time.
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
  let families;
  try {
    families = await deps.store.enabledFamilies();
  } catch (err) {
    await logApiError("cron/sync-school-holidays", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const due = families.filter(({ setting }) => isDue(setting, now));
  const counts = { due: due.length, synced: 0, failed: 0, skipped: 0 };
  for (const { familyId } of due) {
    // One family's error -- a database hiccup syncFamily did not catch --
    // never stops the run for the families after it.
    try {
      const outcome = await syncFamily(familyId, deps);
      if (outcome.status === "synced") counts.synced++;
      else if (outcome.status === "failed") counts.failed++;
      else counts.skipped++;
    } catch (err) {
      counts.failed++;
      await logApiError(`cron/sync-school-holidays family ${familyId}`, err);
    }
  }
  if (counts.due > 0) console.log(`[sync-school-holidays] ${JSON.stringify(counts)}`);
  return NextResponse.json({ ...counts, timestamp: now.toISOString() });
}
