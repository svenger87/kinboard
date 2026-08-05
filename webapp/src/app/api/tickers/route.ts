import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { TickerInsert } from "@/types/database";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

// The per-id routes under this one already refuse to touch another family's
// ticker (rowInFamily). The collection routes were the way around that: ask
// for a family's whole list, or add a row to it, by naming the family.
// GET /api/tickers?family_id=X
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const familyId = request.nextUrl.searchParams.get("family_id");
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
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
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Partial<TickerInsert>;
  if (!body.family_id || !body.symbol || !body.asset_type) {
    return NextResponse.json(
      { error: "family_id, symbol, asset_type are required" },
      { status: 400 },
    );
  }

  if (!familyMatchesSession(auth.session, body.family_id)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
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
