import { NextRequest, NextResponse } from "next/server";
import { fetchQuotes } from "@/lib/stonks/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/stonks/quote?symbols=AAPL,MSFT,BTC-USD
export async function GET(request: NextRequest) {
  const symbolsParam = request.nextUrl.searchParams.get("symbols");
  if (!symbolsParam) {
    return NextResponse.json({ error: "symbols required" }, { status: 400 });
  }
  const symbols = symbolsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
  if (symbols.length === 0) {
    return NextResponse.json({ quotes: [] });
  }

  try {
    const quotes = await fetchQuotes(symbols);
    return NextResponse.json({ quotes });
  } catch (err) {
    console.error("[stonks/quote]", err);
    return NextResponse.json({ error: "Yahoo Finance unavailable" }, { status: 503 });
  }
}
