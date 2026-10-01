import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { destructiveLimitResponse } from "@/lib/integration-limits";
import { logApiError } from "@/lib/api-error";
import { deleteCountdown, isUuid } from "@/lib/countdowns";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/integration/v1/countdowns/{id}
 *
 * Take one countdown off the widget, as its bin button does —
 * `calendar:write`, behind the assistant edit/delete budget like every other
 * Integration API delete. Countdowns have no recycle bin. An id that is not
 * in this family's list is 404; lib/countdowns.ts makes the admin client
 * and scopes every statement itself, with the same optimistic write as
 * adding one.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withIntegrationAuth(request, "calendar:write", async (context) => {
    const limited = destructiveLimitResponse(context);
    if (limited) return limited;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "no such countdown", code: "not_found" }, { status: 404 });
    }

    try {
      const result = await deleteCountdown(context.familyId, id);
      return NextResponse.json(result.response, { status: result.status });
    } catch (err) {
      await logApiError("integration/countdowns/delete", err);
      return NextResponse.json({ error: "Could not delete the countdown", code: "internal_error" }, { status: 500 });
    }
  });
}
