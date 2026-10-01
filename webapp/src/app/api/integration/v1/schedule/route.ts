import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { familyTimeZone } from "@/lib/family-time";
import { readSchedule } from "@/lib/integration-schedule";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/schedule?person_id=&day=YYYY-MM-DD
 *
 * The school timetable (RFC-012 §4), read only. Without `day`: each child's
 * lessons per weekday. With `day`: who has school on that date in the
 * family's time zone — `school_day: false` with `reason` `holiday` or
 * `weekend` when nobody does. `person_id` narrows it to one person.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    const params = request.nextUrl.searchParams;
    try {
      const result = await readSchedule(
        context.familyId,
        { personId: params.get("person_id"), day: params.get("day") },
        await familyTimeZone(context.familyId),
      );
      return NextResponse.json(result.body, { status: result.status });
    } catch (err) {
      await logApiError("integration/schedule", err);
      return NextResponse.json({ error: "Could not read the timetable", code: "internal_error" }, { status: 500 });
    }
  });
}
