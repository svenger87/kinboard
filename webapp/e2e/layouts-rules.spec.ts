import { test, expect } from "@playwright/test";
import { validateItems } from "../src/lib/layouts/validate";
import { rescaleItems } from "../src/lib/layouts/rescale";
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
  }
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
    expect([a.x, a.w, a.y, a.h]).toEqual([2, 5, 8, 8]);
    expect([b.x, b.w, b.h]).toEqual([7, 4, 3]); // 3 * 17/22 = 2.3, held at the minimum 3
    expect(dropped).toEqual([]);
  });
  test("an item pushed past the last row is dropped", () => {
    const stack = [0, 3, 6, 9, 12, 15, 18].map((y, i) => item({ id: `n${i}`, y, h: 3 }));
    const r = rescaleItems(stack, from, to);
    expect(r.dropped).toEqual(["n5", "n6"]);
    expect(r.items.map((i) => i.id)).toEqual(["n0", "n1", "n2", "n3", "n4"]);
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
