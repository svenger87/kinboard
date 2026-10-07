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
import { hitLimit } from "@/lib/rate-limit";
import {
  SHOW_CAMERA_RATE_LIMIT,
  SHOW_CAMERA_RATE_WINDOW_MS,
  parseTakeoverDuration,
  readCameraRefs,
  resolveCamera,
  resolveTargetDevices,
} from "@/lib/camera-takeover";
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

type HandlerResult = { status: number; response: Record<string, unknown>; headers?: Record<string, string> };

type Handler = (args: {
  familyId: string;
  body: Record<string, unknown>;
  /** An OAuth-issued (assistant) token, not one made by hand in Settings. */
  assistant: boolean;
  // The service-role client, passed in rather than created in each handler so
  // a spec can hand the real handler a recording stand-in and send it exactly
  // what Home Assistant sends. Untyped, like the admin client everywhere else.
  db: any;
  /**
   * Spends one call of the service's own budget (`ServiceDef.rateLimit`) and
   * returns the 429 to answer with when it is used up, or null to go ahead.
   * A service with a budget calls it once it has validated the call and
   * before it writes anything, so a call that was going to be refused anyway
   * — a misspelt camera — doesn't use up the household's allowance. Absent
   * means no budget applies (a spec calling a handler directly).
   */
  admit?: () => HandlerResult | null;
}) => Promise<HandlerResult>;

interface ServiceDef {
  scope: IntegrationScope;
  handle: Handler;
  /**
   * A budget of its own on top of the per-token write limit, for a service
   * that interrupts the house rather than adding a row to a list. Only a call
   * that will actually run spends it: the handler spends it through `admit`
   * after validating, so a 400 doesn't, and a replay never reaches the
   * handler at all — the same rule as on messages.
   */
  rateLimit?: { limit: number; windowMs: number };
}

/**
 * The `admit` a handler is given: spends one call of `def.rateLimit` for this
 * token and service, or does nothing for a service without one. Exported for
 * the spec.
 */
export function serviceAdmission(def: ServiceDef, tokenId: string, service: string): () => HandlerResult | null {
  const budget = def.rateLimit;
  if (!budget) return () => null;
  return () => {
    const limit = hitLimit(`integration:${tokenId}:service:${service}`, budget.limit, budget.windowMs);
    if (!limit.limited) return null;
    return {
      status: 429,
      response: { error: `too many \`${service}\` calls — slow down`, code: "rate_limited" },
      // At least 1: a Retry-After of 0 invites the immediate retry being throttled.
      headers: { "retry-after": String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) },
    };
  };
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
      // is the name as stored. Already on the list, unticked: merged into
      // that item, 200 and `merged: true`.
      const { merged, item } = await addShoppingItemFromText(familyId, { text: name });
      return { status: merged ? 200 : 201, response: { id: item.id, name: item.name, merged } };
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
   * Put a camera on the wall displays for a minute (#335): the doorbell rang,
   * and whoever walks up to a screen sees who is there without tapping
   * through to Cameras. Under `announcements:write` rather than a scope of
   * its own — it is the same kind of power as a message to the screens, and
   * every new scope means every token has to be reconnected.
   *
   * Two writes, like a message. The family's one `camera_takeovers` row,
   * which the screens pick up over realtime and show until `ends_at`; a
   * second call replaces it, restarting the time or switching the camera. And
   * a push for the phones through the notification queue rather than inline,
   * so each device's quiet hours apply to it. Only quiet hours: there is no
   * per-type switch for camera pushes in the notification settings, so a
   * device that gets pushes at all gets this one. The queue runs every 30
   * seconds, so a phone can hear about the doorbell up to that much after
   * the screens — and if the camera has already gone back by the time the
   * queue gets to it, the push is dropped rather than sent late.
   */
  show_camera: {
    scope: "announcements:write",
    rateLimit: { limit: SHOW_CAMERA_RATE_LIMIT, windowMs: SHOW_CAMERA_RATE_WINDOW_MS },
    handle: async ({ familyId, body, db, admit }) => {
      const duration = parseTakeoverDuration(body.duration);
      if (!duration.ok) {
        return { status: 400, response: { error: duration.error, code: "invalid_request" } };
      }
      const camera = resolveCamera(await readCameraRefs(db, familyId), body.camera);
      if (!camera.ok) {
        return { status: 400, response: { error: camera.error, code: "invalid_request" } };
      }
      const { data: devices, error: devicesError } = await db
        .from("devices")
        .select("id, name, is_kiosk")
        .eq("family_id", familyId);
      if (devicesError) throw devicesError;
      const targets = resolveTargetDevices(devices ?? [], body.target_devices);
      if (!targets.ok) {
        return { status: 400, response: { error: targets.error, code: "invalid_request" } };
      }

      // Valid, so it will run: only now does it spend the budget.
      const refused = admit?.() ?? null;
      if (refused) return refused;

      const startedAt = new Date();
      const endsAt = new Date(startedAt.getTime() + duration.seconds * 1000);
      const { error: takeoverError } = await db.from("camera_takeovers").upsert(
        {
          family_id: familyId,
          camera_id: camera.camera.id,
          device_ids: targets.deviceIds,
          started_at: startedAt.toISOString(),
          ends_at: endsAt.toISOString(),
        },
        { onConflict: "family_id" },
      );
      if (takeoverError) throw takeoverError;

      // The title is a fallback for a NOT NULL column; the processor renders
      // the real, locale-aware push from `data`, as it does for timers. A
      // failed push must not fail the call: the screens already have it.
      const { error: notifyError } = await db.from("scheduled_notifications").insert({
        family_id: familyId,
        notification_type: "camera_live",
        scheduled_for: startedAt.toISOString(),
        title: camera.camera.name,
        body: null,
        // ends_at lets the processor drop a push that would arrive after the camera has gone.
        data: { camera_id: camera.camera.id, camera_name: camera.camera.name, ends_at: endsAt.toISOString() },
        related_entity_type: "camera",
        related_entity_id: null,
      });
      if (notifyError) {
        console.error("[show_camera] could not queue the push:", notifyError);
      }

      return {
        status: 200,
        response: {
          camera: camera.camera,
          screens: targets.deviceIds.length,
          ends_at: endsAt.toISOString(),
        },
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
        db: createAdminClient({ actor: "integration" }),
        admit: serviceAdmission(def, context.tokenId, service),
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

      return NextResponse.json(result.response, { status: result.status, headers: result.headers });
    } catch (err) {
      await logApiError(`integration/services/${service}`, err);
      return NextResponse.json(
        { error: "the service call failed", code: "internal_error" },
        { status: 500 },
      );
    }
  });
}
