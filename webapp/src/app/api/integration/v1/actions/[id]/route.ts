import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { getTranslator } from "@/lib/notifications/messages";
import {
  ACTION_STATUS_SCOPES, actionRequestStatus, toAssistantStatus, type ActionTranslator,
} from "@/lib/home/action-requests";
import { liveActionStore } from "@/lib/home/action-requests-live";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/actions/{id}
 *
 * The outcome of any request this assistant left waiting for a family
 * member's confirmation — a sensitive home action or a pocket-money booking:
 * pending, approved, denied, expired, done or failed, with `kind` and the
 * request in words (`description`). Only the calling token's own requests —
 * another assistant's, even in the same family, and another family's are the
 * same 404 as one that does not exist. A pending request past its expiry is
 * marked expired on the way. `/home/actions/{id}` stays as it was for home
 * requests.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withIntegrationAuth(request, ACTION_STATUS_SCOPES, async (context) => {
    try {
      const row = await actionRequestStatus(
        { id, familyId: context.familyId, tokenId: context.tokenId },
        { store: liveActionStore },
      );
      if (!row) return NextResponse.json({ error: "No such action request", code: "not_found" }, { status: 404 });
      const t = getTranslator("en", "assistantActions") as unknown as ActionTranslator;
      return NextResponse.json({ action: toAssistantStatus(row, t) });
    } catch (err) {
      await logApiError("integration/actions", err);
      return NextResponse.json({ error: "Could not read the action request", code: "internal_error" }, { status: 500 });
    }
  });
}
