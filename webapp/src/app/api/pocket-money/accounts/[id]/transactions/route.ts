import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { PocketMoneyTransactionInsert } from "@/types/database";
import { familyIdFrom, rowInFamily, accountInFamily } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { bookPocketMoney, type RpcClient, type TransactionType } from "@/lib/pocket-money/booking";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rawLimit = parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10);
  const limit = Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 200);

  const supabase = createAdminClient();

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  // The account must belong to the caller's family. RLS is off, so this
  // check is the boundary — see lib/family-scope.
  const familyId = familyIdFrom(request);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  if (!(await accountInFamily(supabase, id, familyId))) {
    // Same answer as "doesn't exist", so ids can't be probed.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

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
  const body = (await request.json()) as Partial<PocketMoneyTransactionInsert> & { family_id?: string };

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

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  // The account must belong to the caller's family. RLS is off, so this
  // check is the boundary — see lib/family-scope.
  const familyId = familyIdFrom(request, body);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  if (!(await accountInFamily(supabase, accountId, familyId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // One call books it: the balance moves with a single conditional UPDATE
  // (balance_cents + amount >= 0) and the transaction row is written in the
  // same database transaction — lib/pocket-money/booking.ts.
  const booked = await bookPocketMoney(supabase as unknown as RpcClient, {
    familyId,
    accountId,
    amountCents: body.amount_cents,
    type: body.type as TransactionType,
    note: body.note ?? null,
    relatedGoalId: body.related_goal_id ?? null,
    createdByPersonId: body.created_by_person_id ?? null,
  });

  if (!booked.ok) {
    if (booked.error === "insufficient_funds") {
      return NextResponse.json({ error: "insufficient_funds" }, { status: 400 });
    }
    if (booked.error === "not_found") {
      return NextResponse.json({ error: "account not found" }, { status: 404 });
    }
    console.error("[pocket-money] booking error:", booked.message);
    return NextResponse.json({ error: booked.message }, { status: 500 });
  }

  return NextResponse.json(
    { transaction: booked.transaction, new_balance_cents: booked.balanceCents },
    { status: 201 },
  );
}
