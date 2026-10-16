import { NextRequest, NextResponse } from "next/server";
import { logApiError } from "@/lib/api-error";
import { autoSyncFamilies, syncBringFamily } from "@/lib/bring-sync";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Reads each family's selected Bring! list into its shopping list (#407):
 * every family that is connected, has a list picked and has "Auto sync" on.
 * ofelia runs it every two minutes, the interval Settings → Bring! promises.
 * One family at a time; one family's failure never stops the run.
 */
export async function POST(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let families: string[];
  try {
    families = await autoSyncFamilies();
  } catch (err) {
    await logApiError("cron/sync-bring", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const counts = { families: families.length, synced: 0, failed: 0, skipped: 0, added: 0, updated: 0, pushed: 0 };
  for (const familyId of families) {
    try {
      const outcome = await syncBringFamily(familyId);
      if (outcome.status === "synced") {
        counts.synced++;
        counts.added += outcome.added;
        counts.updated += outcome.updated;
        counts.pushed += outcome.pushed + outcome.removed;
      } else {
        counts.skipped++;
      }
    } catch (err) {
      counts.failed++;
      console.error(`[sync-bring] family ${familyId}: ${(err as Error)?.message ?? String(err)}`);
    }
  }
  if (counts.added > 0 || counts.updated > 0 || counts.pushed > 0 || counts.failed > 0) {
    console.log(`[sync-bring] ${JSON.stringify(counts)}`);
  }
  return NextResponse.json({ ...counts, timestamp: new Date().toISOString() });
}
