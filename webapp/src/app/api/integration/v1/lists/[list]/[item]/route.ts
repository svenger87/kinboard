import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { destructiveLimitResponse } from "@/lib/integration-limits";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import { LISTS, isListId, itemDue, itemSummary } from "@/lib/integration-lists";
import { completionUpdate } from "@/lib/task-completion";
import { familyTimeZone } from "@/lib/family-time";
import { TASK_ONLY_FIELDS, familyPersonId, parseTaskExtras } from "@/lib/integration-tasks";

export const dynamic = "force-dynamic";

/**
 * PATCH/DELETE /api/integration/v1/lists/{list}/{item}
 *
 * Ticking, renaming, re-dating and removing a single item — the other half of
 * a two-way to-do list.
 *
 * No Idempotency-Key here, unlike create. These address a specific row by id,
 * so repeating one is already harmless: ticking a ticked item leaves it
 * ticked, and deleting a shopping item that is already gone reports the same
 * `ok: true` either way. Demanding a key for an operation that is idempotent
 * by construction would be ceremony, and a to-do platform ticks items
 * constantly.
 *
 * Tasks are the one exception to "repeating does nothing extra": a *second*
 * DELETE on a task id that already moved it to the recycle bin is refused
 * with 404 rather than silently answered `ok: true`, because letting it
 * through would purge the row for real (see the soft-delete note below). A
 * client retrying a delete still gets an idempotent-looking outcome — the
 * task stays exactly where the first call put it — it just also gets told
 * there is nothing left to delete.
 *
 * Every statement is scoped by family as well as id. An id belonging to
 * another household must change nothing rather than rely on the id being
 * unguessable.
 *
 * `todos` is additionally soft-deleted. The admin client used here carries
 * the service role, which bypasses RLS entirely — the `deleted_at IS NULL`
 * clause the browser-facing policies add for free does not apply — so every
 * query against `todos` in this file repeats `.is("deleted_at", null)`
 * itself. Skipping it on the DELETE path is what let a second delete reach
 * an already-binned row and purge it: the soft-delete trigger lets a DELETE
 * through once `deleted_at` is already set (`migration_zzz_soft_delete.sql`),
 * so the WHERE clause is the only thing standing between "binned" and "gone".
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ list: string; item: string }> },
) {
  const { list, item } = await params;
  const scope = isListId(list) ? LISTS[list].writeScope : "family:read";

  return withIntegrationAuth(request, scope, async (context) => {
    const limited = destructiveLimitResponse(context);
    if (limited) return limited;
    if (!isListId(list)) {
      return NextResponse.json({ error: `unknown list \`${list}\``, code: "not_found" }, { status: 404 });
    }
    const def = LISTS[list];
    const supabase = createAdminClient({ actor: "integration" });

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    const patch: Record<string, unknown> = {};

    // Assignee, repetition, priority, icon and points are task columns; the
    // shopping list has none of them.
    if (list !== "tasks") {
      const taskOnly = TASK_ONLY_FIELDS.find((field) => field in body);
      if (taskOnly) {
        const what = taskOnly === "person_id" ? "assignee" : `\`${taskOnly}\``;
        return NextResponse.json(
          { error: `the \`${list}\` list has no ${what}`, code: "invalid_request" },
          { status: 400 },
        );
      }
    }
    const extras = parseTaskExtras(body);
    if (!extras.ok) {
      return NextResponse.json({ error: extras.error, code: "invalid_request" }, { status: 400 });
    }
    Object.assign(patch, extras.value);

    if ("status" in body) {
      const status = body.status;
      if (status !== "completed" && status !== "needs_action") {
        return NextResponse.json(
          { error: "`status` must be `completed` or `needs_action`", code: "invalid_request" },
          { status: 400 },
        );
      }

      if (list === "tasks") {
        // Recurring and one-off tasks are completed and reopened differently
        // (task-completion.ts) — fetch the row's recurrence to decide, under
        // the same deleted_at filter everything else here uses, so a binned
        // task answers 404 rather than letting a status patch resurrect it.
        try {
          const { data: taskRow, error: taskErr } = await (supabase as any)
            .from("todos")
            .select("recurrence, rotation_person_ids, track_completion")
            .eq("id", item)
            .eq("family_id", context.familyId)
            .is("deleted_at", null)
            .maybeSingle();
          if (taskErr) throw taskErr;
          if (!taskRow) {
            return NextResponse.json({ error: "no such item", code: "not_found" }, { status: 404 });
          }

          // A patch that also changes the repetition is completed under the
          // new one, as the edit and the tick would be if made one after the
          // other.
          const result = completionUpdate(
            { ...taskRow, recurrence: extras.value.recurrence ?? taskRow.recurrence },
            status,
            new Date(),
            await familyTimeZone(context.familyId),
          );
          if (!result.ok) {
            return NextResponse.json(
              { error: "recurring tasks can't be reopened", code: "conflict" },
              { status: 409 },
            );
          }
          Object.assign(patch, result.update);
        } catch (err) {
          await logApiError(`integration/lists/${list}/update`, err);
          return NextResponse.json({ error: "Could not update the item", code: "internal_error" }, { status: 500 });
        }
      } else {
        patch[def.doneColumn] = status === "completed";
      }
    }

    if ("summary" in body) {
      const summary = itemSummary(body.summary);
      if (!summary) {
        return NextResponse.json({ error: "`summary` cannot be empty", code: "invalid_request" }, { status: 400 });
      }
      patch[def.titleColumn] = summary;
    }

    if ("due" in body) {
      const due = itemDue(body.due);
      if (!def.dueColumn) {
        // Clearing a date on a list that has none is a no-op, not an error.
        // A generic client — a to-do platform, say — sends a uniform patch
        // without knowing which lists carry a due date, and it is right to:
        // an absent key means "leave it alone", so it must send the key to
        // clear one. Rejecting that made every tick from Home Assistant fail
        // with 400 while the tick itself was perfectly valid.
        //
        // A non-null date is still refused, because that is a caller asking
        // for something this list cannot do.
        if (due.ok && due.value === null) {
          // fall through: nothing to set
        } else {
          return NextResponse.json(
            { error: `the \`${list}\` list has no due date`, code: "invalid_request" },
            { status: 400 },
          );
        }
      } else {
        if (!due.ok) {
          return NextResponse.json({ error: "`due` must start with YYYY-MM-DD", code: "invalid_request" }, { status: 400 });
        }
        patch[def.dueColumn] = due.value;
      }
    }

    if ("person_id" in body) {
      try {
        const person = await familyPersonId(supabase, context.familyId, body.person_id);
        if (!person.ok) {
          return NextResponse.json({ error: person.error, code: "invalid_request" }, { status: 400 });
        }
        patch.person_id = person.value;
      } catch (err) {
        await logApiError(`integration/lists/${list}/update`, err);
        return NextResponse.json({ error: "Could not update the item", code: "internal_error" }, { status: 500 });
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "nothing to change — send status, summary, due, person_id, recurrence, priority, icon or points", code: "invalid_request" },
        { status: 400 },
      );
    }

    try {
      let query = (supabase as any)
        .from(def.table)
        .update(patch)
        .eq("id", item)
        .eq("family_id", context.familyId);
      if (def.softDeletes) query = query.is("deleted_at", null);

      const { data, error } = await query.select("id").maybeSingle();

      // A task that takes turns can only be ticked for its open day; before
      // its schedule starts there is none (migration_zzzzzy_todo_turns.sql).
      if (error && (error as { hint?: string }).hint === "no_open_turn") {
        return NextResponse.json(
          { error: "this task has no turn open yet", code: "conflict" },
          { status: 409 },
        );
      }
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
    const limited = destructiveLimitResponse(context);
    if (limited) return limited;
    if (!isListId(list)) {
      return NextResponse.json({ error: `unknown list \`${list}\``, code: "not_found" }, { status: 404 });
    }
    const def = LISTS[list];

    try {
      const supabase = createAdminClient({ actor: "integration" });
      // Plain DELETE either way. For tasks the soft-delete trigger turns this
      // into a move to the recycle bin, which is exactly what deleting a task
      // in Kinboard does — so removing one from Home Assistant is recoverable,
      // and removing a shopping item is not, matching each list's own
      // behaviour rather than inventing a third.
      if (def.softDeletes) {
        // A DELETE's own RETURNING clause cannot be used to judge success
        // here. The soft-delete trigger (migration_zzz_soft_delete.sql) is a
        // BEFORE DELETE trigger that stamps deleted_at and returns NULL —
        // and returning NULL from a BEFORE DELETE trigger tells Postgres to
        // skip the row, which cancels the physical delete *and* empties its
        // RETURNING clause. A successful soft delete therefore reports the
        // same "0 rows" a delete that matched nothing would; `.select("id")`
        // after `.delete()` cannot tell them apart. Confirmed directly
        // against kbfresh-db in a rolled-back transaction:
        //
        //   BEGIN;
        //   DELETE FROM todos WHERE id = '<id>' AND family_id = '<fam>' AND deleted_at IS NULL RETURNING id;
        //   -- DELETE 0
        //   SELECT deleted_at FROM todos WHERE id = '<id>';
        //   -- 2026-10-01 ...  (the row WAS soft-deleted)
        //   ROLLBACK;
        //
        // So existence is confirmed with a SELECT first — that is what turns
        // "missing" and "already binned" into 404 — and the DELETE's own
        // success is judged only by the absence of an error, matching
        // notes/[id]/route.ts's DELETE.
        const { data: existing, error: selectErr } = await (supabase as any)
          .from(def.table)
          .select("id")
          .eq("id", item)
          .eq("family_id", context.familyId)
          .is("deleted_at", null)
          .maybeSingle();
        if (selectErr) throw selectErr;
        if (!existing) {
          return NextResponse.json({ error: "no such item", code: "not_found" }, { status: 404 });
        }

        // `.is("deleted_at", null)` stays on the DELETE itself even after
        // that SELECT: without it, a second DELETE that raced in between (or
        // a stale re-check) could reach an already-binned row and purge it
        // for real, which the same trigger allows once deleted_at is already
        // set.
        const { error: deleteErr } = await (supabase as any)
          .from(def.table)
          .delete()
          .eq("id", item)
          .eq("family_id", context.familyId)
          .is("deleted_at", null);
        if (deleteErr) throw deleteErr;

        return NextResponse.json({ ok: true });
      }

      // Shopping has no deleted_at column and no recycle bin: unchanged from
      // before this fix, including answering ok: true for an id that was
      // never there — a hard-deleting list has no "binned" state to protect.
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
