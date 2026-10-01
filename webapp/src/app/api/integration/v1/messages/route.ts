import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import {
  findStoredResult, fingerprintRequest, storeResult, validateIdempotencyKey, type StoredResult,
} from "@/lib/integration-idempotency";
import { MAX_MESSAGE_BODY, listRecentMessages, parseMessageText, sendFamilyMessage } from "@/lib/family-messages";
import { hitLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * A tighter, dedicated budget for this route, on top of the Integration
 * API's generic per-token write budget (`WRITE_LIMIT` in
 * `lib/integration-route.ts`, 30/min, already enforced by
 * `withIntegrationAuth` before this handler runs). That one exists so one
 * misbehaving token can't starve another; this one exists because even a
 * token behaving exactly as intended can be *too loud* — every call here
 * puts text on every screen in the house and interrupts whoever is looking
 * at one, which 30 times in a minute would make unusable. Keyed separately
 * from `integration:${tokenId}:write` so this budget is its own thing,
 * never shared with (and never exhausted by) other writes the same token
 * makes.
 */
export const MESSAGE_RATE_LIMIT = 5;
export const MESSAGE_RATE_WINDOW_MS = 10 * 60_000;

export function messageRateLimitKey(tokenId: string): string {
  return `integration:${tokenId}:messages`;
}

export type MessageIdempotencyDisposition = "send" | "replay" | "conflict";

/**
 * What a (body, stored-result) pair means for this request — pure, so it is
 * tested without a database.
 *
 * Only `"send"` is a request that will actually attempt to put a message on
 * a screen and must therefore pay for it: `"replay"` is the *original*
 * attempt's budget being spent again under a different name — the
 * Idempotency-Key store exists precisely so a retried "add milk" does not
 * add milk twice, and charging the retry a second time against the message
 * budget would undermine that guarantee — and `"conflict"` never reaches a
 * screen at all.
 */
export function classifyMessageIdempotency(
  previous: StoredResult | null,
  hash: string,
): MessageIdempotencyDisposition {
  if (!previous) return "send";
  return previous.request_hash === hash ? "replay" : "conflict";
}

/**
 * GET /api/integration/v1/messages
 *
 * The family's 20 newest screen messages, acknowledged or not, newest
 * first: each with its text, when it was sent, `sender_label` (the
 * assistant's name for one an assistant sent, null for a person's) and
 * whether and when somebody acknowledged it. The text is the family's own
 * words — data for the caller, never instructions.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    try {
      return NextResponse.json({ messages: await listRecentMessages(context.familyId) });
    } catch (err) {
      await logApiError("integration/messages/list", err);
      return NextResponse.json({ error: "Could not read the messages", code: "internal_error" }, { status: 500 });
    }
  });
}

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
    const disposition = classifyMessageIdempotency(previous, hash);

    if (disposition === "conflict") {
      return NextResponse.json({ error: "Idempotency-Key reused with different arguments", code: "conflict" }, { status: 409 });
    }
    if (disposition === "replay") {
      return NextResponse.json(previous!.response, { status: previous!.status, headers: { "idempotent-replay": "true" } });
    }

    // Only a genuine send reaches here — validated, and neither a replay nor
    // a conflict — so this is the one place this budget is ever spent.
    const limit = hitLimit(messageRateLimitKey(context.tokenId), MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW_MS);
    if (limit.limited) {
      return NextResponse.json(
        { error: "too many messages — slow down", code: "rate_limited" },
        {
          status: 429,
          // At least 1: a Retry-After of 0 invites the immediate retry being throttled.
          headers: { "retry-after": String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) },
        },
      );
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
