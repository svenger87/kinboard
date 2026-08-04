import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Two switches in Settings → Bring! were wired to nothing. They saved their
 * state, drew as on or off, and no code anywhere read them — so "Auto sync"
 * polled every two minutes whether you wanted it or not, and "Adopt Bring!
 * categories" had no effect either way.
 *
 * A switch that does nothing is worse than a missing one: it tells you the
 * behaviour is yours to choose, and then ignores the choice.
 */

const src = (...parts: string[]) => readFileSync(join(__dirname, "..", "src", ...parts), "utf8");

test.describe("auto sync", () => {
  test("off stops the poll; on and unset keep the two-minute interval", () => {
    const interval = (autoSync: boolean | undefined) =>
      autoSync === false ? false : 2 * 60 * 1000;

    expect(interval(false)).toBe(false);
    expect(interval(true)).toBe(120000);
    // An old settings row predating the switch has no value; the label says
    // sync every two minutes, so that stays the default.
    expect(interval(undefined)).toBe(120000);
  });

  test("the shipped query reads the setting", () => {
    const source = src("hooks", "use-bring.ts");
    expect(source).toContain("settings?.autoSync === false ? false : 2 * 60 * 1000");
  });
});

test.describe("adopt Bring! categories", () => {
  const BRING_TO_LOCAL: Record<string, string> = { Brot: "backwaren", Obst: "obst_gemuese" };
  const detectCategory = (name: string) => (name.includes("brot") ? "backwaren" : "sonstiges");

  // The server-side mapper, same shape as the route's.
  const mapSection = (section: string, itemName: string, useBring = true) => {
    const mapped = useBring ? BRING_TO_LOCAL[section] : undefined;
    if (mapped) return mapped;
    return detectCategory(itemName);
  };

  test("on, an item takes the category of its Bring! section", () => {
    expect(mapSection("Obst", "apfel", true)).toBe("obst_gemuese");
  });

  test("off, it falls back to our own keyword detection", () => {
    expect(mapSection("Obst", "apfel", false)).toBe("sonstiges");
    expect(mapSection("Obst", "vollkornbrot", false)).toBe("backwaren");
  });

  test("an unmapped section falls back either way", () => {
    expect(mapSection("Tiefkühl", "vollkornbrot", true)).toBe("backwaren");
    expect(mapSection("Tiefkühl", "vollkornbrot", false)).toBe("backwaren");
  });

  test("the client sends the flag only when the switch is off", () => {
    const source = src("hooks", "use-item-catalog.ts");
    expect(source).toContain('bringSettings?.syncCategories === false');
    expect(source).toContain('params.set("bring_categories", "0")');
  });

  test("the flag is part of the query key, so flipping it refetches", () => {
    // Without this the suggestions keep their old categories until the
    // five-minute cache expires, and the switch looks broken again.
    const source = src("hooks", "use-item-catalog.ts");
    const keyBlock = source.slice(source.indexOf("queryKey: ["), source.indexOf("queryFn"));
    expect(keyBlock).toContain("useBringCategories");
  });

  test("the route honours it and defaults to on", () => {
    const source = src("app", "api", "catalog", "search", "route.ts");
    expect(source).toContain('searchParams.get("bring_categories") !== "0"');
    expect(source).toContain("useBringCategories = true");
    expect(source).toContain("mapBringSectionToCategory(r.item.sectionName, r.item.name, useBringCategories)");
  });
});
