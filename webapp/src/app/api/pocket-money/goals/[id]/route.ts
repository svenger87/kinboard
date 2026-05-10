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
