import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { familyDateKey, familyTimeZone } from "@/lib/family-time";
import {
  findStoredResult, fingerprintRequest, storeResult, validateIdempotencyKey,
} from "@/lib/integration-idempotency";
import { createBirthday, listBirthdays } from "@/lib/integration-birthdays";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/birthdays
 *
 * The family's birthdays that are not in the recycle bin, the next one
 * first, each with the day it next falls on and, when the birth year is
 * known, the age now and the age it turns (lib/integration-birthdays.ts).
 * "Today" is the family's, in its time zone.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    try {
      const today = familyDateKey(new Date(), await familyTimeZone(context.familyId));
      const birthdays = await listBirthdays(context.familyId, today);
      return NextResponse.json({ today, birthdays });
    } catch (err) {
      await logApiError("integration/birthdays/list", err);
      return NextResponse.json({ error: "Could not read the birthdays", code: "internal_error" }, { status: 500 });
    }
  });
}

/**
 * POST /api/integration/v1/birthdays
 *
 * Add a birthday as the birthdays page does: `name` (at most 100
 * characters), `date` as YYYY-MM-DD with a birth year before this one, or
 * --MM-DD when the year is unknown or is this year,
 * optional `person_id` (a person of this family) and `notify_days_before`
 * 0..60 (default 7). A create, so an Idempotency-Key is required: a retried
 * "add Grandma's birthday" must not add it twice.
 */
export async function POST(request: NextRequest) {
  return withIntegrationAuth(request, "birthdays:write", async (context) => {
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

    const hash = fingerprintRequest("birthdays.create", body);
    const previous = await findStoredResult(context.familyId, key.key);
    if (previous) {
      if (previous.request_hash !== hash) {
        return NextResponse.json({ error: "Idempotency-Key reused with different arguments", code: "conflict" }, { status: 409 });
      }
      return NextResponse.json(previous.response, { status: previous.status, headers: { "idempotent-replay": "true" } });
    }

    try {
      const today = familyDateKey(new Date(), await familyTimeZone(context.familyId));
      const result = await createBirthday(context.familyId, body, today);
      // A refusal is a 400 and, like every 400, is not remembered against the key.
      if (result.status < 400) {
        await storeResult({
          familyId: context.familyId, key: key.key, service: "birthdays.create",
          requestHash: hash, status: result.status, response: result.response,
        });
      }
      return NextResponse.json(result.response, { status: result.status });
    } catch (err) {
      await logApiError("integration/birthdays/create", err);
      return NextResponse.json({ error: "Could not add the birthday", code: "internal_error" }, { status: 500 });
    }
  });
}
