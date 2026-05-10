import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { PocketMoneyTransactionInsert } from "@/types/database";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10),
    200,
  );

  const supabase = createAdminClient();
  const { data, error } = await (supabase as any)
    .from("pocket_money_transactions")
    .select("*")
    .eq("account_id", id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ transactions: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: accountId } = await params;
  const body = (await request.json()) as Partial<PocketMoneyTransactionInsert>;

  if (typeof body.amount_cents !== "number" || body.amount_cents === 0) {
    return NextResponse.json(
      { error: "amount_cents required, non-zero" },
      { status: 400 },
    );
  }
  if (!body.type) {
    return NextResponse.json({ error: "type required" }, { status: 400 });
  }
  const validTypes = [
    "allowance",
    "manual_deposit",
    "interest",
    "withdrawal",
    "adjustment",
  ];
  if (!validTypes.includes(body.type)) {
    return NextResponse.json({ error: "unknown type" }, { status: 400 });
  }

  const isInflow = ["allowance", "manual_deposit", "interest"].includes(
    body.type,
  );
  if (isInflow && body.amount_cents < 0) {
    return NextResponse.json(
      { error: "inflow type cannot be negative" },
      { status: 400 },
    );
  }
  if (body.type === "withdrawal" && body.amount_cents > 0) {
    return NextResponse.json(
      { error: "withdrawal must be negative" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  const { data: account, error: readErr } = await (supabase as any)
    .from("pocket_money_accounts")
    .select("balance_cents, lifetime_saved_cents")
    .eq("id", accountId)
    .maybeSingle();

  if (readErr)
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!account)
    return NextResponse.json({ error: "account not found" }, { status: 404 });

  const newBalance = account.balance_cents + body.amount_cents;
  if (newBalance < 0) {
    return NextResponse.json({ error: "insufficient_funds" }, { status: 400 });
  }

  const { data: txn, error: txnErr } = await (supabase as any)
    .from("pocket_money_transactions")
    .insert({
      account_id: accountId,
      amount_cents: body.amount_cents,
      type: body.type,
      note: body.note ?? null,
      related_goal_id: body.related_goal_id ?? null,
      created_by_person_id: body.created_by_person_id ?? null,
    })
    .select()
    .single();

  if (txnErr) {
    console.error("[pocket-money] txn insert error:", txnErr);
    return NextResponse.json({ error: txnErr.message }, { status: 500 });
  }

  const accountUpdate: Record<string, number> = { balance_cents: newBalance };
  if (body.amount_cents > 0) {
    accountUpdate.lifetime_saved_cents =
      account.lifetime_saved_cents + body.amount_cents;
  }

  const { error: updErr } = await (supabase as any)
    .from("pocket_money_accounts")
    .update(accountUpdate)
    .eq("id", accountId);

  if (updErr) {
    console.error("[pocket-money] account update error:", updErr);
    // Best-effort orphan cleanup.
    await (supabase as any)
      .from("pocket_money_transactions")
      .delete()
      .eq("id", txn.id);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json(
    { transaction: txn, new_balance_cents: newBalance },
    { status: 201 },
  );
}
