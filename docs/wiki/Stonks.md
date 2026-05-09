# Stonks

The Stonks page (`/stonks`) is a watchlist for stocks, ETFs, crypto, indices, and forex pairs. Each ticker gets a per-symbol detail page with proper TradingView candle charts (1d, 1w, 1m, 3m, 1y, max timeframes), a current-price + day-change hero, and a market-state badge (PRE / REGULAR / POST / CLOSED). The dashboard widget rotates through your tickers every 8 seconds so you see something fresh on each glance.

Stonks shipped in v1.0.19 as the fourth bundled [SurfacePlugin](Plugin-Architecture.md), alongside Vehicles, Energy, and Cameras.

---

## What you need

Nothing. Yahoo Finance is the v1 data driver and requires no API key. It covers stocks, ETFs, crypto, indices, and forex pairs through one source. The driver contract leaves room for paid sources like Polygon or Tiingo later when intraday resolution or a stricter rate-limit story matters.

---

## Adding a ticker

1. Go to `/settings/stonks` (or follow the link from the main Settings page under Integrations).
2. Type in the search box. Yahoo's symbol search backs the autocomplete — you can type a company name (`apple`, `tesla`) or a ticker (`AAPL`, `TSLA`). Results show the symbol, asset type, and exchange.
3. Click a result to add it to the watchlist. Already-added symbols show a checkmark and are non-clickable.
4. (Optional) Set a nickname and accent color in the row's expandable config form. The nickname replaces the bare ticker in the UI.

To remove a ticker, click the trash icon and confirm. The dialog shows the symbol so you can't remove the wrong one by accident.

---

## Symbol formats Yahoo expects

| Asset class | Format | Examples |
|---|---|---|
| US stocks / ETFs | bare ticker | `AAPL`, `MSFT`, `VOO`, `SPY` |
| International stocks | ticker + exchange suffix | `LSEG.L` (London), `SAP.DE` (Frankfurt), `ASML.AS` (Amsterdam), `TM.PA` (Paris) |
| Crypto | `<coin>-USD` | `BTC-USD`, `ETH-USD`, `SOL-USD` |
| Indices | caret prefix | `^GSPC` (S&P 500), `^DJI` (Dow), `^NDX` (Nasdaq 100), `^GDAXI` (DAX) |
| Forex | `<pair>=X` | `EURUSD=X`, `GBPJPY=X`, `USDJPY=X` |

The autocomplete handles all of these for you — you typically don't need to type the format yourself. Type "DAX" and the German index appears in the list with the right `^GDAXI` symbol.

### Pence-denominated stocks (LSE)

London-listed stocks are quoted in pence by Yahoo with the currency code `GBp` (lowercase `p`). Kinboard handles this gracefully — the formatter falls back to `<number> GBp` when Yahoo returns a non-ISO currency code so the price still renders.

---

## Caching and refresh

Quotes refresh every 30 seconds when the page is visible. The detail page chart re-fetches every 5 minutes. Yahoo-side TTL caches mean these auto-refreshes are essentially "give me the freshest cached value" without hammering Yahoo's rate-limit.

Symbol search results are cached for 1 hour per query string. Typing the same query twice within an hour returns instantly without a Yahoo round-trip.

---

## Dashboard widget

The Stonks widget is **opt-in** — it's off by default in `widget_visibility`. Toggle it on at `/settings/widgets` to add it to the dashboard grid.

The widget shows one ticker at a time: nickname/symbol, current price, and day-change percentage with an up/down arrow tinted green/red. Every 8 seconds it animates to the next ticker in your watchlist. Clicking the widget jumps to the `/stonks` detail page for the active ticker.

If you have only one ticker, rotation pauses (no point cycling through one card). If you have no tickers, the widget hides itself entirely.

---

## What's not supported (yet)

- **Drag-reorder of the watchlist.** v1.0.19 ships in creation order. To reorder, remove and re-add — your TTL-cached quotes are still warm so the round-trip is cheap.
- **News feed per ticker.** Yahoo's `quoteSummary` returns a news array; Kinboard doesn't surface it yet. On the radar.
- **Price alerts.** Notification queue exists (used for shopping reminders, calendar events, etc.) but no per-ticker alert UI yet. On the radar.
- **Portfolio / cost-basis tracking.** Out of scope for v1 — Stonks is a watchlist, not a brokerage. Tier-2 feature if there's appetite.
- **Paid data sources.** Polygon, Tiingo, Alpaca, etc. would land as additional drivers under the `StonksDriver` contract. The Yahoo driver is the only one shipping today.

---

## Disabling Stonks

If you don't want this plugin at all, toggle it off at `/settings/plugins` → **Stonks**. The nav entry, dashboard widget, and settings page all disappear. Existing tickers are kept in the database, so toggling back on restores the watchlist exactly.

---

## Troubleshooting

**Symbol search returns no results.** Yahoo's search is forgiving but does require at least one character. Empty trimmed input returns 400 from `/api/stonks/search`. If a real query returns nothing, the company may not be Yahoo-listed; try a known-good ticker like `AAPL` to confirm Yahoo is reachable from your container.

**Detail page renders but chart says "Chart unavailable".** Yahoo couldn't return historical OHLC for that timeframe. Try a wider timeframe (`1m` or `1y`); some thinly traded symbols have intraday gaps.

**Quote shows but day-change is 0.** Markets are closed and the previous-close pricing model is rounding to 0.00. The market-state badge will show CLOSED. This is normal for crypto on Saturday morning UTC and for US stocks during weekends/holidays.

**Currency renders as `293.32 USD` instead of `$293.32`.** Yahoo returned a non-standard currency code (typically `GBp` for London pence). The formatter catches the `RangeError` from `Intl.NumberFormat` and falls back to the raw number + code. Functional, just less polished than the ISO-currency styling.

---

## Related

- [[Plugin-Architecture]] — the `SurfacePlugin` contract Stonks implements
- [[Plugin-Directory]] — full list of bundled plugins
- [[Notifications]] — push notification infrastructure (future home for price alerts)
