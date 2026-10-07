import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { acknowledgeMessage, isTrustNotice } from "@/lib/family-messages";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/v1/messages/{id}/acknowledge
 *
 * "Got it" on a screen message, from an assistant — `announcements:write`.
 * Writes the same columns as a tap on a screen, so the takeover closes
 * everywhere over realtime. First tap wins: a message somebody already
 * acknowledged is answered 200 with that acknowledgement and
 * `already_acknowledged: true`, unchanged. Not a create, so no
 * Idempotency-Key is needed — doing it twice changes nothing. Saying "seen"
 * removes nothing, so it does not spend the assistant edit/delete budget;
 * the token's generic write budget still applies.
 * A message that is missing or another family's is 404
 * (lib/family-messages.ts scopes every statement itself). The notice of an
 * action a trusted assistant ran without confirmation is 403: a person
 * acknowledges that one.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withIntegrationAuth(request, "announcements:write", async (context) => {
    try {
      // The notice of an action a trusted assistant ran is the family's to
      // acknowledge; no assistant clears it.
      if (await isTrustNotice(context.familyId, id)) {
        return NextResponse.json(
          { error: "This message records an action an assistant ran without confirmation. Only a person can acknowledge it, on a Kinboard screen.", code: "forbidden" },
          { status: 403 },
        );
      }
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
