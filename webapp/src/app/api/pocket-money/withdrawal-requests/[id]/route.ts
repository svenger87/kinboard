import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface DecideBody {
  status: "approved" | "denied";
  parent_decided_by_person_id?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as Partial<DecideBody>;

  if (body.status !== "approved" && body.status !== "denied") {
    return NextResponse.json(
      { error: "status must be approved or denied" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  // Read the request + the joined account.
  const { data: req, error: readErr } = await (supabase as any)
    .from("pocket_money_withdrawal_requests")
    .select("*, account:pocket_money_accounts(id, balance_cents)")
    .eq("id", id)
    .maybeSingle();

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!req) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (req.status !== "pending") {
    return NextResponse.json({ error: "already_decided" }, { status: 409 });
  }

  // Update the request status first.
  const { error: updReqErr } = await (supabase as any)
    .from("pocket_money_withdrawal_requests")
    .update({
      status: body.status,
      parent_decided_at: new Date().toISOString(),
      parent_decided_by_person_id: body.parent_decided_by_person_id ?? null,
    })
    .eq("id", id);

  if (updReqErr) return NextResponse.json({ error: updReqErr.message }, { status: 500 });

  // On approval: post a withdrawal transaction (negative amount). Don't
  // touch the balance directly here — the transactions endpoint is the
  // only place balances change so the rules stay co-located.
  if (body.status === "approved") {
    const newBalance = req.account.balance_cents - req.amount_cents;
    if (newBalance < 0) {
      // Auto-deny: kid spent the money on something else after asking.
      await (supabase as any)
        .from("pocket_money_withdrawal_requests")
        .update({ status: "denied" })
        .eq("id", id);
      return NextResponse.json(
        { error: "insufficient_funds_at_decide_time" },
        { status: 409 },
      );
    }

    const { error: txnErr } = await (supabase as any)
      .from("pocket_money_transactions")
      .insert({
        account_id: req.account.id,
        amount_cents: -req.amount_cents,
        type: "withdrawal",
        note: req.reason || null,
        related_goal_id: req.related_goal_id,
        created_by_person_id: body.parent_decided_by_person_id ?? null,
      });

    if (txnErr) return NextResponse.json({ error: txnErr.message }, { status: 500 });

    // Update account balance (lifetime_saved is not affected by withdrawals).
    await (supabase as any)
      .from("pocket_money_accounts")
      .update({ balance_cents: newBalance })
      .eq("id", req.account.id);

    // If this was tied to a goal, mark it bought.
    if (req.related_goal_id) {
      await (supabase as any)
        .from("pocket_money_goals")
        .update({ status: "bought", parent_confirmed_at: new Date().toISOString() })
        .eq("id", req.related_goal_id);
    }
  }

  return NextResponse.json({ ok: true });
}
