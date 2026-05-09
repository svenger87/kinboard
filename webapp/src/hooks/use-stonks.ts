import { useQuery } from "@tanstack/react-query";
import type { Quote, Candle, SearchResult, Timeframe } from "@/lib/stonks/types";

// Quotes auto-refresh every 30s when the page is visible. Yahoo-side
// caching in lib/stonks/yahoo.ts is also 30s, so refetch is essentially
// "give me the freshest cached value" without hammering Yahoo.
export function useQuotes(symbols: string[]) {
  const key = symbols.length > 0 ? symbols.join(",") : null;
  return useQuery({
    queryKey: ["stonks", "quotes", key],
    enabled: Boolean(key),
    refetchInterval: 30_000,
    queryFn: async (): Promise<Quote[]> => {
      const r = await fetch(`/api/stonks/quote?symbols=${encodeURIComponent(key!)}`);
      if (!r.ok) throw new Error(`quote: ${r.status}`);
      const json = (await r.json()) as { quotes: Quote[] };
      return json.quotes;
    },
  });
}

export function useChart(symbol: string | undefined, timeframe: Timeframe) {
  return useQuery({
    queryKey: ["stonks", "chart", symbol, timeframe],
    enabled: Boolean(symbol),
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<Candle[]> => {
      const r = await fetch(
        `/api/stonks/chart?symbol=${encodeURIComponent(symbol!)}&timeframe=${timeframe}`,
      );
      if (!r.ok) throw new Error(`chart: ${r.status}`);
      const json = (await r.json()) as { candles: Candle[] };
      return json.candles;
    },
  });
}

export function useSymbolSearch(query: string) {
  return useQuery({
    queryKey: ["stonks", "search", query],
    enabled: query.trim().length >= 1,
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<SearchResult[]> => {
      const r = await fetch(`/api/stonks/search?q=${encodeURIComponent(query)}`);
      if (!r.ok) throw new Error(`search: ${r.status}`);
      const json = (await r.json()) as { results: SearchResult[] };
      return json.results;
    },
  });
}
