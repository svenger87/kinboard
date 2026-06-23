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
