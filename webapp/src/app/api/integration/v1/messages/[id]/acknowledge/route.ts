import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { destructiveLimitResponse } from "@/lib/integration-limits";
import { logApiError } from "@/lib/api-error";
import { acknowledgeMessage } from "@/lib/family-messages";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/v1/messages/{id}/acknowledge
 *
 * "Got it" on a screen message, from an assistant — `announcements:write`.
 * Writes the same columns as a tap on a screen, so the takeover closes
 * everywhere over realtime. First tap wins: a message somebody already
 * acknowledged is answered 200 with that acknowledgement and
 * `already_acknowledged: true`, unchanged. Not a create, so no
 * Idempotency-Key is needed — doing it twice changes nothing — but it is a
 * change to the family's data and spends the assistant edit budget.
 * A message that is missing or another family's is 404
 * (lib/family-messages.ts scopes every statement itself).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withIntegrationAuth(request, "announcements:write", async (context) => {
    const limited = destructiveLimitResponse(context);
    if (limited) return limited;

    try {
      const result = await acknowledgeMessage(context.familyId, id);
      if (!result) {
        return NextResponse.json({ error: "no such message", code: "not_found" }, { status: 404 });
      }
      return NextResponse.json(result);
    } catch (err) {
      await logApiError("integration/messages/acknowledge", err);
      return NextResponse.json({ error: "Could not acknowledge the message", code: "internal_error" }, { status: 500 });
    }
  });
}
