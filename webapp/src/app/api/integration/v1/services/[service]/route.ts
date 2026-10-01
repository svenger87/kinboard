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

function optionalText(value: unknown, max = 500): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, max);
}

const SERVICES: Record<string, ServiceDef> = {
  add_shopping_item: {
    scope: "shopping:write",
    handle: async ({ familyId, body, db }) => {
      const name = text(body.name, 200);
      if (!name) {
        return { status: 400, response: { error: "`name` is required", code: "invalid_request" } };
      }

      const { data, error } = await db
        .from("shopping_items")
        .insert({ family_id: familyId, name })
        .select("id")
        .single();

      if (error) throw error;
      return { status: 201, response: { id: data.id, name } };
    },
  },

  create_task: {
    scope: "tasks:write",
    handle: async ({ familyId, body, db }) => {
      const title = text(body.title, 300);
      if (!title) {
        return { status: 400, response: { error: "`title` is required", code: "invalid_request" } };
      }

      // due_at in the contract is a date for a to-do; the column is a date.
      const due = optionalText(body.due_at, 40);
      const dueDate = due ? due.slice(0, 10) : null;
      if (due !== undefined && due !== null && !/^\d{4}-\d{2}-\d{2}/.test(due)) {
        return {
          status: 400,
          response: { error: "`due_at` must start with YYYY-MM-DD", code: "invalid_request" },
        };
      }

      const { data, error } = await db
        .from("todos")
        .insert({
          family_id: familyId,
          title,
          completed: false,
          ...(dueDate ? { due_date: dueDate } : {}),
          ...(typeof body.person_id === "string" ? { person_id: body.person_id } : {}),
        })
        .select("id")
        .single();

      if (error) throw error;
      return { status: 201, response: { id: data.id, title } };
    },
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
   * Money, so it follows the app's own deposit path rather than inventing a
   * second one: insert a transaction AND move the balance, and bump
   * lifetime_saved_cents only for genuine earnings, because that field drives
   * the child's avatar tier. A service that only wrote the transaction would
   * leave the balance stale and the avatar wrong, and nothing would complain.
   */
  add_pocket_money: {
    scope: "tasks:write",
    handle: async ({ familyId, body, db }) => {
      // RFC-001 §5.2 names the arguments `person_id, amount, reason`, and that
      // is what the Home Assistant component sends. This handler first shipped
      // reading `person` (a name) and `note`, so every call from Home Assistant
      // was a 400. The RFC names come first; the old ones stay accepted for
      // anything already written against them.
      const personId = text(body.person_id, 100);
      const personName = personId ? null : text(body.person, 200);
      const amount = typeof body.amount === "number" ? body.amount : null;
      if (
        (!personId && !personName) ||
        amount === null ||
        !Number.isFinite(amount) ||
        amount === 0
      ) {
        return {
          status: 400,
          response: {
            error: "`person_id` (or `person`, a name) and a non-zero `amount` are required",
            code: "invalid_request",
          },
        };
      }
      // Currency units in, cents stored. An automation saying `amount: 2.50`
      // means €2.50; making callers send 250 would guarantee somebody one day
      // credits a child two hundred and fifty euros.
      const cents = Math.round(amount * 100);

      const { data: people } = await db
        .from("people")
        .select("id, name")
        .eq("family_id", familyId)
        .is("deleted_at", null);

      // Matching against this family's living people is the family check for
      // `person_id` as well as the lookup for `person`: an id from another
      // family, or of someone in the recycle bin, is simply not in the list.
      const candidates = (people ?? []) as { id: string; name: string }[];
      const match = personId
        ? candidates.find((candidate) => candidate.id === personId)
        : candidates.find(
            (candidate) => candidate.name.toLowerCase() === personName!.toLowerCase()
          );
      if (!match) {
        return {
          status: 404,
          response: {
            error: personId ? `No person with id ${personId}` : `No person called ${personName}`,
            code: "not_found",
          },
        };
      }

      const { data: account } = await db
        .from("pocket_money_accounts")
        .select("id, balance_cents, lifetime_saved_cents")
        .eq("family_id", familyId)
        .eq("person_id", match.id)
        .maybeSingle();
      if (!account) {
        return {
          status: 404,
          response: { error: `${match.name} has no pocket money account`, code: "not_found" },
        };
      }

      const newBalance = account.balance_cents + cents;
      if (newBalance < 0) {
        return { status: 400, response: { error: "insufficient_funds", code: "invalid_request" } };
      }

      const type = cents > 0 ? "manual_deposit" : "withdrawal";
      const { error: txnError } = await db
        .from("pocket_money_transactions")
        .insert({
          account_id: account.id,
          amount_cents: cents,
          type,
          note: text(body.reason, 200) ?? text(body.note, 200) ?? "Home Assistant",
        });
      if (txnError) {
        return { status: 500, response: { error: "Could not record the transaction" } };
      }

      const update: Record<string, number> = { balance_cents: newBalance };
      if (cents > 0) {
        update.lifetime_saved_cents = (account.lifetime_saved_cents ?? 0) + cents;
      }
      await db
        .from("pocket_money_accounts")
        .update(update)
        .eq("id", account.id);

      return {
        status: 201,
        response: { person_id: match.id, person: match.name, amount, balance: newBalance / 100 },
      };
    },
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
