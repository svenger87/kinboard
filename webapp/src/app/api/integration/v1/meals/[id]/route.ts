import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { destructiveLimitResponse } from "@/lib/integration-limits";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/integration/v1/meals/{id}
 *
 * Soft delete through the same BEFORE DELETE trigger as notes and tasks
 * (`migration_zzz_soft_delete.sql`), and the same existence check
 * `notes/[id]/route.ts` uses to get there: the trigger stamps `deleted_at`
 * and returns NULL, which tells Postgres to skip the physical delete *and*
 * empties its RETURNING clause, so a successful soft delete and "matched
 * nothing" both report 0 rows from the DELETE itself. Confirmed directly
 * against kbfresh-db in a rolled-back transaction (see the task report).
 * So existence — and here, family ownership — is confirmed with a SELECT
 * first, and the DELETE's own success is judged only by the absence of an
 * error.
 *
 * `meal_plan_entries` carries no `family_id` of its own; family scope comes
 * only through its `meal_plans` parent (RFC-011 task 5 brief), so the
 * existence SELECT joins it with `meal_plans!inner(family_id)` — the same
 * pattern `GET /meals` and `hooks/use-meal-planner.ts` use. PostgREST has no
 * way to repeat that join as a filter on a DELETE (a write has no embedded
 * resources to filter through), so the DELETE itself is guarded only by
 * `id` and `deleted_at IS NULL`; by the time it runs, the SELECT above has
 * already proven the row belongs to this family. `.is("deleted_at", null)`
 * stays on the DELETE regardless, for the same reason it stays on notes': a
 * second delete racing in between must not reach an already-binned row and
 * purge it for real, which the trigger allows once `deleted_at` is set.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withIntegrationAuth(request, "meals:write", async (context) => {
    const limited = destructiveLimitResponse(context);
    if (limited) return limited;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "no such meal", code: "not_found" }, { status: 404 });
    }

    try {
      const supabase = createAdminClient();

      const { data: existing, error: selectErr } = await (supabase as any)
        .from("meal_plan_entries")
        .select("id, meal_plan:meal_plans!inner(family_id)")
        .eq("id", id)
        .eq("meal_plan.family_id", context.familyId)
        .is("deleted_at", null)
        .maybeSingle();
      if (selectErr) throw selectErr;
      if (!existing) {
        return NextResponse.json({ error: "no such meal", code: "not_found" }, { status: 404 });
      }

      const { error: deleteErr } = await (supabase as any)
        .from("meal_plan_entries")
        .delete()
        .eq("id", id)
        .is("deleted_at", null);
      if (deleteErr) throw deleteErr;

      return NextResponse.json({ ok: true });
    } catch (err) {
      await logApiError("integration/meals/delete", err);
      return NextResponse.json({ error: "Could not remove the meal", code: "internal_error" }, { status: 500 });
    }
  });
}
