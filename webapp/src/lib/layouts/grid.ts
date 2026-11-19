/**
 * The grid layouts are drawn on: 12 columns, 48px edges, 24px gaps. The cell
 * size follows the screen width, so the same layout fills a 1080px panel and
 * the same panel at 150% (720px) alike. Text follows the short side instead,
 * because a width-based unit would make landscape text twice portrait's at
 * the same short side.
 */
import type { LayoutItem, TextSize } from "./types";

export const GRID = { EDGE: 48, GAP: 24, COLUMNS: 12, MIN_WIDTH: 600, MIN_ROWS: 6, MIN_CELL: 20 } as const;

export interface Grid {
  width: number;
  height: number;
  columns: 12;
  rows: number;
  cell: number;
  offsetX: number;
  offsetY: number;
}

/**
 * The grid for a screen, or null when it is too small to hold a layout.
 *
 * Twelve square columns across the width, as many rows as fit. On a screen
 * wider than about 1.85:1 (a desktop browser on a 2560x1440 monitor draws
 * 2552x1274, a 1920x1080 one with its tab bar about 1920x960) twelve columns
 * that wide leave fewer than six rows, so the cells shrink until six fit and
 * the columns sit centred, with the spare width shared as side margin. Every
 * screen that had six rows keeps exactly the grid it had.
 */
export function gridFor(width: number, height: number): Grid | null {
  if (width < GRID.MIN_WIDTH) return null;
  const { EDGE, GAP, COLUMNS, MIN_ROWS, MIN_CELL } = GRID;
  const byWidth = Math.floor((width - 2 * EDGE - (COLUMNS - 1) * GAP) / COLUMNS);
  const byHeight = Math.floor((height - 2 * EDGE - (MIN_ROWS - 1) * GAP) / MIN_ROWS);
  const cell = Math.min(byWidth, byHeight);
  if (cell < MIN_CELL) return null;
  const rows = Math.floor((height - 2 * EDGE + GAP) / (cell + GAP));
  if (rows < MIN_ROWS) return null;
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

/**
 * How much of its box a value widget (clock, date, next event, weather now,
 * photo count) fills at each text size. Those widgets size their text to the
 * box, so M fills it as before and S draws it smaller; L and XL fill it too,
 * since the box is the limit: a bigger value needs a bigger box.
 */
export const VALUE_FILL: Record<TextSize, number> = { S: 0.8, M: 1, L: 1, XL: 1 };

/** The box a value widget fits its text into at `size`. */
export function valueBox(box: { width: number; height: number }, size: TextSize): { width: number; height: number } {
  const f = VALUE_FILL[size] ?? 1;
  return { width: box.width * f, height: box.height * f };
}
