import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import { LISTS, isListId, itemDue, itemSummary } from "@/lib/integration-lists";

export const dynamic = "force-dynamic";

/**
 * PATCH/DELETE /api/integration/v1/lists/{list}/{item}
 *
 * Ticking, renaming, re-dating and removing a single item — the other half of
 * a two-way to-do list.
 *
 * No Idempotency-Key here, unlike create. These address a specific row by id,
 * so repeating one is already harmless: ticking a ticked item leaves it
 * ticked, and deleting a deleted item affects nothing. Demanding a key for an
 * operation that is idempotent by construction would be ceremony, and a
 * to-do platform ticks items constantly.
 *
 * Every statement is scoped by family as well as id. An id belonging to
 * another household must change nothing rather than rely on the id being
 * unguessable.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ list: string; item: string }> },
) {
  const { list, item } = await params;
  const scope = isListId(list) ? LISTS[list].writeScope : "family:read";

  return withIntegrationAuth(request, scope, async (context) => {
    if (!isListId(list)) {
      return NextResponse.json({ error: `unknown list \`${list}\``, code: "not_found" }, { status: 404 });
    }
    const def = LISTS[list];

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    const patch: Record<string, unknown> = {};

    if ("status" in body) {
      const status = body.status;
      if (status !== "completed" && status !== "needs_action") {
        return NextResponse.json(
          { error: "`status` must be `completed` or `needs_action`", code: "invalid_request" },
          { status: 400 },
        );
      }
      patch[def.doneColumn] = status === "completed";
    }

    if ("summary" in body) {
      const summary = itemSummary(body.summary);
      if (!summary) {
        return NextResponse.json({ error: "`summary` cannot be empty", code: "invalid_request" }, { status: 400 });
      }
      patch[def.titleColumn] = summary;
    }

    if ("due" in body) {
      if (!def.dueColumn) {
        return NextResponse.json(
          { error: `the \`${list}\` list has no due date`, code: "invalid_request" },
          { status: 400 },
        );
      }
      const due = itemDue(body.due);
      if (!due.ok) {
        return NextResponse.json({ error: "`due` must start with YYYY-MM-DD", code: "invalid_request" }, { status: 400 });
      }
      patch[def.dueColumn] = due.value;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "nothing to change — send status, summary or due", code: "invalid_request" },
        { status: 400 },
      );
    }

    try {
      const supabase = createAdminClient();
      const { data, error } = await (supabase as any)
        .from(def.table)
        .update(patch)
        .eq("id", item)
        .eq("family_id", context.familyId)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return NextResponse.json({ error: "no such item", code: "not_found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, id: String(data.id) });
    } catch (err) {
      await logApiError(`integration/lists/${list}/update`, err);
      return NextResponse.json({ error: "Could not update the item", code: "internal_error" }, { status: 500 });
    }
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ list: string; item: string }> },
) {
  const { list, item } = await params;
  const scope = isListId(list) ? LISTS[list].writeScope : "family:read";

  return withIntegrationAuth(request, scope, async (context) => {
    if (!isListId(list)) {
      return NextResponse.json({ error: `unknown list \`${list}\``, code: "not_found" }, { status: 404 });
    }
    const def = LISTS[list];

    try {
      const supabase = createAdminClient();
      // Plain DELETE either way. For tasks the soft-delete trigger turns this
      // into a move to the recycle bin, which is exactly what deleting a task
      // in Kinboard does — so removing one from Home Assistant is recoverable,
      // and removing a shopping item is not, matching each list's own
      // behaviour rather than inventing a third.
      const { error } = await (supabase as any)
        .from(def.table)
        .delete()
        .eq("id", item)
        .eq("family_id", context.familyId);

      if (error) throw error;
      return NextResponse.json({ ok: true });
    } catch (err) {
      await logApiError(`integration/lists/${list}/delete`, err);
      return NextResponse.json({ error: "Could not remove the item", code: "internal_error" }, { status: 500 });
    }
  });
}
