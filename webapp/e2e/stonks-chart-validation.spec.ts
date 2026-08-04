import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A second way the chart came up blank, distinct from a symbol genuinely
 * having no history.
 *
 * yahoo-finance2 throws FailedYahooValidationError on the *whole* response
 * when any part fails the schema it ships, and Yahoo returns
 * `meta.currency: null` for some perfectly ordinary listings. fetchChart's
 * catch turned that into an empty array, so a chart with real candles behind
 * it rendered as "no data" with nothing on screen to say why.
 *
 * Measured against the live API before and after: WITS.DE went 0 -> 20
 * candles, while AAPL (367) and VWCE.DE (220) were unchanged.
 */

const source = readFileSync(join(__dirname, "..", "src", "lib", "stonks", "yahoo.ts"), "utf8");

test("chart opts out of schema validation", () => {
  const chart = source.slice(source.indexOf("export async function fetchChart"));
  expect(chart).toContain("validateResult: false");
});

test("a failed fetch still degrades to an empty chart rather than a 500", () => {
  const chart = source.slice(source.indexOf("export async function fetchChart"));
  expect(chart).toContain("return null;");
  expect(chart).toContain("if (!result) return [];");
});

test("the empty result is still not cached", () => {
  // A symbol can become valid later, and a transient Yahoo outage shouldn't
  // be memoised for the cache TTL.
  const chart = source.slice(
    source.indexOf("export async function fetchChart"),
    source.indexOf("cacheSet(chartCache"),
  );
  const earlyReturn = chart.indexOf("if (!result) return [];");
  expect(earlyReturn).toBeGreaterThan(-1);
  expect(chart.slice(0, earlyReturn)).not.toContain("cacheSet");
});

test.describe("the row filter, which is what actually guards the shape", () => {
  const usable = (q: Record<string, unknown>) =>
    q.date != null && q.open != null && q.close != null;

  test("keeps a complete bar", () => {
    expect(usable({ date: new Date(), open: 1, high: 2, low: 0.5, close: 1.5 })).toBe(true);
  });

  test("drops the gaps thin listings leave", () => {
    // A five-minute bucket with no trades comes back with nulls.
    expect(usable({ date: new Date(), open: null, close: null })).toBe(false);
    expect(usable({ date: null, open: 1, close: 1 })).toBe(false);
    expect(usable({ date: new Date(), open: 1, close: null })).toBe(false);
  });

  test("high and low fall back to open, so a flat bar still renders", () => {
    const q = { open: 10, high: null, low: null } as Record<string, number | null>;
    expect(Number(q.high ?? q.open)).toBe(10);
    expect(Number(q.low ?? q.open)).toBe(10);
  });

  test("a missing volume stays null rather than becoming zero", () => {
    // Number(null) is 0, which would draw a bar claiming no trades happened.
    const vol = (v: number | null) => (v == null ? null : Number(v));
    expect(vol(null)).toBeNull();
    expect(vol(0)).toBe(0);
    expect(vol(1234)).toBe(1234);
  });
});

test("the symbol never lands in a format-string position", () => {
  // `symbol` comes straight off a query parameter, and console.warn treats
  // its first argument as a format string — a symbol containing %s or %d
  // would consume the arguments after it. CodeQL js/tainted-format-string.
  const warn = source.slice(source.indexOf("chart fetch failed") - 200, source.indexOf("chart fetch failed") + 200);
  expect(warn).not.toMatch(/console\.warn\(`[^`]*\$\{symbol\}/);
  expect(warn).toContain('console.warn("[stonks/yahoo] chart fetch failed for", symbol');
});

test("quote validates; search and chart do not", () => {
  const quote = source.slice(source.indexOf("yf.quote("), source.indexOf("yf.quote(") + 200);
  expect(quote).not.toContain("validateResult");
  for (const fn of ["searchSymbols", "fetchChart"]) {
    const body = source.slice(source.indexOf(`export async function ${fn}`));
    expect(body.slice(0, 2000), fn).toContain("validateResult: false");
  }
});
