import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom, accountInFamily } from "@/lib/family-scope";

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
  const body = (await request.json()) as Partial<DecideBody> & { family_id?: string };

  // Approving a request moves real money out of a child's balance, so
  // this is the write that most needs the family check. RLS is off —
  // see lib/family-scope.
  const familyId = familyIdFrom(request, body);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

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
  // Not found and not yours are the same answer, so ids can't be probed.
  if (!req || !(await accountInFamily(supabase, req.account_id, familyId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (req.status !== "pending") {
    return NextResponse.json({ error: "already_decided" }, { status: 409 });
  }

  const decidedAt = new Date().toISOString();

  // Denied path: just flip the status. Cheap and side-effect-free.
  if (body.status === "denied") {
    const { error: updErr } = await (supabase as any)
      .from("pocket_money_withdrawal_requests")
      .update({
        status: "denied",
        parent_decided_at: decidedAt,
        parent_decided_by_person_id: body.parent_decided_by_person_id ?? null,
      })
      .eq("id", id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Approved path: insert the transaction, update the balance, mark
  // the goal bought (if any), THEN flip the status to approved last.
  // Order matters: keep the request `pending` until everything else
  // succeeds so that any failure leaves it retryable instead of stuck
  // in a ghost-approved state with no balance change.
  //
  // Known limitation: the read of req.account.balance_cents above and
  // the write below aren't atomic — concurrent approvals on the same
  // account can race. Acceptable for household-scale use; mitigate
  // with a row-level lock or a Postgres RPC if it ever bites.
  const newBalance = req.account.balance_cents - req.amount_cents;
  if (newBalance < 0) {
    // Kid spent the money on something else after asking — auto-deny.
    await (supabase as any)
      .from("pocket_money_withdrawal_requests")
      .update({
        status: "denied",
        parent_decided_at: decidedAt,
        parent_decided_by_person_id: body.parent_decided_by_person_id ?? null,
      })
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
  const { error: balErr } = await (supabase as any)
    .from("pocket_money_accounts")
    .update({ balance_cents: newBalance })
    .eq("id", req.account.id);
  if (balErr) return NextResponse.json({ error: balErr.message }, { status: 500 });

  // If this was tied to a goal that hit 100%, mark it bought.
  if (req.related_goal_id) {
    await (supabase as any)
      .from("pocket_money_goals")
      .update({ status: "bought", parent_confirmed_at: decidedAt })
      .eq("id", req.related_goal_id);
  }

  // Finally — flip the request status to approved now that all
  // dependent state is consistent.
  const { error: updReqErr } = await (supabase as any)
    .from("pocket_money_withdrawal_requests")
    .update({
      status: "approved",
      parent_decided_at: decidedAt,
      parent_decided_by_person_id: body.parent_decided_by_person_id ?? null,
    })
    .eq("id", id);
  if (updReqErr) return NextResponse.json({ error: updReqErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
