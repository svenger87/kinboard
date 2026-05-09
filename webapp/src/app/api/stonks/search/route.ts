import { NextRequest, NextResponse } from "next/server";
import { searchSymbols } from "@/lib/stonks/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/stonks/search?q=apple
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });

  try {
    const results = await searchSymbols(q);
    return NextResponse.json({ results });
  } catch (err) {
    console.error("[stonks/search]", err);
    return NextResponse.json({ error: "Yahoo Finance unavailable" }, { status: 503 });
  }
}
