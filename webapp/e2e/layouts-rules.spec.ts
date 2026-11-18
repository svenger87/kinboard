import { test, expect } from "@playwright/test";
import { validateItems } from "../src/lib/layouts/validate";
import { fitItems, rescaleItems } from "../src/lib/layouts/rescale";
import { resolveLayout } from "../src/lib/layouts/resolve";
import { builtInScreensaver } from "../src/lib/layouts/built-in";
import { gridFor } from "../src/lib/layouts/grid";
import type { Layout, LayoutItem } from "../src/lib/layouts/types";

/**
 * The rules every screen and the server share: what a saved layout may
 * contain, how it is rescaled to another screen height, and which layout a
 * given screen uses. Pure functions, so they are pinned here without a browser.
 */

const item = (o: Partial<LayoutItem> & { id: string }): LayoutItem => ({
  widget: "news", x: 0, y: 0, w: 4, h: 3, text: "M", ...o,
});
const L = (o: Partial<Layout> & { id: string }): Layout => ({
  family_id: "f", name: o.id, width: 1080, height: 1920, home: [], screensaver: [],
  created_at: "", updated_at: "", ...o,
});

test.describe("validateItems", () => {
  const check = (items: unknown) => validateItems(items, 1080, 1920);
  test("x=11, w=2 is out of bounds", () =>
    expect(check([item({ id: "a", widget: "clock", x: 11, w: 2, h: 2 })])).toEqual({ ok: false, error: "out_of_bounds", itemId: "a" }));
  test("past the last row is out of bounds", () =>
    expect(check([item({ id: "a", y: 20, h: 3 })])).toMatchObject({ error: "out_of_bounds" }));
  test("non-integer is out of bounds", () =>
    expect(check([item({ id: "a", x: 0.5 })])).toMatchObject({ error: "out_of_bounds" }));
  test("a screen too small for a grid is out of bounds", () =>
    expect(validateItems([], 390, 844)).toMatchObject({ ok: false, error: "out_of_bounds" }));
  test("two items sharing a cell overlap", () =>
    expect(check([item({ id: "a" }), item({ id: "b", widget: "events", x: 3, y: 2, w: 4, h: 3 })]))
      .toMatchObject({ ok: false, error: "overlap" }));
  test("events 3x3 is below the minimum", () =>
    expect(check([item({ id: "a", widget: "events", w: 3, h: 3 })])).toEqual({ ok: false, error: "below_minimum", itemId: "a" }));
  test("unknown widget", () =>
    expect(check([item({ id: "a", widget: "toaster" as never })])).toMatchObject({ error: "unknown_widget" }));
  test("two clocks are a duplicate", () =>
    expect(check([item({ id: "a", widget: "clock", h: 2 }), item({ id: "b", widget: "clock", x: 6, h: 2 })]))
      .toMatchObject({ error: "duplicate" }));
  test("two items with the same id are a duplicate", () =>
    expect(check([item({ id: "a", widget: "clock", h: 2 }), item({ id: "a", widget: "date", x: 6, h: 2 })]))
      .toEqual({ ok: false, error: "duplicate", itemId: "a" }));
  test("text XXL is bad", () =>
    expect(check([item({ id: "a", text: "XXL" as never })])).toMatchObject({ error: "bad_text_size" }));
  test("not an array is rejected", () => expect(check({})).toMatchObject({ ok: false }));
  test("accepts a valid layout and returns it typed", () => {
    const r = check([item({ id: "a" })]);
    expect(r).toEqual({ ok: true, items: [item({ id: "a" })] });
  });
  for (const [w, h] of [[1080, 1920], [720, 1280], [800, 1280], [1920, 1080], [1280, 720], [1280, 800]]) {
    test(`built-in screensaver is valid at ${w}x${h}`, () => {
      const r = validateItems(builtInScreensaver(w, h), w, h);
      expect(r).toMatchObject({ ok: true });
    });
    test(`built-in screensaver mirrors today's arrangement at ${w}x${h}`, () => {
      const items = builtInScreensaver(w, h);
      const at = (k: string) => items.find((i) => i.widget === k)!;
      expect([at("news").x, at("news").y]).toEqual([0, 0]);
      expect(at("weatherNow").x + at("weatherNow").w).toBe(12);
      if (h > w) {
        expect([at("date").x, at("date").y]).toEqual([at("clock").x, at("clock").y + at("clock").h]);
      }
    });
  }
});

test.describe("built-in screensaver across sizes", () => {
  const sizes: [number, number][] = [];
  for (const w of [600, 720, 800, 1080]) for (let h = w + 1; h <= 2 * w; h += 37) sizes.push([w, h]);
  for (const w of [1280, 1600, 1920, 2560]) for (let h = 600; h < w; h += 41) sizes.push([w, h]);
  test("is valid on every portrait and landscape size", () => {
    let checked = 0;
    for (const [w, h] of sizes) {
      if (!gridFor(w, h)) continue;
      checked++;
      expect(validateItems(builtInScreensaver(w, h), w, h), `${w}x${h}`).toMatchObject({ ok: true });
    }
    expect(checked).toBeGreaterThan(50);
  });
});

test.describe("rescaleItems", () => {
  const from = gridFor(1080, 1920)!;
  const to = gridFor(1080, 1500)!;
  test("same row count leaves items alone", () => {
    const items = [item({ id: "a", y: 5 })];
    expect(rescaleItems(items, from, from)).toEqual({ items, dropped: [] });
  });
  test("keeps x/w, scales y/h by the rows ratio, never below minimum", () => {
    const { items, dropped } = rescaleItems(
      [item({ id: "a", x: 2, w: 5, y: 10, h: 10 }), item({ id: "b", widget: "events", x: 7, w: 4, y: 0, h: 3 })], from, to);
    const a = items.find((i) => i.id === "a")!;
    const b = items.find((i) => i.id === "b")!;
    expect(to.rows).toBe(17);
    // Both edges scale: top 10 → 7.7 → 8, bottom 20 → 15.5 → 15, so 7 rows.
    expect([a.x, a.w, a.y, a.h]).toEqual([2, 5, 8, 7]);
    expect([b.x, b.w, b.h]).toEqual([7, 4, 3]); // 3 * 17/22 = 2.3, held at the minimum 3
    expect(dropped).toEqual([]);
  });
  test("the built-in portrait keeps every widget on a portrait tablet (800x1280, 20 rows)", () => {
    // Rounding top and height on their own made touching neighbours overlap
    // by a row; each pushed the next down and the date fell off the screen.
    const src = builtInScreensaver(1080, 1920);
    const tablet = gridFor(800, 1280)!;
    expect(tablet.rows).toBe(20);
    const r = rescaleItems(src, from, tablet);
    expect(r.dropped).toEqual([]);
    expect(r.items.map((i) => i.widget).sort()).toEqual(src.map((i) => i.widget).sort());
    expect(validateItems(r.items, 800, 1280).ok).toBe(true);
  });
  test("an item pushed past the last row is dropped", () => {
    const stack = [0, 3, 6, 9, 12, 15, 18].map((y, i) => item({ id: `n${i}`, y, h: 3 }));
    const r = rescaleItems(stack, from, to);
    expect(r.dropped).toEqual(["n5", "n6"]);
    expect(r.items.map((i) => i.id)).toEqual(["n0", "n1", "n2", "n3", "n4"]);
  });
});

test.describe("fitItems", () => {
  const PORTRAIT = { width: 1080, height: 1920 };
  const LANDSCAPE = { width: 1920, height: 1080 };
  test("the built-in portrait copied to 1920x1080 keeps the clock and date, drops only the birthdays, and is valid", () => {
    const src = builtInScreensaver(1080, 1920);
    const { items, dropped } = fitItems(src, PORTRAIT, LANDSCAPE);
    expect(validateItems(items, 1920, 1080).ok).toBe(true);
    expect(dropped).toEqual(["birthdays"]);
    const widgets = items.map((i) => i.widget);
    expect(widgets).toContain("clock");
    expect(widgets).toContain("date");
    expect([...items.map((i) => i.id), ...dropped].sort()).toEqual(src.map((i) => i.id).sort());
    // Re-placed items keep their id and text size.
    const clock = items.find((i) => i.widget === "clock")!;
    expect(clock).toMatchObject({ id: "clock", text: "M" });
  });
  test("the same input gives the same output", () => {
    const src = builtInScreensaver(1080, 1920);
    expect(fitItems(src, PORTRAIT, LANDSCAPE)).toEqual(fitItems(structuredClone(src), PORTRAIT, LANDSCAPE));
  });
  test("a dropped widget with no free spot at its minimum stays dropped", () => {
    // At 1280x720 (6 rows) the news takes 10 columns of the top 5 rows: no 4x3 is left for the events.
    const src = [item({ id: "news", widget: "news", x: 0, y: 0, w: 10, h: 18 }), item({ id: "events", widget: "events", x: 0, y: 18, w: 4, h: 4 })];
    const r = fitItems(src, PORTRAIT, { width: 1280, height: 720 });
    expect(validateItems(r.items, 1280, 720).ok).toBe(true);
    expect(r.items.map((i) => i.id)).toEqual(["news"]);
    expect(r.dropped).toEqual(["events"]);
  });
  for (const [label, from, sizes] of [
    ["portrait built-in to every landscape preset", PORTRAIT, [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 1280, height: 800 }]],
    ["landscape built-in to every portrait preset", LANDSCAPE, [{ width: 1080, height: 1920 }, { width: 720, height: 1280 }, { width: 800, height: 1280 }]],
  ] as const) {
    test(`${label}: always valid, every item kept or dropped`, () => {
      const src = builtInScreensaver(from.width, from.height);
      for (const to of sizes) {
        const r = fitItems(src, from, to);
        expect(validateItems(r.items, to.width, to.height).ok, `${to.width}x${to.height}`).toBe(true);
        expect([...r.items.map((i) => i.id), ...r.dropped].sort(), `${to.width}x${to.height}`).toEqual(src.map((i) => i.id).sort());
      }
    });
  }
  test("the same row count keeps everything", () => {
    const src = builtInScreensaver(1080, 1920);
    expect(fitItems(src, PORTRAIT, { width: 720, height: 1280 })).toEqual({ items: src, dropped: [] });
  });
  test("an item the server would refuse is dropped and the rest kept, one at a time", () => {
    const src = [
      item({ id: "a", widget: "clock", x: 0, y: 0, w: 6, h: 3 }),
      item({ id: "b", widget: "clock", x: 6, y: 0, w: 6, h: 3 }), // a second clock: duplicate
      item({ id: "c", widget: "date", x: 0, y: 3, w: 3, h: 1 }),
    ];
    const r = fitItems(src, PORTRAIT, PORTRAIT);
    expect(r.dropped).toEqual(["b"]);
    expect(r.items.map((i) => i.id)).toEqual(["a", "c"]);
  });
  test("malformed items are dropped, well-formed ones survive", () => {
    const r = fitItems([{ id: "x", widget: "nope" }, item({ id: "n" })], PORTRAIT, PORTRAIT);
    expect(r).toEqual({ items: [item({ id: "n" })], dropped: ["x"] });
  });
  test("not an array, or a size with no grid: nothing kept", () => {
    expect(fitItems(null, PORTRAIT, LANDSCAPE)).toEqual({ items: [], dropped: [] });
    expect(fitItems([item({ id: "n" })], PORTRAIT, { width: 500, height: 500 })).toEqual({ items: [], dropped: ["n"] });
  });
});

test.describe("resolveLayout", () => {
  const portrait = L({ id: "p", width: 1080, height: 1920 }), land = L({ id: "l", width: 1920, height: 1080 });
  const kiosk = (layout_id: string | null) => ({ id: "d", is_kiosk: true, layout_id });
  test("own layout in its orientation", () =>
    expect(resolveLayout({ device: kiosk("p"), layouts: [portrait, land], defaults: { portrait: null, landscape: "l" }, viewport: { width: 1080, height: 1920 } })?.id).toBe("p"));
  test("turned: own portrait layout gives way to the landscape default, and comes back", () => {
    const args = { device: kiosk("p"), layouts: [portrait, land], defaults: { portrait: null, landscape: "l" } };
    expect(resolveLayout({ ...args, viewport: { width: 1920, height: 1080 } })?.id).toBe("l");
    expect(resolveLayout({ ...args, viewport: { width: 1080, height: 1920 } })?.id).toBe("p");
  });
  test("a non-kiosk ignores the defaults but keeps an assigned layout", () => {
    expect(resolveLayout({ device: { id: "d", is_kiosk: false, layout_id: null }, layouts: [portrait], defaults: { portrait: "p", landscape: null }, viewport: { width: 1080, height: 1920 } })).toBeNull();
    expect(resolveLayout({ device: { id: "d", is_kiosk: false, layout_id: "p" }, layouts: [portrait], defaults: { portrait: null, landscape: null }, viewport: { width: 1080, height: 1920 } })?.id).toBe("p");
  });
  test("below 600px wide: built-in even with a default", () =>
    expect(resolveLayout({ device: kiosk(null), layouts: [portrait], defaults: { portrait: "p", landscape: null }, viewport: { width: 390, height: 844 } })).toBeNull());
  test("an assigned id that no longer exists falls through to the default", () =>
    expect(resolveLayout({ device: kiosk("gone"), layouts: [portrait], defaults: { portrait: "p", landscape: null }, viewport: { width: 1080, height: 1920 } })?.id).toBe("p"));
});
