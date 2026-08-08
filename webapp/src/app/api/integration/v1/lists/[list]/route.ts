import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import {
  LISTS,
  isListId,
  itemDue,
  itemSummary,
  toListItem,
  type ListItem,
} from "@/lib/integration-lists";
import {
  findStoredResult,
  fingerprintRequest,
  storeResult,
  validateIdempotencyKey,
} from "@/lib/integration-idempotency";

export const dynamic = "force-dynamic";

/** Enough for a household's list; beyond this something is wrong, not busy. */
export const MAX_ITEMS = 500;

/**
 * GET/POST /api/integration/v1/lists/{list}
 *
 * The shopping list and the task list as things a client can read and add to.
 * Kinboard already exposed counts; a count is not a list, and Home Assistant
 * has a native to-do entity that wants the items themselves.
 *
 * Reading needs family:read. Writing needs the list's own scope, so a token
 * that may add shopping items still cannot create tasks — the same separation
 * the services enforce.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ list: string }> },
) {
  const { list } = await params;
  return withIntegrationAuth(request, "family:read", async (context) => {
    if (!isListId(list)) {
      return NextResponse.json({ error: `unknown list \`${list}\``, code: "not_found" }, { status: 404 });
    }
    const def = LISTS[list];
    const supabase = createAdminClient();

    const columns = ["id", def.titleColumn, def.doneColumn, def.dueColumn]
      .filter(Boolean)
      .join(", ");

    let query = (supabase as any)
      .from(def.table)
      .select(columns)
      .eq("family_id", context.familyId)
      .limit(MAX_ITEMS);

    // Only one of the two tables has a recycle bin; asking the other for
    // deleted_at would be an error, not an empty filter.
    if (def.softDeletes) query = query.is("deleted_at", null);

    const { data, error } = await query;
    if (error) {
      await logApiError(`integration/lists/${list}`, error);
      return NextResponse.json({ error: "Could not read the list", code: "internal_error" }, { status: 500 });
    }

    const items: ListItem[] = ((data ?? []) as Record<string, unknown>[]).map((r) => toListItem(def, r));
    return NextResponse.json({ list, items });
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ list: string }> },
) {
  const { list } = await params;
  // An unknown list still authenticates first, so an anonymous caller cannot
  // discover which lists exist.
  const scope = isListId(list) ? LISTS[list].writeScope : "family:read";

  return withIntegrationAuth(request, scope, async (context) => {
    if (!isListId(list)) {
      return NextResponse.json({ error: `unknown list \`${list}\``, code: "not_found" }, { status: 404 });
    }
    const def = LISTS[list];

    // Required on create, as everywhere else that makes a row: a retried
    // "add milk" must not add milk twice.
    const key = validateIdempotencyKey(request.headers.get("idempotency-key"));
    if (!key.ok) {
      return NextResponse.json(
        { error: "an Idempotency-Key header is required when creating an item", code: "invalid_request" },
        { status: 400 },
      );
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    const summary = itemSummary(body.summary);
    if (!summary) {
      return NextResponse.json({ error: "`summary` is required", code: "invalid_request" }, { status: 400 });
    }
    const due = itemDue(body.due);
    if (!due.ok) {
      return NextResponse.json({ error: "`due` must start with YYYY-MM-DD", code: "invalid_request" }, { status: 400 });
    }

    const requestHash = fingerprintRequest(`lists/${list}`, body);
    const previous = await findStoredResult(context.familyId, key.key);
    if (previous) {
      if (previous.request_hash !== requestHash) {
        return NextResponse.json(
          { error: "this Idempotency-Key was already used with different arguments", code: "conflict" },
          { status: 409 },
        );
      }
      return NextResponse.json(previous.response, {
        status: previous.status,
        headers: { "idempotent-replay": "true" },
      });
    }

    try {
      const supabase = createAdminClient();
      const row: Record<string, unknown> = {
        family_id: context.familyId,
        [def.titleColumn]: summary,
        [def.doneColumn]: false,
      };
      if (def.dueColumn && due.value) row[def.dueColumn] = due.value;

      const { data, error } = await (supabase as any)
        .from(def.table)
        .insert(row)
        .select("id")
        .single();
      if (error) throw error;

      const response = { id: String(data.id), summary, status: "needs_action", due: due.value };
      await storeResult({
        familyId: context.familyId,
        key: key.key,
        service: `lists/${list}`,
        requestHash,
        status: 201,
        response,
      });
      return NextResponse.json(response, { status: 201 });
    } catch (err) {
      await logApiError(`integration/lists/${list}/create`, err);
      return NextResponse.json({ error: "Could not add the item", code: "internal_error" }, { status: 500 });
    }
  });
}
