import { test, expect } from "@playwright/test";
import { nextFitSize } from "../src/hooks/use-fit-to-box";

/**
 * useFitToBox's step from the rendered size to the one that fits: a value
 * never stays at a size that is too large for its box (the screen matrix
 * found the date 8px past its box at 1920×1080 and the clock 4px at 1080×1920
 * while a one-pixel change either way was ignored), and a one-pixel growth is
 * still ignored, so the size cannot flip at a boundary.
 */

test("a fitted value shrinks by a single pixel when that is what fits", () => {
  expect(nextFitSize(100, 99)).toBe(99);
  expect(nextFitSize(100, 90)).toBe(90);
});

test("a one-pixel growth is ignored, a larger one is taken", () => {
  expect(nextFitSize(100, 101)).toBe(100);
  expect(nextFitSize(100, 102)).toBe(102);
  expect(nextFitSize(null, 57)).toBe(57);
});
