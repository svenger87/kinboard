import { NextRequest, NextResponse } from "next/server";
import { fetchChart } from "@/lib/stonks/yahoo";
import type { Timeframe } from "@/lib/stonks/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TIMEFRAMES: Timeframe[] = ["1d", "1w", "1m", "3m", "1y", "max"];

// GET /api/stonks/chart?symbol=AAPL&timeframe=1d
export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  const timeframeParam = request.nextUrl.searchParams.get("timeframe") ?? "1d";

  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const timeframe = VALID_TIMEFRAMES.includes(timeframeParam as Timeframe)
    ? (timeframeParam as Timeframe)
    : "1d";

  try {
    const candles = await fetchChart(symbol, timeframe);
    return NextResponse.json({ symbol, timeframe, candles });
  } catch (err) {
    console.error("[stonks/chart]", err);
    return NextResponse.json({ error: "Yahoo Finance unavailable" }, { status: 503 });
  }
}
