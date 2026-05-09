import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { TickerInsert } from "@/types/database";

export const dynamic = "force-dynamic";

// GET /api/tickers?family_id=X
export async function GET(request: NextRequest) {
  const familyId = request.nextUrl.searchParams.get("family_id");
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("tickers")
    .select("*")
    .eq("family_id", familyId)
    .order("position", { ascending: true });

  if (error) {
    console.error("[tickers] list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tickers: data ?? [] });
}

// POST /api/tickers  body: TickerInsert
export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<TickerInsert>;
  if (!body.family_id || !body.symbol || !body.asset_type) {
    return NextResponse.json(
      { error: "family_id, symbol, asset_type are required" },
      { status: 400 },
    );
  }

  const validTypes = ["stock", "etf", "crypto", "index", "forex"] as const;
  if (!validTypes.includes(body.asset_type)) {
    return NextResponse.json({ error: "unknown asset_type" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // New rows go to the end of the position list. Read max(position) for
  // the family; default to -1 so first insert lands at 0.
  const { data: maxRow } = await supabase
    .from("tickers")
    .select("position")
    .eq("family_id", body.family_id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPosition = (maxRow?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("tickers")
    .insert({
      family_id: body.family_id,
      symbol: body.symbol.toUpperCase().trim(),
      asset_type: body.asset_type,
      nickname: body.nickname ?? null,
      color: body.color ?? null,
      position: nextPosition,
    })
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "already_exists" }, { status: 409 });
    }
    console.error("[tickers] insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ticker: data }, { status: 201 });
}
