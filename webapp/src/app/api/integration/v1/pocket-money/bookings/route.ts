import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import {
  fingerprintRequest, markBefore, rememberStoredRequest, validateIdempotencyKey, withIdempotency,
} from "@/lib/integration-idempotency";
import { BOOKING_SIDE_EFFECTS, liveBookingRequestDeps, requestPocketMoneyBooking } from "@/lib/integration-pocket-money";

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
 * answers the same request, and only a 202 — or the answer about a trusted
 * assistant's request that already ran — is remembered; a refusal may be
 * retried with the same key once corrected.
 * The key is reserved before anything runs (`withIdempotency`): a second
 * request with it while the first runs is 409 `in_progress`, and a result
 * that could not be written down keeps it taken, so a trusted assistant's
 * action never runs twice for one key.
 * A throw before the first side effect (`markBefore`) gives the key back;
 * one after it keeps it.
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
      // The key is reserved before anything runs: a trusted assistant's
      // request runs at once, so two requests with one key must not both run
      // it (lib/integration-idempotency.ts, withIdempotency).
      const result = await withIdempotency(
        { familyId: context.familyId, key: key.key, service: "pocket-money/bookings", requestHash: hash, remember: rememberStoredRequest },
        (markExecuting) => requestPocketMoneyBooking(
          { familyId: context.familyId, tokenId: context.tokenId, clientName: context.name, body },
          markBefore(liveBookingRequestDeps, BOOKING_SIDE_EFFECTS, markExecuting),
        ),
      );
      return NextResponse.json(result.body, { status: result.status, headers: result.headers });
    } catch (err) {
      await logApiError("integration/pocket-money/bookings", err);
      return NextResponse.json({ error: "Could not ask for the booking", code: "internal_error" }, { status: 500 });
    }
  });
}
