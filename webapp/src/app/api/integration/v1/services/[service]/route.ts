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

function optionalText(value: unknown, max = 500): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, max);
}

const SERVICES: Record<string, ServiceDef> = {
  add_shopping_item: {
    scope: "shopping:write",
    handle: async ({ familyId, body }) => {
      const name = text(body.name, 200);
      if (!name) {
        return { status: 400, response: { error: "`name` is required", code: "invalid_request" } };
      }

      const supabase = createAdminClient();

      const { data, error } = await (supabase as any)
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
    handle: async ({ familyId, body }) => {
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

      const supabase = createAdminClient();

      const { data, error } = await (supabase as any)
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
    handle: async ({ familyId, body }) => {
      const content = text(body.text, 2000);
      if (!content) {
        return { status: 400, response: { error: "`text` is required", code: "invalid_request" } };
      }

      const supabase = createAdminClient();

      const { data, error } = await (supabase as any)
        .from("notes")
        .insert({ family_id: familyId, content })
        .select("id")
        .single();

      if (error) throw error;
      return { status: 201, response: { id: data.id } };
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
  "show_announcement",
  "activate_context",
  "dismiss_attention",
  "add_pocket_money",
  "refresh_integration",
]);

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
      const result = await def.handle({ familyId: context.familyId, body });

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
