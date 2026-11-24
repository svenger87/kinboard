/**
 * The grid layouts are drawn on: 12 square cells across, 48px edges, and
 * positions stored in quarter-cell steps (48 columns), with the 24px gap
 * only between boxes, not between steps. The cell size follows the screen
 * width, so the same layout fills a 1080px panel and the same panel at 150%
 * (720px) alike. Text follows the short side instead, because a width-based
 * unit would make landscape text twice portrait's at the same short side.
 */
import type { LayoutItem, TextSize } from "./types";

/**
 * COLUMNS counts steps; a cell is STEPS_PER_CELL steps. MIN_ROWS counts
 * cells (rows of whole cells), like MIN_CELL and the cell size.
 */
export const GRID = { EDGE: 48, GAP: 24, COLUMNS: 48, STEPS_PER_CELL: 4, MIN_WIDTH: 600, MIN_ROWS: 6, MIN_CELL: 20 } as const;

/**
 * The grid marker a saved layout carries (layouts.grid,
 * migrations/087_layout_steps.sql): the columns its positions count. A row
 * with another value is in cells from before the steps and is not used.
 */
export const LAYOUT_GRID = 48;

/** The cells across the screen: 12. */
const CELLS = GRID.COLUMNS / GRID.STEPS_PER_CELL;

export interface Grid {
  width: number;
  height: number;
  /** Columns in steps: 48. */
  columns: 48;
  /** Rows in steps: exactly 4 × cellRows, so every box stays inside the edges. */
  rows: number;
  /** Rows of whole cells (the 12-column grid's rows). */
  cellRows: number;
  /** A cell's side in px; a cell plus a gap is four steps. */
  cell: number;
  /** A step in px: (cell + GAP) / 4, possibly fractional. */
  step: number;
  offsetX: number;
  offsetY: number;
}

/**
 * The grid for a screen, or null when it is too small to hold a layout.
 *
 * Twelve square cells across the width, as many rows as fit. On a screen
 * wider than about 1.85:1 (a desktop browser on a 2560x1440 monitor draws
 * 2552x1274, a 1920x1080 one with its tab bar about 1920x960) twelve columns
 * that wide leave fewer than six rows, so the cells shrink until six fit and
 * the columns sit centred, with the spare width shared as side margin. Every
 * screen that had six rows keeps exactly the grid it had. Positions count
 * steps, a quarter of a cell plus its gap: 48 across, and four per row of
 * whole cells down (a box's last step has no gap after it).
 */
export function gridFor(width: number, height: number): Grid | null {
  if (width < GRID.MIN_WIDTH) return null;
  const { EDGE, GAP, COLUMNS, STEPS_PER_CELL, MIN_ROWS, MIN_CELL } = GRID;
  const byWidth = Math.floor((width - 2 * EDGE - (CELLS - 1) * GAP) / CELLS);
  const byHeight = Math.floor((height - 2 * EDGE - (MIN_ROWS - 1) * GAP) / MIN_ROWS);
  const cell = Math.min(byWidth, byHeight);
  if (cell < MIN_CELL) return null;
  const cellRows = Math.floor((height - 2 * EDGE + GAP) / (cell + GAP));
  if (cellRows < MIN_ROWS) return null;
  const step = (cell + GAP) / STEPS_PER_CELL;
  // Whole cells' worth of steps only: a step past them would reach into the edge.
  const rows = cellRows * STEPS_PER_CELL;
  const usedW = CELLS * cell + (CELLS - 1) * GAP;
  const usedH = cellRows * cell + (cellRows - 1) * GAP;
  return {
    width,
    height,
    columns: COLUMNS,
    rows,
    cellRows,
    cell,
    step,
    offsetX: EDGE + (width - 2 * EDGE - usedW) / 2,
    offsetY: EDGE + (height - 2 * EDGE - usedH) / 2,
  };
}

/**
 * Pixel rectangle of a box: its steps less one gap, so two boxes side by
 * side always have exactly the gap between them. A box on whole cells is
 * drawn exactly where the 12-column grid drew it.
 */
export function boxRect(
  item: Pick<LayoutItem, "x" | "y" | "w" | "h">,
  grid: Grid,
): { left: number; top: number; width: number; height: number } {
  return {
    left: grid.offsetX + item.x * grid.step,
    top: grid.offsetY + item.y * grid.step,
    width: item.w * grid.step - GRID.GAP,
    height: item.h * grid.step - GRID.GAP,
  };
}

const TEXT_BASE = 0.0185; // of the short side: 20px at 1080, 13.3px at 720
export const TEXT_FACTOR: Record<TextSize, number> = { S: 0.8, M: 1, L: 1.3, XL: 1.7 };

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
