import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import { familyTimeZone } from "@/lib/family-time";
import { getFamilyLocale } from "@/lib/family-locale";
import { readWeekSummary } from "@/lib/integration-week-summary";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/week-summary?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * "How did our week go?": per person the tasks done (whose turn it was
 * counts) and missed, the children's points earned and spent, each
 * creature's stage at the start and the end, the meals planned, the events
 * that took place, and the next 7 days' events, birthdays and countdowns in
 * brief. Both dates or neither; without them, the last 7 days up to today,
 * in the family's time zone (lib/integration-week-summary.ts).
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    const params = request.nextUrl.searchParams;
    try {
      const db = createAdminClient();
      const [timeZone, locale] = await Promise.all([
        familyTimeZone(context.familyId, db),
        getFamilyLocale(context.familyId, db),
      ]);
      const result = await readWeekSummary(
        context.familyId,
        { start: params.get("start"), end: params.get("end") },
        { db, timeZone, locale, now: new Date() },
      );
      return NextResponse.json(result.body, { status: result.status });
    } catch (err) {
      await logApiError("integration/week-summary", err);
      return NextResponse.json({ error: "Could not put the week's summary together", code: "internal_error" }, { status: 500 });
    }
  });
}
