export type AssetType = "stock" | "etf" | "crypto" | "index" | "forex";

export type Timeframe = "1d" | "1w" | "1m" | "3m" | "1y" | "max";

/** Spot quote — current price + day-change snapshot. */
export interface Quote {
  symbol: string;
  shortName: string | null;     // "Apple Inc." etc.
  price: number;
  change: number;               // absolute change since previous close
  changePercent: number;        // percentage change since previous close
  currency: string | null;      // "USD", "EUR" etc.
  marketState: "PRE" | "REGULAR" | "POST" | "CLOSED" | null;
  exchange: string | null;
  asOf: string;                 // ISO timestamp of when the quote was retrieved
}

/** OHLC candle. */
export interface Candle {
  time: number;                 // unix seconds (lightweight-charts convention)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

/** Symbol search result (autocomplete). */
export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string | null;
  assetType: AssetType;
}
