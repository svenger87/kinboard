import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { destructiveLimitResponse } from "@/lib/integration-limits";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import { notePatch } from "@/lib/note-patch";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH/DELETE /api/integration/v1/notes/{id}
 *
 * Editing and removing a single note — `notes:write`, which RFC-011 §8
 * deliberately broadens from "create only" rather than adding a separate
 * scope: it matches what `tasks:write` and `shopping:write` already allow,
 * and every Home Assistant token already holding `notes:write` gains these
 * for free (called out in the release notes).
 *
 * Every statement is scoped by family as well as id, and filters
 * `deleted_at IS NULL` itself: the admin client carries the service role,
 * which bypasses RLS (and the `deleted_at IS NULL` the browser-facing
 * policies add for free), so a binned note is invisible to this route only
 * because every query here says so.
 *
 * DELETE cannot judge success by the rows a `.delete()` returns. The
 * soft-delete trigger (`migration_zzz_soft_delete.sql`) is a BEFORE DELETE
 * trigger that stamps `deleted_at` and returns NULL — and returning NULL
 * from a BEFORE DELETE trigger tells Postgres to skip the row, which cancels
 * the physical delete *and* empties its RETURNING clause. A successful soft
 * delete therefore reports the same "0 rows" a delete that matched nothing
 * would. Confirmed directly against kbfresh-db in a rolled-back transaction:
 *
 *   BEGIN;
 *   DELETE FROM notes WHERE id = '<id>' AND deleted_at IS NULL RETURNING id;
 *   -- DELETE 0
 *   SELECT deleted_at FROM notes WHERE id = '<id>';
 *   -- 2026-10-01 07:56:26.973717+00  (the row WAS soft-deleted)
 *   ROLLBACK;
 *
 * So existence is checked with a SELECT first — that is what turns "missing"
 * and "already binned" into 404 — and the DELETE's own success is judged
 * only by the absence of an error. `.is("deleted_at", null)` stays on the
 * DELETE itself even after that SELECT: without it, a second DELETE that
 * raced in between (or a stale re-check) could reach an already-binned row
 * and purge it for real, which the same trigger allows once `deleted_at` is
 * already set.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withIntegrationAuth(request, "notes:write", async (context) => {
    const limited = destructiveLimitResponse(context);
    if (limited) return limited;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "no such note", code: "not_found" }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    const result = notePatch(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: "invalid_request" }, { status: 400 });
    }

    try {
      const supabase = createAdminClient();
      const { data, error } = await (supabase as any)
        .from("notes")
        .update(result.patch)
        .eq("id", id)
        .eq("family_id", context.familyId)
        .is("deleted_at", null)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return NextResponse.json({ error: "no such note", code: "not_found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, id: String(data.id) });
    } catch (err) {
      await logApiError("integration/notes/update", err);
      return NextResponse.json({ error: "Could not update the note", code: "internal_error" }, { status: 500 });
    }
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withIntegrationAuth(request, "notes:write", async (context) => {
    const limited = destructiveLimitResponse(context);
    if (limited) return limited;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "no such note", code: "not_found" }, { status: 404 });
    }

    try {
      const supabase = createAdminClient();

      // See the file-level note: a DELETE's own RETURNING clause cannot
      // distinguish "soft-deleted successfully" from "matched nothing", so
      // existence is confirmed here first.
      const { data: existing, error: selectErr } = await (supabase as any)
        .from("notes")
        .select("id")
        .eq("id", id)
        .eq("family_id", context.familyId)
        .is("deleted_at", null)
        .maybeSingle();
      if (selectErr) throw selectErr;
      if (!existing) {
        return NextResponse.json({ error: "no such note", code: "not_found" }, { status: 404 });
      }

      const { error: deleteErr } = await (supabase as any)
        .from("notes")
        .delete()
        .eq("id", id)
        .eq("family_id", context.familyId)
        .is("deleted_at", null);
      if (deleteErr) throw deleteErr;

      return NextResponse.json({ ok: true });
    } catch (err) {
      await logApiError("integration/notes/delete", err);
      return NextResponse.json({ error: "Could not remove the note", code: "internal_error" }, { status: 500 });
    }
  });
}
