import { test, expect } from "@playwright/test";
import { alignOf, autoAlign, storedAlign, withAlign } from "../src/lib/layouts/align";
import type { LayoutItem } from "../src/lib/layouts/types";

/** Where a value widget sits across its box: automatic by its place on the 12 columns, or set. */

const item = (x: number, w: number, options?: Record<string, unknown>): LayoutItem => ({
  id: "clock",
  widget: "clock",
  x,
  y: 0,
  w,
  h: 2,
  text: "M",
  ...(options ? { options } : {}),
});

test("automatic: touching the right edge goes right, centred or full width goes centre, the rest left", () => {
  expect(autoAlign(item(8, 4))).toBe("end");
  expect(autoAlign(item(0, 4))).toBe("start");
  expect(autoAlign(item(3, 6))).toBe("center");
  expect(autoAlign(item(0, 12))).toBe("center");
  expect(autoAlign(item(2, 4))).toBe("start");
});

test("a set alignment wins; anything else stored counts as automatic", () => {
  expect(alignOf(item(8, 4, { align: "start" }))).toBe("start");
  expect(alignOf(item(0, 4, { align: "end" }))).toBe("end");
  expect(storedAlign(item(0, 4, { align: "justify" }))).toBeNull();
  expect(alignOf(item(8, 4, { align: 3 }))).toBe("end");
});

test("withAlign sets it, null goes back to automatic, other options stay", () => {
  const set = withAlign(item(0, 4, { other: 1 }), "center");
  expect(set.options).toEqual({ other: 1, align: "center" });
  expect(withAlign(set, null).options).toEqual({ other: 1 });
  expect("options" in withAlign(item(0, 4, { align: "end" }), null)).toBe(false);
});
