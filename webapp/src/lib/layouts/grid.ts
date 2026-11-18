/**
 * The grid layouts are drawn on: 12 columns, 48px edges, 24px gaps. The cell
 * size follows the screen width, so the same layout fills a 1080px panel and
 * the same panel at 150% (720px) alike. Text follows the short side instead,
 * because a width-based unit would make landscape text twice portrait's at
 * the same short side.
 */
import type { LayoutItem, TextSize } from "./types";

export const GRID = { EDGE: 48, GAP: 24, COLUMNS: 12, MIN_WIDTH: 600, MIN_ROWS: 6 } as const;

export interface Grid {
  width: number;
  height: number;
  columns: 12;
  rows: number;
  cell: number;
  offsetX: number;
  offsetY: number;
}

/** The grid for a screen, or null when it is too small to hold a layout. */
export function gridFor(width: number, height: number): Grid | null {
  if (width < GRID.MIN_WIDTH) return null;
  const { EDGE, GAP, COLUMNS } = GRID;
  const cell = Math.floor((width - 2 * EDGE - (COLUMNS - 1) * GAP) / COLUMNS);
  if (cell < 1) return null;
  const rows = Math.floor((height - 2 * EDGE + GAP) / (cell + GAP));
  if (rows < GRID.MIN_ROWS) return null;
  const usedW = COLUMNS * cell + (COLUMNS - 1) * GAP;
  const usedH = rows * cell + (rows - 1) * GAP;
  return {
    width,
    height,
    columns: COLUMNS,
    rows,
    cell,
    offsetX: EDGE + (width - 2 * EDGE - usedW) / 2,
    offsetY: EDGE + (height - 2 * EDGE - usedH) / 2,
  };
}

/** Pixel rectangle of a box: its cells plus the gaps between them. */
export function boxRect(
  item: Pick<LayoutItem, "x" | "y" | "w" | "h">,
  grid: Grid,
): { left: number; top: number; width: number; height: number } {
  const step = grid.cell + GRID.GAP;
  return {
    left: grid.offsetX + item.x * step,
    top: grid.offsetY + item.y * step,
    width: item.w * grid.cell + (item.w - 1) * GRID.GAP,
    height: item.h * grid.cell + (item.h - 1) * GRID.GAP,
  };
}

const TEXT_BASE = 0.0185; // of the short side: 20px at 1080, 13.3px at 720
const TEXT_FACTOR: Record<TextSize, number> = { S: 0.8, M: 1, L: 1.3, XL: 1.7 };

export function textPx(size: TextSize, width: number, height: number): number {
  return TEXT_BASE * Math.min(width, height) * TEXT_FACTOR[size];
}

/** A square screen counts as landscape. */
export function orientationOf(width: number, height: number): "portrait" | "landscape" {
  return height > width ? "portrait" : "landscape";
}

/**
 * Whether a screen's shape is far from a layout's: their aspect ratios differ
 * by more than 10% (the larger over the smaller). A screen drawing such a
 * layout gets it rescaled, and the settings say so.
 */
export function aspectDiffers(a: { width: number; height: number }, b: { width: number; height: number }): boolean {
  const ra = a.width / a.height;
  const rb = b.width / b.height;
  return Math.max(ra, rb) / Math.min(ra, rb) > 1.1;
}
