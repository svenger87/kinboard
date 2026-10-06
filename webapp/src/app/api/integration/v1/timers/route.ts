import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import {
  findStoredResult, fingerprintRequest, storeResult, validateIdempotencyKey,
} from "@/lib/integration-idempotency";
import { MAX_ACTIVE_TIMERS, parseTimerInput, readActiveTimers, startIntegrationTimer } from "@/lib/timers";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/timers
 *
 * The family's kitchen timers that are still on the screens — running, or
 * ringing and not yet dismissed — each with its remaining seconds, the one
 * due soonest first.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    try {
      const timers = await readActiveTimers(context.familyId);
      return NextResponse.json({ timers });
    } catch (err) {
      await logApiError("integration/timers/list", err);
      return NextResponse.json({ error: "Could not read the timers", code: "internal_error" }, { status: 500 });
    }
  });
}

/**
 * POST /api/integration/v1/timers
 *
 * Start a kitchen timer on every screen, exactly as the panel does
 * (lib/timers.ts): the row, plus the queued push that announces its end.
 * `duration_seconds` 1–86400, `label` optional and at most 60 characters.
 * For an assistant's token (OAuth, `context.assistant`), refused with 429
 * `too_many_timers` once the family already has 10 timers running, paused
 * or ringing (RFC-012; a paused one counts) — counted across everyone's timers, so no migration is
 * needed to tell an assistant's from a person's, and leaving out any that
 * has rung for over an hour unanswered. A hand-made token (Home Assistant)
 * is not capped, as the panel is not. A create, so
 * an Idempotency-Key is required: a retried "set a ten-minute timer" must
 * not start two.
 */
export async function POST(request: NextRequest) {
  return withIntegrationAuth(request, "timers:write", async (context) => {
    const key = validateIdempotencyKey(request.headers.get("idempotency-key"));
    if (!key.ok) {
      return NextResponse.json({ error: "An Idempotency-Key is required", code: "invalid_request" }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : {};
    } catch {
      body = {};
    }

    const input = parseTimerInput(body);
    if (!input.ok) {
      return NextResponse.json({ error: input.error, code: "invalid_request" }, { status: 400 });
    }

    const hash = fingerprintRequest("timers.start", body);
    const previous = await findStoredResult(context.familyId, key.key);
    if (previous) {
      if (previous.request_hash !== hash) {
        return NextResponse.json({ error: "Idempotency-Key reused with different arguments", code: "conflict" }, { status: 409 });
      }
      return NextResponse.json(previous.response, { status: previous.status, headers: { "idempotent-replay": "true" } });
    }

    try {
      const outcome = await startIntegrationTimer(context.familyId, input.value, { capped: context.assistant });
      if (outcome.status === "too_many") {
        return NextResponse.json(
          {
            error: `The family already has ${outcome.active} timers running, paused or ringing; at most ${MAX_ACTIVE_TIMERS}. Stop one first.`,
            code: "too_many_timers",
          },
          { status: 429 },
        );
      }
      const response = { timer: outcome.timer };
      await storeResult({ familyId: context.familyId, key: key.key, service: "timers.start", requestHash: hash, status: 201, response });
      return NextResponse.json(response, { status: 201 });
    } catch (err) {
      await logApiError("integration/timers/start", err);
      return NextResponse.json({ error: "Could not start the timer", code: "internal_error" }, { status: 500 });
    }
  });
}
