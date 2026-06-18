import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { PocketMoneyWithdrawalRequestInsert } from "@/types/database";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const status = request.nextUrl.searchParams.get("status");

  const supabase = createAdminClient();
  let q = (supabase as any)
    .from("pocket_money_withdrawal_requests")
    .select("*")
    .eq("account_id", id);
  if (status) q = q.eq("status", status);
  const { data, error } = await q.order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: accountId } = await params;
  const body = (await request.json()) as Partial<PocketMoneyWithdrawalRequestInsert>;

  if (!Number.isInteger(body.amount_cents) || (body.amount_cents as number) <= 0) {
    return NextResponse.json(
      { error: "positive integer amount_cents required" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  // Spam guard: a kid could otherwise tap "ready to buy" / "spend" repeatedly
  // and flood the parent's approval inbox. Reject a second pending request for
  // the same goal, and cap the total number of pending requests per account.
  const { data: pending } = await (supabase as any)
    .from("pocket_money_withdrawal_requests")
    .select("id, related_goal_id")
    .eq("account_id", accountId)
    .eq("status", "pending");
  const pendingList = (pending ?? []) as { id: string; related_goal_id: string | null }[];

  if (
    body.related_goal_id &&
    pendingList.some((p) => p.related_goal_id === body.related_goal_id)
  ) {
    return NextResponse.json(
      { error: "A request for this goal is already awaiting approval." },
      { status: 409 },
    );
  }

  const MAX_PENDING = 5;
  if (pendingList.length >= MAX_PENDING) {
    return NextResponse.json(
      { error: "Too many requests are already awaiting approval." },
      { status: 409 },
    );
  }

  const { data, error } = await (supabase as any)
    .from("pocket_money_withdrawal_requests")
    .insert({
      account_id: accountId,
      amount_cents: body.amount_cents,
      reason: body.reason ?? "",
      related_goal_id: body.related_goal_id ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: data }, { status: 201 });
}
