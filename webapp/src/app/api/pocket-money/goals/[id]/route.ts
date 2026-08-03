import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { PocketMoneyGoalUpdate } from "@/types/database";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as Partial<PocketMoneyGoalUpdate>;

  const update: PocketMoneyGoalUpdate = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.target_amount_cents !== undefined) update.target_amount_cents = body.target_amount_cents;
  if (body.image_url !== undefined) update.image_url = body.image_url;
  if (body.image_source !== undefined) update.image_source = body.image_source;
  if (body.position !== undefined) update.position = body.position;
  if (body.is_primary !== undefined) update.is_primary = body.is_primary;
  if (body.status !== undefined) update.status = body.status;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no updatable fields provided" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // If we're setting is_primary=true, first unset any existing primary on this account.
  if (update.is_primary === true) {
    const { data: goal } = await (supabase as any)
      .from("pocket_money_goals")
      .select("account_id")
      .eq("id", id)
      .maybeSingle();
    if (goal) {
      // Exclude the row we're about to flip to true, so there's never a
      // moment where the partial UNIQUE index sees zero primary goals
      // (which would also briefly de-orient the kid view's progress bar).
      await (supabase as any)
        .from("pocket_money_goals")
        .update({ is_primary: false })
        .eq("account_id", goal.account_id)
        .eq("status", "active")
        .neq("id", id);
    }
  }

  const { data, error } = await (supabase as any)
    .from("pocket_money_goals")
    .update(update)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ goal: data });
}

/**
 * Delete a goal.
 *
 * There was previously no way to remove a goal at all — not from the API
 * and not from any screen — so a mistyped or abandoned goal stayed on a
 * child's page permanently.
 *
 * Transactions reference goals via `related_goal_id`, and that history
 * must survive: a withdrawal that happened is a fact, whatever became of
 * the goal it was for. The column is nullable and set to NULL here
 * rather than cascading, so the money history stays intact and only the
 * goal disappears.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: goal } = await (supabase as any)
    .from("pocket_money_goals")
    .select("id, account_id")
    .eq("id", id)
    .maybeSingle();

  if (!goal) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Detach history first; a failure here must not leave transactions
  // pointing at a goal that's about to vanish.
  const { error: detachError } = await (supabase as any)
    .from("pocket_money_transactions")
    .update({ related_goal_id: null })
    .eq("related_goal_id", id);
  if (detachError) {
    return NextResponse.json({ error: detachError.message }, { status: 500 });
  }

  const { error } = await (supabase as any)
    .from("pocket_money_goals")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, account_id: goal.account_id });
}
