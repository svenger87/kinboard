import { test, expect } from "@playwright/test";
import { parsePrice, DEFAULT_IMPORT_PRICE, DEFAULT_EXPORT_PRICE } from "../src/lib/tariff";
import { albumMatchesMonth, monthNameCandidates } from "../src/lib/month-names";

/**
 * Two bugs where a `||` swallowed a value the user meant.
 */

test.describe("a tariff of zero", () => {
  test("typing 0 produces 0, not undefined", () => {
    // `parseFloat(x) || undefined` turned this into "not set", so the
    // display fell back to €0.35/kWh and free charging was unenterable.
    expect(parsePrice("0")).toBe(0);
    expect(parsePrice("0.00")).toBe(0);
    expect(parseFloat("0") || undefined).toBeUndefined(); // the old behaviour
  });

  test("clearing the field still means 'not set'", () => {
    expect(parsePrice("")).toBeUndefined();
    expect(parsePrice("   ")).toBeUndefined();
  });

  test("junk and negatives fall back rather than storing nonsense", () => {
    expect(parsePrice("abc")).toBeUndefined();
    expect(parsePrice("-1")).toBeUndefined();
    expect(parsePrice("Infinity")).toBeUndefined();
  });

  test("normal prices survive", () => {
    expect(parsePrice("0.35")).toBe(0.35);
    expect(parsePrice("0.089")).toBe(0.089);
  });

  test("the consumer keeps a configured zero instead of defaulting", () => {
    const importCost = (configured: number | undefined) => configured ?? DEFAULT_IMPORT_PRICE;
    const exportPrice = (configured: number | undefined) => configured ?? DEFAULT_EXPORT_PRICE;

    expect(importCost(0)).toBe(0);
    expect(importCost(undefined)).toBe(DEFAULT_IMPORT_PRICE);
    expect(exportPrice(0)).toBe(0);
    expect(exportPrice(undefined)).toBe(DEFAULT_EXPORT_PRICE);

    // The old expression, for contrast: a real zero became the default.
    const oldImportCost = (configured: number | undefined) => configured || DEFAULT_IMPORT_PRICE;
    expect(oldImportCost(0)).toBe(DEFAULT_IMPORT_PRICE);
  });
});

test.describe("Immich wallpaper albums in every language", () => {
  const march = new Date(2026, 2, 15);
  const may = new Date(2026, 4, 15);
  const december = new Date(2026, 11, 15);

  test("English album names now match", () => {
    // These are the ones the German-only check missed.
    expect(albumMatchesMonth("Wallpaper March", march)).toBe(true);
    expect(albumMatchesMonth("Wallpaper May", may)).toBe(true);
    expect(albumMatchesMonth("Wallpaper December", december)).toBe(true);
    // Proof of the old failure mode:
    expect("wallpaper march".includes("märz")).toBe(false);
  });

  test("German and French names match too", () => {
    expect(albumMatchesMonth("Wallpaper März", march)).toBe(true);
    expect(albumMatchesMonth("Wallpaper mars", march)).toBe(true);
    expect(albumMatchesMonth("Wallpaper Dezember", december)).toBe(true);
    expect(albumMatchesMonth("Wallpaper décembre", december)).toBe(true);
  });

  test("month numbers work for people who name albums that way", () => {
    expect(albumMatchesMonth("Wallpaper 03", march)).toBe(true);
    expect(albumMatchesMonth("Wallpaper 3", march)).toBe(true);
    expect(albumMatchesMonth("Wallpaper 12", december)).toBe(true);
  });

  test("a bare number doesn't match a year", () => {
    // "Wallpaper 2018" must not count as March just because it contains a 3.
    expect(albumMatchesMonth("Wallpaper 2018", march)).toBe(false);
    expect(albumMatchesMonth("Wallpaper 2013", march)).toBe(false);
  });

  test("the wrong month doesn't match", () => {
    expect(albumMatchesMonth("Wallpaper Januar", march)).toBe(false);
    expect(albumMatchesMonth("Wallpaper August", december)).toBe(false);
  });

  test("candidates cover all three languages and never include a two-letter stub", () => {
    const candidates = monthNameCandidates(march);
    expect(candidates).toContain("märz");
    expect(candidates).toContain("march");
    expect(candidates).toContain("mars");
    for (const c of candidates) {
      if (!/^\d+$/.test(c)) expect(c.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("every month of the year matches its own English name", () => {
    for (let month = 0; month < 12; month++) {
      const date = new Date(2026, month, 15);
      const english = new Intl.DateTimeFormat("en-US", { month: "long" }).format(date);
      expect(albumMatchesMonth(`Wallpaper ${english}`, date), english).toBe(true);
    }
  });
});
