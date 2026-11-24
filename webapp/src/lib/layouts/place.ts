/**
 * Where the editor puts a widget: the first free spot for a new one, at its
 * default size or as near it as fits (positions are in steps, four to a
 * cell). Never overlapping or off the grid, like the server's check. The
 * arrow keys' moves are in arrange.ts. Per surface: Home's widgets
 * (HOME_WIDGETS) have other minimums and boxes than the screensaver's, and
 * some keys (clock, date, vehicles, holidays) are on both with different ones.
 */
import { GRID } from "./grid";
import { collides } from "./validate";
import { widgetsFor, type HomeWidgetKind, type WidgetSpec } from "./widgets";
import type { HomeWidgetKey, LayoutItem, SaverWidgetKey, Surface } from "./types";

type Box = Pick<LayoutItem, "x" | "y" | "w" | "h">;

/** What placing a widget needs to know of it: its kind, its smallest box and the one it is dropped with, in steps. */
export interface PlaceSpec {
  kind: WidgetSpec["kind"] | HomeWidgetKind;
  min: { w: number; h: number };
  box: { w: number; h: number };
}

/**
 * A widget's minimum and default box on a surface, or undefined for a key the
 * surface does not have (a layout saved by a newer build). The screensaver is
 * the default, as before Home had widgets.
 */
export function specOf(widget: string, surface: Surface = "screensaver"): PlaceSpec | undefined {
  const catalogue: Record<string, PlaceSpec> = widgetsFor(surface);
  return Object.hasOwn(catalogue, widget) ? catalogue[widget] : undefined;
}

/**
 * The first free box for a widget, scanning rows top to bottom and columns
 * left to right: at its default size if that fits anywhere, otherwise the
 * largest size between the default and its minimum that does. Null when not
 * even the minimum fits.
 */
export function firstFreeBox(items: Box[], widget: SaverWidgetKey, rows: number, surface?: "screensaver"): Box | null;
export function firstFreeBox(items: Box[], widget: HomeWidgetKey, rows: number, surface: "home"): Box | null;
export function firstFreeBox(items: Box[], widget: string, rows: number, surface: Surface): Box | null;
export function firstFreeBox(items: Box[], widget: string, rows: number, surface: Surface = "screensaver"): Box | null {
  const spec = specOf(widget, surface);
  if (!spec) return null;
  const { box, min } = spec;
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
