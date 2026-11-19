import { test, expect } from "@playwright/test";
import { alignItems, checkItems, distribute, matchSize, moveBy, resizeBy } from "../src/lib/layouts/arrange";
import type { LayoutItem } from "../src/lib/layouts/types";

/**
 * The editor's commands on several boxes at once, which need no browser:
 * each is applied to every selected box or, when any of them would leave the
 * screen, go under its minimum or land on another, refused as a whole with
 * the reason. Positions in steps: 48 columns, 24 rows here.
 */

const box = (widget: LayoutItem["widget"], x: number, y: number, w: number, h: number): LayoutItem => ({ id: widget, widget, x, y, w, h, text: "M" });
const ROWS = 24;
/** A weather box (minimum 8x4 steps) with an id of its own, for several of the same widget. */
const wx = (id: string, x: number, y: number, w = 8, h = 4): LayoutItem => ({ id, widget: "weatherNow", x, y, w, h, text: "M" });
const at = (r: ReturnType<typeof alignItems>, id: string) => (r.ok ? r.items.find((i) => i.id === id) : undefined);

test("moveBy moves every selected box and leaves the others", () => {
  const items = [box("clock", 0, 0, 16, 8), box("date", 0, 8, 12, 4), box("news", 30, 0, 16, 12)];
  const r = moveBy(items, ["clock", "date"], 1, 0, ROWS);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.items.find((i) => i.id === "clock")).toMatchObject({ x: 1, y: 0, w: 16, h: 8 });
  expect(r.items.find((i) => i.id === "date")).toMatchObject({ x: 1, y: 8, w: 12, h: 4 });
  expect(r.items.find((i) => i.id === "news")).toEqual(items[2]);
  // The input is left as it was.
  expect(items[0].x).toBe(0);
});

test("moveBy is refused as a whole when one box would land on a third", () => {
  const items = [box("clock", 0, 0, 16, 8), box("date", 20, 8, 12, 4), box("news", 32, 0, 12, 12)];
  // The clock would be free at x 1, but the date would reach the news.
  expect(moveBy(items, ["clock", "date"], 1, 0, ROWS)).toEqual({ ok: false, reason: "overlap" });
});

test("selected boxes moving next to each other in the same direction do not count as overlapping", () => {
  const items = [box("clock", 0, 0, 16, 8), box("date", 16, 0, 12, 4)];
  const r = moveBy(items, ["clock", "date"], 1, 0, ROWS);
  expect(r.ok).toBe(true);
});

test("moveBy past an edge is out of bounds", () => {
  const items = [box("clock", 32, 0, 16, 8), box("date", 0, 8, 12, 4)];
  expect(moveBy(items, ["clock", "date"], 1, 0, ROWS)).toEqual({ ok: false, reason: "out_of_bounds" });
  expect(moveBy(items, ["date"], -1, 0, ROWS)).toEqual({ ok: false, reason: "out_of_bounds" });
  expect(moveBy(items, ["clock"], 0, -1, ROWS)).toEqual({ ok: false, reason: "out_of_bounds" });
  expect(moveBy([box("clock", 0, 16, 16, 8)], ["clock"], 0, 1, ROWS)).toEqual({ ok: false, reason: "out_of_bounds" });
});

test("resizeBy grows from the top left corner, and refuses below the minimum", () => {
  // The clock's minimum is 16x8 steps.
  const items = [box("clock", 4, 2, 16, 8), box("date", 0, 12, 12, 4)];
  const grown = resizeBy(items, ["clock"], 4, 0, ROWS);
  expect(grown.ok).toBe(true);
  if (grown.ok) expect(grown.items.find((i) => i.id === "clock")).toMatchObject({ x: 4, y: 2, w: 20, h: 8 });
  expect(resizeBy(items, ["clock"], -1, 0, ROWS)).toEqual({ ok: false, reason: "below_minimum" });
  expect(resizeBy(items, ["clock"], 0, -1, ROWS)).toEqual({ ok: false, reason: "below_minimum" });
  // Taller onto the date below.
  expect(resizeBy(items, ["clock"], 0, 3, ROWS)).toEqual({ ok: false, reason: "overlap" });
  expect(resizeBy(items, ["clock"], 29, 0, ROWS)).toEqual({ ok: false, reason: "out_of_bounds" });
});

test("resizeBy applies to every selected box", () => {
  const items = [box("clock", 0, 0, 16, 8), box("date", 0, 8, 12, 4)];
  const r = resizeBy(items, ["clock", "date"], 1, 0, ROWS);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.items.map((i) => i.w)).toEqual([17, 13]);
});

test("checkItems checks the changed boxes against every other", () => {
  const items = [box("clock", 0, 0, 16, 8), box("date", 10, 4, 12, 4)];
  expect(checkItems(items, ["date"], ROWS)).toEqual({ ok: false, reason: "overlap" });
  expect(checkItems([box("clock", 0, 0, 4, 8)], ["clock"], ROWS)).toEqual({ ok: false, reason: "below_minimum" });
  expect(checkItems([box("clock", 0, 20, 16, 8)], ["clock"], ROWS)).toEqual({ ok: false, reason: "out_of_bounds" });
  const fine = [box("clock", 0, 0, 16, 8)];
  expect(checkItems(fine, ["clock"], ROWS)).toEqual({ ok: true, items: fine });
});

test("alignItems left moves every selected box to the leftmost edge", () => {
  const items = [box("clock", 0, 0, 16, 8), box("date", 8, 10, 12, 4), wx("w", 20, 16)];
  const r = alignItems(items, ["date", "w", "clock"], "left", ROWS);
  expect(r.ok).toBe(true);
  expect([at(r, "clock")?.x, at(r, "date")?.x, at(r, "w")?.x]).toEqual([0, 0, 0]);
  // Only x changes.
  expect(at(r, "date")).toMatchObject({ y: 10, w: 12, h: 4 });
});

test("alignItems left of boxes side by side in one row is an overlap, and nothing changes", () => {
  const items = [wx("a", 0, 0), wx("b", 8, 0), wx("c", 20, 0)];
  expect(alignItems(items, ["a", "b", "c"], "left", ROWS)).toEqual({ ok: false, reason: "overlap" });
  expect(items.map((i) => i.x)).toEqual([0, 8, 20]);
});

test("alignItems right, top and bottom go to the extreme edge among the selected", () => {
  const items = [wx("a", 0, 0), wx("b", 10, 6, 12), wx("c", 30, 12)];
  const right = alignItems(items, ["a", "b", "c"], "right", ROWS);
  expect([at(right, "a")?.x, at(right, "b")?.x, at(right, "c")?.x]).toEqual([30, 26, 30]);
  const top = alignItems(items, ["a", "b", "c"], "top", ROWS);
  expect([at(top, "a")?.y, at(top, "b")?.y, at(top, "c")?.y]).toEqual([0, 0, 0]);
  const tall = [wx("a", 0, 0), wx("b", 10, 6, 8, 6), wx("c", 30, 12)];
  const bottom = alignItems(tall, ["a", "b", "c"], "bottom", ROWS);
  expect([at(bottom, "a")?.y, at(bottom, "b")?.y, at(bottom, "c")?.y]).toEqual([12, 10, 12]);
});

test("alignItems centres on the selection's bounding box, rounded down to a whole step", () => {
  // Bounding box x 0..31: centre 15.5. A box 8 wide starts at 11.5, rounded down to 11; 12 wide at 9.5, so 9.
  const items = [wx("a", 0, 0), wx("b", 19, 6, 12), wx("c", 23, 12)];
  const h = alignItems(items, ["a", "b", "c"], "hcenter", ROWS);
  expect([at(h, "a")?.x, at(h, "b")?.x, at(h, "c")?.x]).toEqual([11, 9, 11]);
  // Bounding box y 0..17: centre 8.5; boxes 4 high start at 6.5, so 6; 5 high at 6.
  const v = alignItems([wx("a", 0, 0), wx("b", 10, 3, 8, 5), wx("c", 20, 13)], ["a", "b", "c"], "vcenter", ROWS);
  expect([at(v, "a")?.y, at(v, "b")?.y, at(v, "c")?.y]).toEqual([6, 6, 6]);
});

test("distribute x keeps the outer boxes and spaces the middle one evenly", () => {
  const items = [wx("a", 0, 0), wx("b", 10, 0), wx("c", 40, 0)];
  // Free steps between 8 and 40 less the middle's 8: 24, so gaps of 12 and 12.
  const r = distribute(items, ["c", "a", "b"], "x", ROWS);
  expect(r.ok).toBe(true);
  expect([at(r, "a")?.x, at(r, "b")?.x, at(r, "c")?.x]).toEqual([0, 20, 40]);
});

test("distribute gives the steps left over one each from the first gap on", () => {
  // The last box is 7 wide (a photo count, minimum 4) so it still ends on the screen's edge at 48.
  const items = [wx("a", 0, 0), wx("b", 10, 0), { ...wx("c", 41, 0, 7), widget: "photoCount" as const }];
  // 25 free steps: gaps of 13 and 12.
  const r = distribute(items, ["a", "b", "c"], "x", ROWS);
  expect([at(r, "a")?.x, at(r, "b")?.x, at(r, "c")?.x]).toEqual([0, 21, 41]);
  // Four boxes on y, the outer at 0 and 20: 20 - 4 - 8 = 8 free steps between, gaps of 3, 3 and 2.
  const col = [wx("a", 0, 0), wx("b", 0, 5), wx("c", 0, 10), wx("d", 0, 20)];
  const y = distribute(col, ["a", "b", "c", "d"], "y", ROWS);
  expect([at(y, "a")?.y, at(y, "b")?.y, at(y, "c")?.y, at(y, "d")?.y]).toEqual([0, 7, 14, 20]);
});

test("distribute with two boxes changes nothing", () => {
  const items = [wx("a", 0, 0), wx("b", 10, 0)];
  expect(distribute(items, ["a", "b"], "x", ROWS)).toEqual({ ok: true, items });
});

test("matchSize gives every selected box the first selected box's size", () => {
  const items = [box("clock", 0, 0, 16, 8), box("news", 20, 0, 20, 12), box("events", 0, 12, 18, 12)];
  const w = matchSize(items, ["news", "clock", "events"], "w", ROWS);
  expect(w.ok).toBe(true);
  expect([at(w, "clock")?.w, at(w, "news")?.w, at(w, "events")?.w]).toEqual([20, 20, 20]);
  expect(at(w, "clock")?.h).toBe(8);
  const h = matchSize(items, ["events", "clock"], "h", ROWS);
  expect(at(h, "clock")?.h).toBe(12);
  expect(at(h, "news")?.h).toBe(12);
});

test("matchSize below a box's minimum is refused", () => {
  // The clock's minimum width is 16 steps; the weather box is 8 wide.
  const items = [wx("w", 0, 0), box("clock", 20, 0, 16, 8)];
  expect(matchSize(items, ["w", "clock"], "w", ROWS)).toEqual({ ok: false, reason: "below_minimum" });
});
