import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import type { IntegrationScope } from "@/lib/integration-auth";
import {
  findStoredResult,
  fingerprintRequest,
  storeResult,
  validateIdempotencyKey,
} from "@/lib/integration-idempotency";
import { addShoppingItemFromText } from "@/lib/shopping-enrich";
import { createServiceTask } from "@/lib/integration-tasks";
import { addPocketMoneyService } from "@/lib/pocket-money/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/v1/services/<name>
 *
 * The write half of the Integration API. One route dispatching by name rather
 * than a file per service: the services share their entire shape — authorise,
 * check idempotency, validate, insert, remember — and the only thing that
 * differs is the last two steps. Split across eight files, the shared part is
 * eight copies that drift.
 *
 * Names and arguments are the contract frozen in RFC-001 §5.2 and mirrored in
 * the Home Assistant component's const.py.
 */

type Handler = (args: {
  familyId: string;
  body: Record<string, unknown>;
  /** An OAuth-issued (assistant) token, not one made by hand in Settings. */
  assistant: boolean;
  // The service-role client, passed in rather than created in each handler so
  // a spec can hand the real handler a recording stand-in and send it exactly
  // what Home Assistant sends. Untyped, like the admin client everywhere else.
  db: any;
}) => Promise<{ status: number; response: Record<string, unknown> }>;

interface ServiceDef {
  scope: IntegrationScope;
  handle: Handler;
}

/** Trim, reject empty, and bound — free text reaching a database column. */
function text(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Exported for the spec, which calls a service's handler directly. */
export const SERVICES: Record<string, ServiceDef> = {
  add_shopping_item: {
    scope: "shopping:write",
    handle: async ({ familyId, body }) => {
      const name = text(body.name, 200);
      if (!name) {
        return { status: 400, response: { error: "`name` is required", code: "invalid_request" } };
      }

      // Parsed, categorised, pictured and pushed to Bring! the way the
      // shopping page does it (lib/shopping-enrich.ts); `name` in the answer
      // is the name as stored.
      const { id, item } = await addShoppingItemFromText(familyId, name);
      return { status: 201, response: { id, name: item.name } };
    },
  },

  create_task: {
    scope: "tasks:write",
    // A string person_id must name a person of this family; see
    // createServiceTask for why the contract's other fields are unchanged.
    handle: ({ familyId, body, db }) => createServiceTask(db, familyId, body),
  },

  create_note: {
    scope: "notes:write",
    handle: async ({ familyId, body, db }) => {
      const content = text(body.text, 2000);
      if (!content) {
        return { status: 400, response: { error: "`text` is required", code: "invalid_request" } };
      }

      const { data, error } = await db
        .from("notes")
        .insert({ family_id: familyId, content })
        .select("id")
        .single();

      if (error) throw error;
      return { status: 201, response: { id: data.id } };
    },
  },

  /**
   * RFC-001's pocket-money service, for Home Assistant: books at once.
   * Assistants (OAuth-issued tokens) are refused — lib/pocket-money/service.ts.
   */
  add_pocket_money: {
    scope: "tasks:write",
    handle: ({ familyId, body, assistant, db }) =>
      addPocketMoneyService({ familyId, body, assistant }, db),
  },

  /**
   * Silence one of the Heute-Motor's hints from an automation.
   *
   * Acknowledges rather than resolves, exactly as the button on the board
   * does: whether the situation is still true is the evaluator's judgement,
   * not the caller's.
   */
  dismiss_attention: {
    scope: "tasks:write",
    handle: async ({ familyId, body, db }) => {
      // RFC-001 §5.2 calls the argument `attention_id`, and that is what the
      // Home Assistant component sends; this handler first shipped reading only
      // `key` and `rule_id`, so every call from Home Assistant was a 400.
      // `attention_id` means the item key, as `key` does. A row id is accepted
      // too, because "id" invites one — still only within this family.
      const attentionId = text(body.attention_id, 200);
      const key = attentionId ? null : text(body.key, 200);
      const ruleId = attentionId || key ? null : text(body.rule_id, 100);

      if (!attentionId && !key && !ruleId) {
        return {
          status: 400,
          response: {
            error: "`attention_id` is required (or the older `key` or `rule_id`)",
            code: "invalid_request",
          },
        };
      }

      let query = db
        .from("attention_items")
        .update({ state: "acknowledged", acted_at: new Date().toISOString() })
        .eq("family_id", familyId)
        .is("resolved_at", null)
        .eq("state", "active");

      if (attentionId) {
        // Only a value shaped like a UUID may reach the `or` filter: it is
        // interpolated into PostgREST's filter syntax, where a comma or a
        // parenthesis in free text would change the filter's meaning.
        query = UUID.test(attentionId)
          ? query.or(`item_key.eq.${attentionId},id.eq.${attentionId}`)
          : query.eq("item_key", attentionId);
      } else {
        query = key ? query.eq("item_key", key) : query.eq("rule_id", ruleId);
      }

      const { data, error } = await query.select("item_key");
      if (error) {
        return { status: 500, response: { error: "Could not dismiss" } };
      }
      return {
        status: 200,
        response: { dismissed: (data ?? []).length, keys: (data ?? []).map((r: { item_key: string }) => r.item_key) },
      };
    },
  },

  /**
   * Re-evaluate now instead of waiting for the next five-minute tick.
   *
   * For the case where an automation has just changed something the board
   * reasons about — added a task, moved an appointment — and the family is
   * standing in front of the display.
   */
  refresh_integration: {
    scope: "family:read",
    handle: async ({ familyId }) => {
      const { runAttentionForFamily } = await import("@/lib/attention/runner");
      const result = await runAttentionForFamily(familyId);
      return { status: 200, response: { ...result } };
    },
  },
};

/**
 * Services named in RFC-001 §5.2 whose feature does not exist yet.
 *
 * Listed rather than omitted, and answered 501 rather than 404, so the
 * difference between "you typed it wrong" and "not built yet" is visible to
 * someone writing an automation. Silently 404-ing a name that is in the
 * published contract would send them looking for a typo that isn't there.
 */
const NOT_YET_IMPLEMENTED = new Set([
  // Announcements do not exist in Kinboard yet, and activate_context needs a
  // manual override of the day context that nothing can currently store.
  // Both stay listed and answer 501 rather than 404, so a caller can tell a
  // typo from a feature that has not shipped.
  "show_announcement",
  "activate_context",
]);

/** Exposed so a spec can drive a handler with the exact payload a client sends. */
export const SERVICE_HANDLERS: Record<string, Handler> = Object.fromEntries(
  Object.entries(SERVICES).map(([name, def]) => [name, def.handle]),
);

/** Exposed so the OpenAPI contract test can check the spec against reality. */
export const IMPLEMENTED_SERVICES = Object.keys(SERVICES);
export const DEFERRED_SERVICES = [...NOT_YET_IMPLEMENTED];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ service: string }> },
) {
  const { service } = await params;
  const def = SERVICES[service];

  // Unknown and unimplemented services still authenticate first. Answering
  // before the token is checked would let an anonymous caller enumerate which
  // services this instance supports.
  const scope: IntegrationScope = def?.scope ?? "family:read";

  return withIntegrationAuth(request, scope, async (context) => {
    if (!def) {
      const known = NOT_YET_IMPLEMENTED.has(service);
      return NextResponse.json(
        {
          error: known
            ? `\`${service}\` is part of the API but not implemented yet`
            : `unknown service \`${service}\``,
          code: known ? "not_implemented" : "not_found",
        },
        { status: known ? 501 : 404 },
      );
    }

    const key = validateIdempotencyKey(request.headers.get("idempotency-key"));
    if (!key.ok) {
      return NextResponse.json(
        {
          error:
            key.reason === "missing"
              ? "an Idempotency-Key header is required on writes"
              : `Idempotency-Key is ${key.reason.replace("_", " ")}`,
          code: "invalid_request",
        },
        { status: 400 },
      );
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      body = {};
    }

    const requestHash = fingerprintRequest(service, body);

    const previous = await findStoredResult(context.familyId, key.key);
    if (previous) {
      // Same key, different arguments: two different operations sharing one
      // key. Returning the first response would silently discard this request,
      // so say so instead.
      if (previous.request_hash !== requestHash) {
        return NextResponse.json(
          {
            error: "this Idempotency-Key was already used with different arguments",
            code: "conflict",
          },
          { status: 409 },
        );
      }
      return NextResponse.json(previous.response, {
        status: previous.status,
        headers: { "idempotent-replay": "true" },
      });
    }

    try {
      const result = await def.handle({
        familyId: context.familyId,
        body,
        assistant: context.assistant,
        db: createAdminClient(),
      });

      // Only successful work is remembered. A 400 is a client mistake, and
      // replaying it would mean a corrected retry with the same key kept
      // getting the old error.
      if (result.status < 400) {
        await storeResult({
          familyId: context.familyId,
          key: key.key,
          service,
          requestHash,
          status: result.status,
          response: result.response,
        });
      }

      return NextResponse.json(result.response, { status: result.status });
    } catch (err) {
      await logApiError(`integration/services/${service}`, err);
      return NextResponse.json(
        { error: "the service call failed", code: "internal_error" },
        { status: 500 },
      );
    }
  });
}
