import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { destructiveLimitResponse } from "@/lib/integration-limits";
import { createAdminClient } from "@/lib/supabase/server";
import {
  findStoredResult, fingerprintRequest, storeResult, validateIdempotencyKey,
} from "@/lib/integration-idempotency";
import { requestReward } from "@/lib/integration-rewards";
import { liveRewardNotifier } from "@/lib/notifications/rewards";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/v1/rewards/requests  `{ child, reward }`
 *
 * Asks for a reward for a child, exactly as the child's own "Redeem" does: a
 * pending request, held against their points, that a parent approves or
 * denies on Kinboard with the settings PIN. Nothing here can approve one.
 * `child` is a person_id or a child's name, `reward` a reward's id or title
 * (GET /rewards); 201 with the request, which also reaches the parents'
 * phones.
 *
 * pocket_money:write, the scope that already asks for a pocket-money booking:
 * the same risk -- it only asks, and a parent decides with the PIN -- so an
 * assistant needs no new permission (and no reconnect) for it.
 *
 * An assistant's calls count against its 30 edits per 10 minutes
 * (lib/integration-limits.ts): each request is a push to every parent. A
 * replay of an earlier call with the same key is answered first and costs
 * nothing. A
 * token made by hand (Home Assistant) is not limited beyond the generic 30
 * writes a minute; its requests are bounded by the child's points anyway.
 *
 * Idempotency as in `pocket-money/bookings`: the key is required, a replay
 * answers the same request, and only a 201 is remembered.
 */
export async function POST(request: NextRequest) {
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
      const hash = fingerprintRequest("rewards/requests", body);
      const previous = await findStoredResult(context.familyId, key.key);
      if (previous) {
        if (previous.request_hash !== hash) {
          return NextResponse.json({ error: "Idempotency-Key reused with different arguments", code: "conflict" }, { status: 409 });
        }
        return NextResponse.json(previous.response, { status: previous.status, headers: { "idempotent-replay": "true" } });
      }
      // Spent only now: a replay asks for nothing new, so it costs nothing.
      const limited = destructiveLimitResponse(context);
      if (limited) return limited;

      const db = createAdminClient() as any;
      const result = await requestReward({ familyId: context.familyId, body }, { db, notifier: liveRewardNotifier(db) });
      if (result.status === 201) {
        await storeResult({
          familyId: context.familyId, key: key.key, service: "rewards/requests",
          requestHash: hash, status: result.status, response: result.body,
        });
      }
      return NextResponse.json(result.body, { status: result.status });
    } catch (err) {
      await logApiError("integration/rewards/requests", err);
      return NextResponse.json({ error: "Could not ask for the reward", code: "internal_error" }, { status: 500 });
    }
  });
}
