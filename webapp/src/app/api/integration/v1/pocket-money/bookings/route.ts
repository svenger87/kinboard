import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import {
  findStoredResult, fingerprintRequest, storeResult, validateIdempotencyKey,
} from "@/lib/integration-idempotency";
import { liveBookingRequestDeps, requestPocketMoneyBooking } from "@/lib/integration-pocket-money";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/v1/pocket-money/bookings
 * `{ person_id, amount, type: deposit|withdrawal, note? }`
 *
 * Asks the family to allow a pocket-money booking (RFC-012 §3). Nothing is
 * booked here: the request waits on every Kinboard screen until a family
 * member allows it with the settings PIN, denies it, or two minutes pass —
 * 202 `pending_confirmation`, followed at `GET /actions/{id}`. The same
 * limits as a home confirmation (at most 2 waiting, 5 per 10 minutes per
 * assistant). lib/integration-pocket-money.ts has the checks.
 *
 * Idempotency as in `calendar/events` POST: the key is required, a replay
 * answers the same request, and only a 202 is remembered — a refusal may be
 * retried with the same key once corrected.
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
      const hash = fingerprintRequest("pocket-money/bookings", body);
      const previous = await findStoredResult(context.familyId, key.key);
      if (previous) {
        if (previous.request_hash !== hash) {
          return NextResponse.json({ error: "Idempotency-Key reused with different arguments", code: "conflict" }, { status: 409 });
        }
        return NextResponse.json(previous.response, { status: previous.status, headers: { "idempotent-replay": "true" } });
      }

      const result = await requestPocketMoneyBooking(
        { familyId: context.familyId, tokenId: context.tokenId, clientName: context.name, body },
        liveBookingRequestDeps,
      );
      if (result.status === 202) {
        await storeResult({
          familyId: context.familyId, key: key.key, service: "pocket-money/bookings",
          requestHash: hash, status: result.status, response: result.body,
        });
      }
      return NextResponse.json(result.body, { status: result.status, headers: result.headers });
    } catch (err) {
      await logApiError("integration/pocket-money/bookings", err);
      return NextResponse.json({ error: "Could not ask for the booking", code: "internal_error" }, { status: 500 });
    }
  });
}
