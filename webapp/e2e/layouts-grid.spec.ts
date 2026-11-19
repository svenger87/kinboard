import { test, expect } from "@playwright/test";
import { gridFor, boxRect, textPx, valueBox } from "../src/lib/layouts/grid";
import { SAVER_WIDGETS } from "../src/lib/layouts/widgets";

/**
 * The layout designer places screensaver widgets on a grid of 12 square
 * cells across, positions counted in quarter-cell steps (48 columns), whose
 * cell size follows the screen, so one layout looks the same on a 1080x1920
 * wall screen and on the same panel at 150% scaling. These tests pin the
 * maths every later piece of the designer builds on.
 */

test("1080x1920: 60px cells, 48 step columns, 48px edges", () => {
  const g = gridFor(1080, 1920)!;
  expect(g.cell).toBe(60);
  expect(g.columns).toBe(48);
  expect(g.offsetX).toBe(48);
  expect(g.cellRows).toBe(22); // floor((1920-96+24)/84)
  expect(g.offsetY).toBe(48); // 22 rows fill 1824px exactly
});
test("720x1280 (1080x1920 at 150%): 30px cells", () => expect(gridFor(720, 1280)!.cell).toBe(30));
test("1920x1080: 130px cells", () => expect(gridFor(1920, 1080)!.cell).toBe(130));
test("below 600px wide, or too short for six rows of 20px cells (the cell a 600px width has), there is no grid", () => {
  expect(gridFor(599, 1000)).toBeNull();
  expect(gridFor(1920, 300)).toBeNull();
});
test("a wide screen gets six rows: the cells shrink and the twelve columns sit centred", () => {
  // A desktop browser on a 2560x1440 monitor (reported from a family's screen).
  const g = gridFor(2552, 1274)!;
  expect(g.cellRows).toBe(6);
  expect(g.cell).toBe(176);
  const used = 12 * g.cell + 11 * 24;
  expect(g.offsetX).toBeCloseTo((2552 - used) / 2, 5);
  // A 1920x1080 monitor minus a browser's bars.
  expect(gridFor(1920, 960)).toMatchObject({ cellRows: 6, cell: 124 });
});
test("screens that had six rows keep the grid they had", () => {
  for (const [w, h] of [[1080, 1920], [720, 1280], [1920, 1080], [1280, 720], [1280, 800], [800, 1280], [600, 1024]]) {
    // The rule before wide screens were handled: cells from the width alone.
    const cell = Math.floor((w - 96 - 11 * 24) / 12);
    const rows = Math.floor((h - 96 + 24) / (cell + 24));
    const g = gridFor(w, h)!;
    expect(g).toMatchObject({ cell, cellRows: rows, offsetX: 48 + (w - 96 - (12 * cell + 11 * 24)) / 2 });
  }
});
test("a box spans its cells and the gaps between them", () => {
  const g = gridFor(1080, 1920)!;
  expect(boxRect({ x: 0, y: 0, w: 8, h: 4 }, g)).toEqual({ left: 48, top: g.offsetY, width: 144, height: 60 });
});
test("text: M is 20px on a 1080 short side, 13.3 at 720; S/L/XL are 0.8/1.3/1.7 of it", () => {
  expect(textPx("M", 1080, 1920)).toBeCloseTo(19.98, 1);
  expect(textPx("M", 1280, 720)).toBeCloseTo(13.32, 1);
  expect(textPx("XL", 1080, 1920) / textPx("M", 1080, 1920)).toBeCloseTo(1.7, 5);
});
test("every screensaver widget has a minimum no larger than its default box", () => {
  for (const [k, s] of Object.entries(SAVER_WIDGETS)) {
    expect(s.min.w, k).toBeLessThanOrEqual(s.box.w);
    expect(s.min.h, k).toBeLessThanOrEqual(s.box.h);
  }
});

test("1080x1920: 48 columns of 21px steps, 88 rows", () => {
  const g = gridFor(1080, 1920)!;
  expect(g).toMatchObject({ columns: 48, cell: 60, step: 21, cellRows: 22, rows: 88 });
});
test("rows are exactly four steps per row of cells, so a box on the last row stays inside the 48px edge", () => {
  for (const [w, h] of [[1920, 1080], [1280, 800], [2552, 1274], [1080, 1920], [1280, 720]]) {
    const g = gridFor(w, h)!;
    expect(g.rows, `${w}x${h}`).toBe(g.cellRows * 4);
    const r = boxRect({ x: 0, y: g.rows - 4, w: 48, h: 4 }, g);
    expect(r.top + r.height, `${w}x${h}`).toBeLessThanOrEqual(h - 48 + 1e-9);
    expect(r.left + r.width, `${w}x${h}`).toBeLessThanOrEqual(w - 48 + 1e-9);
  }
});
test("a box on whole cells is drawn exactly where the 12-column grid drew it", () => {
  for (const [w, h] of [[1080, 1920], [1920, 1080], [1280, 720], [2552, 1274], [800, 1280]]) {
    const g = gridFor(w, h)!;
    const old = (x: number, y: number, bw: number, bh: number) => ({
      left: g.offsetX + x * (g.cell + 24), top: g.offsetY + y * (g.cell + 24),
      width: bw * g.cell + (bw - 1) * 24, height: bh * g.cell + (bh - 1) * 24,
    });
    for (const [x, y, bw, bh] of [[0, 0, 5, 6], [7, 1, 5, 3], [11, 4, 1, 1]]) {
      const r = boxRect({ x: x * 4, y: y * 4, w: bw * 4, h: bh * 4 }, g);
      const o = old(x, y, bw, bh);
      for (const k of ["left", "top", "width", "height"] as const) expect(r[k]).toBeCloseTo(o[k], 6);
    }
  }
});
test("two boxes one step apart are drawn with exactly the gap between them", () => {
  const g = gridFor(1080, 1920)!;
  const a = boxRect({ x: 0, y: 0, w: 9, h: 8 }, g);
  const b = boxRect({ x: 9, y: 0, w: 7, h: 8 }, g);
  expect(b.left - (a.left + a.width)).toBeCloseTo(24, 6);
});

test("value widgets: M fills the box, S fits into 80% of it, L and XL fill it (the box is the limit)", () => {
  const box = { width: 500, height: 200 };
  expect(valueBox(box, "M")).toEqual(box);
  expect(valueBox(box, "S")).toEqual({ width: 400, height: 160 });
  expect(valueBox(box, "L")).toEqual(box);
  expect(valueBox(box, "XL")).toEqual(box);
});
