import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import {
  fingerprintRequest, rememberHomeAction, markBefore, validateIdempotencyKey, withIdempotency,
} from "@/lib/integration-idempotency";
import { HOME_SIDE_EFFECTS, parseEntityParam, runHomeAction } from "@/lib/home/devices";
import { liveHomeDeps } from "@/lib/home/live";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/v1/home/devices/{entity}/actions  `{ service, data? }`
 *
 * Runs an allowed action on a catalogue device (RFC-011 §4). The order —
 * catalogue, allowlist, live state read, decision with the live
 * `device_class`, then call or confirmation — and why it is fail-closed at
 * every step is documented in `lib/home/devices.ts`, which holds all of it.
 *
 * Sensitive actions answer 202 `pending_confirmation` and do not run until
 * a family member approves them on a Kinboard screen with the settings PIN
 * (RFC-011 §4.3); the assistant follows them at `GET /home/actions/{id}`.
 *
 * Idempotency as in `calendar/events` POST. The entity is part of the
 * fingerprint, so a key reused for another device is a conflict, and only a
 * completed (200) or accepted (202) result is remembered, and a 502 (Home
 * Assistant was called and did not confirm: it may have happened) — any other
 * failure may be retried with the same key.
 * The key is reserved before anything runs (`withIdempotency`): a second
 * request with it while the first runs is 409 `in_progress`, and a result
 * that could not be written down keeps it taken, so a trusted assistant's
 * action never runs twice for one key.
 * A throw before the first side effect (`markBefore`) gives the key back;
 * one after it keeps it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entity: string }> },
) {
  const { entity } = await params;
  return withIntegrationAuth(request, "home:control", async (context) => {
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
      const hash = fingerprintRequest(`home/devices/${parseEntityParam(entity) ?? ""}/actions`, body);
      // The key is reserved before anything runs: a trusted assistant's
      // request runs at once, so two requests with one key must not both run
      // it (lib/integration-idempotency.ts, withIdempotency).
      const result = await withIdempotency(
        { familyId: context.familyId, key: key.key, service: "home/devices/actions", requestHash: hash, remember: rememberHomeAction },
        (markExecuting) => runHomeAction(
          { familyId: context.familyId, tokenId: context.tokenId, tokenName: context.name, rawEntity: entity, body },
          markBefore(liveHomeDeps, HOME_SIDE_EFFECTS, markExecuting),
        ),
      );
      return NextResponse.json(result.body, { status: result.status, headers: result.headers });
    } catch (err) {
      await logApiError("integration/home/devices/actions", err);
      return NextResponse.json({ error: "Could not run the action", code: "internal_error" }, { status: 500 });
    }
  });
}
