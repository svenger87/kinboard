import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import { familyTimeZone } from "@/lib/family-time";
import { readHolidays } from "@/lib/integration-holidays";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/holidays?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * The family's school holidays and its region's public holidays over a
 * range, each once with its first and last day (lib/integration-holidays.ts).
 * Both dates or neither; without them, today and the next 12 months.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    const params = request.nextUrl.searchParams;
    try {
      const db = createAdminClient();
      const result = await readHolidays(
        context.familyId,
        { start: params.get("start"), end: params.get("end") },
        { db, timeZone: await familyTimeZone(context.familyId, db), now: new Date() },
      );
      return NextResponse.json(result.body, { status: result.status });
    } catch (err) {
      await logApiError("integration/holidays", err);
      return NextResponse.json({ error: "Could not read the holidays", code: "internal_error" }, { status: 500 });
    }
  });
}
