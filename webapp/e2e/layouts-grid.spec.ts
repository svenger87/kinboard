import { test, expect } from "@playwright/test";
import { gridFor, boxRect, textPx, valueBox } from "../src/lib/layouts/grid";
import { SAVER_WIDGETS } from "../src/lib/layouts/widgets";

/**
 * The layout designer places screensaver widgets on a 12-column grid whose
 * cell size follows the screen, so one layout looks the same on a 1080x1920
 * wall screen and on the same panel at 150% scaling. These tests pin the
 * maths every later piece of the designer builds on.
 */

test("1080x1920: 60px cells, 12 columns, 48px edges", () => {
  const g = gridFor(1080, 1920)!;
  expect(g.cell).toBe(60);
  expect(g.columns).toBe(12);
  expect(g.offsetX).toBe(48);
  expect(g.rows).toBe(22); // floor((1920-96+24)/84)
  expect(g.offsetY).toBe(48); // 22 rows fill 1824px exactly
});
test("720x1280 (1080x1920 at 150%): 30px cells", () => expect(gridFor(720, 1280)!.cell).toBe(30));
test("1920x1080: 130px cells", () => expect(gridFor(1920, 1080)!.cell).toBe(130));
test("below 600px wide or under 6 rows there is no grid", () => {
  expect(gridFor(599, 1000)).toBeNull();
  expect(gridFor(1920, 300)).toBeNull();
});
test("a box spans its cells and the gaps between them", () => {
  const g = gridFor(1080, 1920)!;
  expect(boxRect({ x: 0, y: 0, w: 2, h: 1 }, g)).toEqual({ left: 48, top: g.offsetY, width: 144, height: 60 });
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

test("value widgets: M fills the box, S fits into 80% of it, L and XL fill it (the box is the limit)", () => {
  const box = { width: 500, height: 200 };
  expect(valueBox(box, "M")).toEqual(box);
  expect(valueBox(box, "S")).toEqual({ width: 400, height: 160 });
  expect(valueBox(box, "L")).toEqual(box);
  expect(valueBox(box, "XL")).toEqual(box);
});
