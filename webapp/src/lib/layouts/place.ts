/**
 * Where the editor puts a widget: the first free spot for a new one, at its
 * default size or as near it as fits (positions are in steps, four to a
 * cell). Never overlapping or off the grid, like the server's check. The
 * arrow keys' moves are in arrange.ts.
 */
import { GRID } from "./grid";
import { collides } from "./validate";
import { SAVER_WIDGETS } from "./widgets";
import type { LayoutItem, SaverWidgetKey } from "./types";

type Box = Pick<LayoutItem, "x" | "y" | "w" | "h">;

/**
 * The first free box for a widget, scanning rows top to bottom and columns
 * left to right: at its default size if that fits anywhere, otherwise the
 * largest size between the default and its minimum that does. Null when not
 * even the minimum fits.
 */
export function firstFreeBox(items: LayoutItem[], widget: SaverWidgetKey, rows: number): Box | null {
  const { box, min } = SAVER_WIDGETS[widget];
  const sizes: { w: number; h: number }[] = [];
  for (let w = box.w; w >= min.w; w--) {
    for (let h = box.h; h >= min.h; h--) sizes.push({ w, h });
  }
  // Largest first; of two the same size, the wider (the default's shape is usually wide).
  sizes.sort((a, b) => b.w * b.h - a.w * a.h || b.w - a.w);
  for (const size of sizes) {
    const spot = firstFreeSpot(items, size, rows);
    if (spot) return spot;
  }
  return null;
}

/** The first spot a box of this size fits, rows top to bottom, columns left to right; null when none. */
export function firstFreeSpot(items: Box[], size: { w: number; h: number }, rows: number): Box | null {
  for (let y = 0; y + size.h <= rows; y++) {
    for (let x = 0; x + size.w <= GRID.COLUMNS; x++) {
      const candidate = { x, y, ...size };
      if (!items.some((i) => collides(i, candidate))) return candidate;
    }
  }
  return null;
}

/**
 * A placed box grown toward a size, one step-column at a time while it stays on
 * the grid and off the others, then one row at a time the same way.
 */
export function growToward(box: Box, target: { w: number; h: number }, others: Box[], rows: number): Box {
  const fits = (b: Box) => b.x + b.w <= GRID.COLUMNS && b.y + b.h <= rows && !others.some((o) => collides(o, b));
  let out = { ...box };
  while (out.w < target.w && fits({ ...out, w: out.w + 1 })) out = { ...out, w: out.w + 1 };
  while (out.h < target.h && fits({ ...out, h: out.h + 1 })) out = { ...out, h: out.h + 1 };
  return out;
}
