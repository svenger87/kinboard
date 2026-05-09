import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { TickerUpdate } from "@/types/database";

export const dynamic = "force-dynamic";

// GET /api/tickers/[id]
export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("tickers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ticker: data });
}

// PATCH /api/tickers/[id]  body: Partial<TickerUpdate>
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as Partial<TickerUpdate>;

  // Strip fields the caller can't change (id, family_id, created_at).
  const update: TickerUpdate = {};
  if (body.symbol !== undefined) update.symbol = body.symbol.toUpperCase().trim();
  if (body.asset_type !== undefined) update.asset_type = body.asset_type;
  if (body.nickname !== undefined) update.nickname = body.nickname;
  if (body.color !== undefined) update.color = body.color;
  if (body.position !== undefined) update.position = body.position;

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("tickers")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ticker: data });
}

// DELETE /api/tickers/[id]
export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("tickers")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
