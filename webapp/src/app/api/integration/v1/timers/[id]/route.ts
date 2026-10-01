import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { destructiveLimitResponse } from "@/lib/integration-limits";
import { logApiError } from "@/lib/api-error";
import { stopTimerForAssistant } from "@/lib/timers";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/integration/v1/timers/{id}
 *
 * Stop a timer: the same dismiss as the panel's — its queued push is
 * cancelled and the row is stamped `dismissed_at`, so it leaves every
 * screen. A timer that is missing, belongs to another family, or is already
 * dismissed answers 404.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withIntegrationAuth(request, "timers:write", async (context) => {
    const limited = destructiveLimitResponse(context);
    if (limited) return limited;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "no such timer", code: "not_found" }, { status: 404 });
    }

    try {
      const stopped = await stopTimerForAssistant(context.familyId, id);
      if (!stopped) {
        return NextResponse.json({ error: "no such timer", code: "not_found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, id });
    } catch (err) {
      await logApiError("integration/timers/stop", err);
      return NextResponse.json({ error: "Could not stop the timer", code: "internal_error" }, { status: 500 });
    }
  });
}
