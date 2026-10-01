import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { actionRequestStatus, toAssistantRequest } from "@/lib/home/action-requests";
import { liveActionStore } from "@/lib/home/action-requests-live";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/home/actions/{id}
 *
 * The outcome of a sensitive action this assistant asked for (RFC-011 §4.3):
 * pending, approved, denied, expired, done or failed, with Home Assistant's
 * HTTP status once it ran. Only the calling token's own requests — another
 * assistant's, even in the same family, is the same 404 as one that does not
 * exist. A pending request past its expiry is marked expired on the way.
 * Home requests only; `GET /actions/{id}` reads requests of every kind.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withIntegrationAuth(request, "home:control", async (context) => {
    try {
      const row = await actionRequestStatus(
        { id, familyId: context.familyId, tokenId: context.tokenId, kind: "home" },
        { store: liveActionStore },
      );
      if (!row) return NextResponse.json({ error: "No such action request", code: "not_found" }, { status: 404 });
      return NextResponse.json({ action: toAssistantRequest(row) });
    } catch (err) {
      await logApiError("integration/home/actions", err);
      return NextResponse.json({ error: "Could not read the action request", code: "internal_error" }, { status: 500 });
    }
  });
}
