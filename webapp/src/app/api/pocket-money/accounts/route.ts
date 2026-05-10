import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { PocketMoneyAccountInsert } from "@/types/database";

export const dynamic = "force-dynamic";

// GET /api/pocket-money/accounts?family_id=X
export async function GET(request: NextRequest) {
  const familyId = request.nextUrl.searchParams.get("family_id");
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await (supabase as any)
    .from("pocket_money_accounts")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[pocket-money] list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ accounts: data ?? [] });
}

// POST /api/pocket-money/accounts  body: Partial<PocketMoneyAccountInsert>
export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<PocketMoneyAccountInsert>;

  if (!body.family_id || !body.person_id) {
    return NextResponse.json(
      { error: "family_id and person_id are required" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  // Confirm the person exists, belongs to this family, and is_child = true.
  const { data: person, error: personErr } = await (supabase as any)
    .from("people")
    .select("id, family_id, is_child")
    .eq("id", body.person_id)
    .maybeSingle();

  if (personErr) {
    return NextResponse.json({ error: personErr.message }, { status: 500 });
  }
  if (!person) {
    return NextResponse.json({ error: "person not found" }, { status: 404 });
  }
  if (person.family_id !== body.family_id) {
    return NextResponse.json({ error: "person not in family" }, { status: 400 });
  }
  if (!person.is_child) {
    return NextResponse.json(
      { error: "person is not marked as a child; toggle is_child first" },
      { status: 400 },
    );
  }

  const { data, error } = await (supabase as any)
    .from("pocket_money_accounts")
    .insert({
      family_id: body.family_id,
      person_id: body.person_id,
      currency: body.currency ?? "EUR",
      apr_bps: body.apr_bps ?? 1000,
      weekly_allowance_cents: body.weekly_allowance_cents ?? 0,
      allowance_day_of_week: body.allowance_day_of_week ?? 0,
      max_balance_eligible_cents: body.max_balance_eligible_cents ?? 50_000,
      avatar_species: body.avatar_species ?? "dragon",
    })
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "already_exists" }, { status: 409 });
    }
    console.error("[pocket-money] insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ account: data }, { status: 201 });
}
