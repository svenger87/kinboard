import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { familyDateKey, familyTimeZone } from "@/lib/family-time";
import {
  findStoredResult, fingerprintRequest, storeResult, validateIdempotencyKey,
} from "@/lib/integration-idempotency";
import { addCountdown, listCountdowns } from "@/lib/countdowns";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/countdowns
 *
 * The countdowns the countdown widget shows — today's and later ones, the
 * soonest first — each with `days_until` from the family's today, in its
 * time zone. They live in the `countdowns` setting; lib/countdowns.ts.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    try {
      const today = familyDateKey(new Date(), await familyTimeZone(context.familyId));
      const countdowns = await listCountdowns(context.familyId, today);
      return NextResponse.json({ today, countdowns });
    } catch (err) {
      await logApiError("integration/countdowns/list", err);
      return NextResponse.json({ error: "Could not read the countdowns", code: "internal_error" }, { status: 500 });
    }
  });
}

/**
 * POST /api/integration/v1/countdowns
 *
 * Add a countdown as the widget does: `title` (at most 60 characters),
 * `date` as YYYY-MM-DD, today or later in the family's time zone, and an
 * optional `icon` from the widget's seven. A create, so an Idempotency-Key
 * is required. Written with optimistic concurrency against the setting's
 * `updated_at`, so this never overwrites a change made since it read the
 * list, and a countdown another assistant or token adds at the same moment
 * is kept; 409 only after the write has lost four times in a row. A
 * screen's own save is a plain overwrite of the list it holds, so a screen
 * saving a stale list can still drop this countdown (lib/countdowns.ts).
 */
export async function POST(request: NextRequest) {
  return withIntegrationAuth(request, "calendar:write", async (context) => {
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

    const hash = fingerprintRequest("countdowns.create", body);
    const previous = await findStoredResult(context.familyId, key.key);
    if (previous) {
      if (previous.request_hash !== hash) {
        return NextResponse.json({ error: "Idempotency-Key reused with different arguments", code: "conflict" }, { status: 409 });
      }
      return NextResponse.json(previous.response, { status: previous.status, headers: { "idempotent-replay": "true" } });
    }

    try {
      const today = familyDateKey(new Date(), await familyTimeZone(context.familyId));
      const result = await addCountdown(context.familyId, body, today);
      // A refusal (400) or a lost write (409) is not remembered against the key.
      if (result.status < 400) {
        await storeResult({
          familyId: context.familyId, key: key.key, service: "countdowns.create",
          requestHash: hash, status: result.status, response: result.response,
        });
      }
      return NextResponse.json(result.response, { status: result.status });
    } catch (err) {
      await logApiError("integration/countdowns/create", err);
      return NextResponse.json({ error: "Could not add the countdown", code: "internal_error" }, { status: 500 });
    }
  });
}
