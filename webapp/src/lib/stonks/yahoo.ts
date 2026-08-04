import YahooFinance from "yahoo-finance2";
import type { Quote, Candle, SearchResult, Timeframe, AssetType } from "./types";

// In-memory TTL cache. Fine for a single-process Docker container; if
// the webapp ever scales horizontally we'd switch to Redis. For one
// kiosk + N family devices, in-memory is right.
const QUOTE_TTL_MS = 30_000;        // 30 seconds — quotes go stale fast
const CHART_TTL_MS = 5 * 60_000;    // 5 minutes — historical doesn't change
const SEARCH_TTL_MS = 60 * 60_000;  // 1 hour — symbol catalog is stable

const quoteCache = new Map<string, { value: Quote; expiresAt: number }>();
const chartCache = new Map<string, { value: Candle[]; expiresAt: number }>();
const searchCache = new Map<string, { value: SearchResult[]; expiresAt: number }>();

function cacheGet<T>(map: Map<string, { value: T; expiresAt: number }>, key: string): T | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet<T>(map: Map<string, { value: T; expiresAt: number }>, key: string, value: T, ttl: number): void {
  if (map.size > 500) map.clear();
  map.set(key, { value, expiresAt: Date.now() + ttl });
}

// Suppress the "survey" notice printed to stderr on every cold start —
// noisy in container logs. In yahoo-finance2 v3 this is a constructor
// option, not an instance method.
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

/** Fetch quotes for an array of symbols. Batches into a single Yahoo
 *  call where possible (yahoo-finance2's `quote()` accepts an array
 *  and round-trips once). Caches per-symbol so a partial-overlap
 *  follow-up call only fetches what's missing. */
export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  const out: Quote[] = [];
  const missing: string[] = [];

  for (const s of symbols) {
    const hit = cacheGet(quoteCache, s);
    if (hit) out.push(hit);
    else missing.push(s);
  }

  if (missing.length === 0) return out;

  // Passing an array always returns QuoteResponseArray (Quote[]).
  const list = await yf.quote(missing);

  // NOTE: Yahoo silently omits unknown/delisted symbols from the response,
  // so `out.length < symbols.length` is the caller's signal that some
  // symbols failed to resolve. We intentionally don't throw — partial
  // success (e.g., AAPL succeeds, BOGUS fails) is more useful than
  // all-or-nothing.
  for (const q of list) {
    if (!q?.symbol) continue;

    // Yahoo's marketState includes "PREPRE" / "POSTPOST" which our
    // exported Quote type collapses — map to the nearest sentinel.
    let marketState: Quote["marketState"] = null;
    switch (q.marketState) {
      case "PRE":
      case "PREPRE":
        marketState = "PRE";
        break;
      case "REGULAR":
        marketState = "REGULAR";
        break;
      case "POST":
      case "POSTPOST":
        marketState = "POST";
        break;
      case "CLOSED":
        marketState = "CLOSED";
        break;
    }

    const quote: Quote = {
      symbol: q.symbol,
      shortName: q.shortName ?? q.longName ?? null,
      price: Number(q.regularMarketPrice ?? 0),
      change: Number(q.regularMarketChange ?? 0),
      changePercent: Number(q.regularMarketChangePercent ?? 0),
      currency: q.currency ?? null,
      marketState,
      exchange: q.fullExchangeName ?? q.exchange ?? null,
      asOf: new Date().toISOString(),
    };
    cacheSet(quoteCache, q.symbol, quote, QUOTE_TTL_MS);
    out.push(quote);
  }

  return out;
}

/** Map our timeframe string to a Yahoo `period1`/`interval` pair.
 *  Tuned for chart legibility — ~50–250 candles per view. */
function timeframeToParams(tf: Timeframe): { period1: Date; interval: "5m" | "15m" | "1h" | "1d" | "1wk" | "1mo" } {
  const now = new Date();
  switch (tf) {
    case "1d": {
      const start = new Date(now);
      start.setHours(start.getHours() - 24);
      return { period1: start, interval: "5m" };
    }
    case "1w": {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return { period1: start, interval: "15m" };
    }
    case "1m": {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      return { period1: start, interval: "1h" };
    }
    case "3m": {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 3);
      return { period1: start, interval: "1d" };
    }
    case "1y": {
      const start = new Date(now);
      start.setFullYear(start.getFullYear() - 1);
      return { period1: start, interval: "1d" };
    }
    case "max": {
      // 20 years is enough for any consumer display. Wider lookbacks
      // make the chart unreadable.
      const start = new Date(now);
      start.setFullYear(start.getFullYear() - 20);
      return { period1: start, interval: "1wk" };
    }
  }
}

/** The fields a candle is built from. Unvalidated Yahoo output is `unknown`. */
interface ChartRow {
  date?: Date | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
}

export async function fetchChart(symbol: string, timeframe: Timeframe): Promise<Candle[]> {
  const cacheKey = `${symbol}|${timeframe}`;
  const hit = cacheGet(chartCache, cacheKey);
  if (hit) return hit;

  const { period1, interval } = timeframeToParams(timeframe);
  // validateResult: false, for the same reason as searchSymbols above.
  //
  // yahoo-finance2 throws FailedYahooValidationError on the whole response
  // when any part of it fails the schema it ships, and Yahoo returns
  // `meta.currency: null` for some perfectly ordinary listings — WITS.DE is
  // one. The catch below turns that into an empty array, so a chart with 22
  // real candles behind it rendered as "no data" with nothing on screen to
  // say why. Validation was hiding data, not protecting anyone from it.
  //
  // Nothing here trusts the shape: each row is filtered for the three fields
  // that must be present and every number is coerced, which is what a chart
  // needs regardless of whether a schema signed it off.
  const result = (await yf
    .chart(symbol, { period1, interval }, { validateResult: false })
    .catch((err: unknown) => {
      // Unknown / delisted / typo'd symbol — return null so the route
      // can render a "no data" state instead of 500ing. Don't cache the
      // null: a symbol may become valid later and we don't want to
      // memoize a transient Yahoo outage.
      console.warn(`[stonks/yahoo] chart fetch failed for ${symbol}:`, (err as Error)?.message ?? err);
      return null;
    })) as { quotes?: ChartRow[] } | null;
  if (!result) return [];

  const candles: Candle[] = (result.quotes ?? [])
    .filter((q) => q.date != null && q.open != null && q.close != null)
    .map((q) => ({
      time: Math.floor(q.date!.getTime() / 1000),
      open: Number(q.open),
      high: Number(q.high ?? q.open),
      low: Number(q.low ?? q.open),
      close: Number(q.close),
      volume: q.volume == null ? null : Number(q.volume),
    }));

  cacheSet(chartCache, cacheKey, candles, CHART_TTL_MS);
  return candles;
}

/**
 * The four fields the search mapping reads, and the shape it needs them in.
 *
 * Unvalidated Yahoo output is `unknown`, which is honest — this narrows it
 * ourselves rather than trusting a schema that has already drifted. A row
 * without a usable symbol is dropped, so a shape change upstream costs us
 * that row instead of the whole response.
 */
interface TradeableQuote {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
}

function isTradeableQuote(row: unknown): row is TradeableQuote {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  // isYahooFinance false means a Crunchbase company or a news item, neither
  // of which can go on a watchlist.
  return r.isYahooFinance === true && typeof r.symbol === "string" && r.symbol !== "";
}

/** Symbol autocomplete — backs the "Add ticker" search box. */
export async function searchSymbols(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 1) return [];

  const cacheKey = q.toLowerCase();
  const hit = cacheGet(searchCache, cacheKey);
  if (hit) return hit;

  // validateResult: false, deliberately.
  //
  // yahoo-finance2 validates every response against a schema it ships, and
  // Yahoo has since started returning values that schema doesn't allow — a
  // fund comes back as quoteType "MUTUALFUND" / typeDisp "Fund" where the
  // schema expects "MONEY_MARKET" / "MoneyMarket". The library throws
  // FailedYahooValidationError on the whole response when any entry fails,
  // so a single unexpected row took down the entire search.
  //
  // That wasn't a degraded search, it was no search: every query 503'd,
  // including "AAPL". With the add-ticker box being the only way to add a
  // symbol, the watchlist could not be added to at all.
  //
  // Validation here protects us from nothing we don't already handle — the
  // mapping below reads four fields and defaults each one, and the
  // isYahooFinance filter drops anything that isn't a tradeable symbol. An
  // upstream schema fix would let this be removed, but the feature should
  // not be offline until then.
  const result = (await yf.search(
    q,
    { quotesCount: 10, newsCount: 0 },
    { validateResult: false },
  )) as { quotes?: unknown[] };

  const out: SearchResult[] = (result.quotes ?? [])
    .filter(isTradeableQuote)
    .map((r) => ({
      symbol: r.symbol,
      name: r.shortname ?? r.longname ?? r.symbol,
      exchange: r.exchDisp ?? null,
      assetType: classifyAssetType(r as unknown as Record<string, unknown>),
    }));

  cacheSet(searchCache, cacheKey, out, SEARCH_TTL_MS);
  return out;
}

function classifyAssetType(raw: Record<string, unknown>): AssetType {
  const qt = String(raw.quoteType ?? raw.typeDisp ?? "").toLowerCase();
  if (qt.includes("crypto")) return "crypto";
  if (qt === "etf") return "etf";
  if (qt === "index") return "index";
  if (qt === "currency" || String(raw.symbol ?? "").endsWith("=X")) return "forex";
  return "stock";
}
