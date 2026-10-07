import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import {
  findStoredResult, fingerprintRequest, storeResult, validateIdempotencyKey,
} from "@/lib/integration-idempotency";
import { liveRewardDecisionDeps, requestRewardDecision } from "@/lib/integration-reward-decisions";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/v1/rewards/requests/{id}/decision  `{ decision: approve|decline }`
 *
 * Asks a parent to confirm a decision on a child's reward request ({id} from
 * GET /rewards' `pending`). Nothing is decided here: the request waits on
 * every Kinboard screen until a family member allows it with the settings
 * PIN, denies it, or two minutes pass -- 202 `pending_confirmation`, followed
 * at `GET /actions/{id}`. Allowing it decides the reward on the server as a
 * parent's own Approve or Deny would (lib/home/action-requests.ts). The same
 * limits as any confirmation (at most 2 waiting, 5 per 10 minutes per
 * assistant). lib/integration-reward-decisions.ts has the checks.
 *
 * pocket_money:write, the scope that already asks for a reward and a
 * booking: the same risk -- it only asks, and a parent decides with the PIN
 * -- so no assistant has to be connected again.
 *
 * Idempotency as in `pocket-money/bookings`: the key is required, a replay
 * answers the same request, and only a 202 is remembered.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withIntegrationAuth(request, "pocket_money:write", async (context) => {
    const key = validateIdempotencyKey(request.headers.get("idempotency-key"));
    if (!key.ok) {
      return NextResponse.json({ error: "An Idempotency-Key is required", code: "invalid_request" }, { status: 400 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    try {
      const hash = fingerprintRequest("rewards/requests/decision", { id, body });
      const previous = await findStoredResult(context.familyId, key.key);
      if (previous) {
        if (previous.request_hash !== hash) {
          return NextResponse.json({ error: "Idempotency-Key reused with different arguments", code: "conflict" }, { status: 409 });
        }
        return NextResponse.json(previous.response, { status: previous.status, headers: { "idempotent-replay": "true" } });
      }

      const result = await requestRewardDecision(
        { familyId: context.familyId, tokenId: context.tokenId, clientName: context.name, redemptionId: id, body },
        liveRewardDecisionDeps,
      );
      if (result.status === 202) {
        await storeResult({
          familyId: context.familyId, key: key.key, service: "rewards/requests/decision",
          requestHash: hash, status: result.status, response: result.body,
        });
      }
      return NextResponse.json(result.body, { status: result.status, headers: result.headers });
    } catch (err) {
      await logApiError("integration/rewards/decision", err);
      return NextResponse.json({ error: "Could not ask for the decision", code: "internal_error" }, { status: 500 });
    }
  });
}
