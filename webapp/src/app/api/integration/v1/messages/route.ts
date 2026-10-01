import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import {
  findStoredResult, fingerprintRequest, storeResult, validateIdempotencyKey,
} from "@/lib/integration-idempotency";
import { MAX_MESSAGE_BODY, parseMessageText, sendFamilyMessage } from "@/lib/family-messages";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/v1/messages
 *
 * Puts text on every Kinboard screen and pushes it to every phone — the
 * assistant equivalent of a person typing into the message bar
 * (`POST /api/messages`). Both routes share `sendFamilyMessage`
 * (`lib/family-messages.ts`), so the insert and the push are byte-for-byte
 * the same either way; only the sender differs. An assistant has no device
 * of its own, so `senderDeviceId` is `null` — nothing is excluded from the
 * push, it reaches every device in the family — and the token's own name
 * (`context.name`) is passed as `senderLabel` so the push names the
 * assistant instead of showing the generic title a person's own message
 * gets.
 *
 * `show_announcement`, the RFC-001 §5.2 service name for this, stays a 501
 * in `/services/{service}` — its signature there is a different shape
 * (`message`, not `text`) and this route is the one the MCP tool and the
 * OpenAPI spec point to.
 */
export async function POST(request: NextRequest) {
  return withIntegrationAuth(request, "announcements:write", async (context) => {
    const key = validateIdempotencyKey(request.headers.get("idempotency-key"));
    if (!key.ok) {
      return NextResponse.json({ error: "An Idempotency-Key is required", code: "invalid_request" }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    const text = parseMessageText(body.text);
    if (!text.ok) {
      return NextResponse.json(
        { error: `\`text\` must be 1-${MAX_MESSAGE_BODY} characters`, code: "invalid_request" },
        { status: 400 },
      );
    }

    const hash = fingerprintRequest("messages", body);
    const previous = await findStoredResult(context.familyId, key.key);
    if (previous) {
      if (previous.request_hash !== hash) {
        return NextResponse.json({ error: "Idempotency-Key reused with different arguments", code: "conflict" }, { status: 409 });
      }
      return NextResponse.json(previous.response, { status: previous.status, headers: { "idempotent-replay": "true" } });
    }

    try {
      const result = await sendFamilyMessage({
        familyId: context.familyId,
        body: text.value!,
        senderDeviceId: null,
        senderLabel: context.name,
      });
      if (!result.ok) {
        return NextResponse.json({ error: "Could not send the message", code: "internal_error" }, { status: 500 });
      }

      const response = { id: result.message.id };
      await storeResult({ familyId: context.familyId, key: key.key, service: "messages", requestHash: hash, status: 201, response });
      return NextResponse.json(response, { status: 201 });
    } catch (err) {
      await logApiError("integration/messages/create", err);
      return NextResponse.json({ error: "Could not send the message", code: "internal_error" }, { status: 500 });
    }
  });
}
