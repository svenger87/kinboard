import { test, expect } from "@playwright/test";
import { checkItems, moveBy, resizeBy } from "../src/lib/layouts/arrange";
import type { LayoutItem } from "../src/lib/layouts/types";

/**
 * The editor's commands on several boxes at once, which need no browser:
 * each is applied to every selected box or, when any of them would leave the
 * screen, go under its minimum or land on another, refused as a whole with
 * the reason. Positions in steps: 48 columns, 24 rows here.
 */

const box = (widget: LayoutItem["widget"], x: number, y: number, w: number, h: number): LayoutItem => ({ id: widget, widget, x, y, w, h, text: "M" });
const ROWS = 24;

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
