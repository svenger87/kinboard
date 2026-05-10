import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { PocketMoneyGoalInsert } from "@/types/database";

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data, error } = await (supabase as any)
    .from("pocket_money_goals")
    .select("*")
    .eq("account_id", id)
    .order("position", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goals: data ?? [] });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accountId } = await params;
  const body = (await request.json()) as Partial<PocketMoneyGoalInsert>;

  if (!body.name || !body.target_amount_cents || body.target_amount_cents <= 0) {
    return NextResponse.json({ error: "name + positive target_amount_cents required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Determine next position.
  const { data: maxRow } = await (supabase as any)
    .from("pocket_money_goals")
    .select("position")
    .eq("account_id", accountId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  // First active goal becomes is_primary by default.
  const { data: existingActive } = await (supabase as any)
    .from("pocket_money_goals")
    .select("id")
    .eq("account_id", accountId)
    .eq("status", "active")
    .limit(1);
  const isPrimary = !existingActive || existingActive.length === 0;

  const { data, error } = await (supabase as any)
    .from("pocket_money_goals")
    .insert({
      account_id: accountId,
      name: body.name,
      target_amount_cents: body.target_amount_cents,
      image_url: body.image_url ?? null,
      image_source: body.image_source ?? "url",
      position: (maxRow?.position ?? -1) + 1,
      is_primary: isPrimary,
    })
    .select()
    .single();

  if (error) {
    console.error("[pocket-money] goal insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ goal: data }, { status: 201 });
}
