/**
 * Where the editor puts a widget: the first free spot for a new one, and a
 * one-cell step for the arrow keys. Both refuse rather than overlap or leave
 * the grid, like the server's check.
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
  for (const { w, h } of sizes) {
    for (let y = 0; y + h <= rows; y++) {
      for (let x = 0; x + w <= GRID.COLUMNS; x++) {
        const candidate = { x, y, w, h };
        if (!items.some((i) => collides(i, candidate))) return candidate;
      }
    }
  }
  return null;
}

/** The items with one moved by (dx, dy) cells, or null when that leaves the grid or lands on another. */
export function nudge(items: LayoutItem[], id: string, dx: number, dy: number, rows: number): LayoutItem[] | null {
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  const moved = { ...item, x: item.x + dx, y: item.y + dy };
  if (moved.x < 0 || moved.y < 0 || moved.x + moved.w > GRID.COLUMNS || moved.y + moved.h > rows) return null;
  if (items.some((i) => i.id !== id && collides(i, moved))) return null;
  return items.map((i) => (i.id === id ? moved : i));
}
