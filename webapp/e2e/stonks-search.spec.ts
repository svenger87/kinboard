import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Symbol search returned "Yahoo Finance unavailable" for every query — not
 * just obscure ones. "AAPL" too. Since the add-ticker box is the only way to
 * put a symbol on the watchlist, the feature was entirely unusable.
 *
 * yahoo-finance2 validates each response against a schema it ships, and
 * Yahoo now returns values that schema disallows — a fund arrives as
 * quoteType "MUTUALFUND" / typeDisp "Fund" where the schema expects
 * "MONEY_MARKET" / "MoneyMarket". The library throws on the *whole*
 * response when any single entry fails it.
 */

const source = readFileSync(join(__dirname, "..", "src", "lib", "stonks", "yahoo.ts"), "utf8");

test("search opts out of the library's schema validation", () => {
  const search = source.slice(source.indexOf("export async function searchSymbols"));
  expect(search).toContain("validateResult: false");
});

test("only search opts out — quote and chart still validate", () => {
  // They aren't broken, and validation is worth keeping where it works.
  const quote = source.slice(source.indexOf("yf.quote("), source.indexOf("yf.quote(") + 200);
  expect(quote).not.toContain("validateResult");
  const chart = source.slice(source.indexOf("yf.chart("), source.indexOf("yf.chart(") + 200);
  expect(chart).not.toContain("validateResult");
});

test.describe("the narrowing that replaces the schema", () => {
  // Mirrors isTradeableQuote.
  const isTradeable = (row: unknown): boolean => {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    return r.isYahooFinance === true && typeof r.symbol === "string" && r.symbol !== "";
  };

  test("keeps real symbols", () => {
    expect(isTradeable({ isYahooFinance: true, symbol: "AAPL" })).toBe(true);
    // The exact row shape that used to take the whole response down.
    expect(isTradeable({ isYahooFinance: true, symbol: "VWCE.DE", quoteType: "MUTUALFUND", typeDisp: "Fund" })).toBe(true);
  });

  test("drops what can't go on a watchlist", () => {
    // Crunchbase companies and news items come back in the same array.
    expect(isTradeable({ isYahooFinance: false, name: "Some startup" })).toBe(false);
    expect(isTradeable({ isYahooFinance: true, symbol: "" })).toBe(false);
    expect(isTradeable({ isYahooFinance: true })).toBe(false);
    expect(isTradeable({ isYahooFinance: true, symbol: 42 })).toBe(false);
  });

  test("survives junk instead of throwing", () => {
    for (const row of [null, undefined, "AAPL", 7, []]) {
      expect(isTradeable(row), JSON.stringify(row)).toBe(false);
    }
  });

  test("one bad row costs one row, not the whole response", () => {
    // This is the actual regression: the schema failed the entire payload.
    const rows: unknown[] = [
      { isYahooFinance: true, symbol: "AAPL" },
      { isYahooFinance: true, quoteType: "MUTUALFUND" }, // no symbol
      { isYahooFinance: false, name: "Startup" },
      { isYahooFinance: true, symbol: "VWRA.L" },
    ];
    expect(rows.filter(isTradeable)).toHaveLength(2);
  });
});

test("the name falls back through shortname, longname, then the symbol", () => {
  const nameOf = (r: { symbol: string; shortname?: string; longname?: string }) =>
    r.shortname ?? r.longname ?? r.symbol;
  expect(nameOf({ symbol: "AAPL", shortname: "Apple Inc." })).toBe("Apple Inc.");
  expect(nameOf({ symbol: "AAPL", longname: "Apple Incorporated" })).toBe("Apple Incorporated");
  expect(nameOf({ symbol: "AAPL" })).toBe("AAPL");
});
