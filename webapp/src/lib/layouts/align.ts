/**
 * Where a value widget (clock, date, next event, weather now, photo count)
 * sits across its box. Its text is only as wide as it is, so without this a
 * clock in the right-hand column would stop short of the screen's edge.
 * Automatic by the box's place on the grid: touching the right edge, to the
 * right; centred on the screen (or spanning it), centred; else to the left.
 * The inspector can set it per widget, stored as options.align.
 */
import { GRID } from "./grid";
import type { LayoutItem } from "./types";

export type Align = "start" | "center" | "end";
export const ALIGNS: readonly Align[] = ["start", "center", "end"];

/** The alignment the family set, or null for automatic (also for anything a newer build might have stored). */
export function storedAlign(item: Pick<LayoutItem, "options">): Align | null {
  const a = item.options?.align;
  return typeof a === "string" && (ALIGNS as readonly string[]).includes(a) ? (a as Align) : null;
}

/** The automatic alignment for a box at this place. */
export function autoAlign(item: Pick<LayoutItem, "x" | "w">): Align {
  const right = item.x + item.w === GRID.COLUMNS;
  if (item.x > 0 && right) return "end";
  if (item.x * 2 + item.w === GRID.COLUMNS) return "center";
  return "start";
}

export function alignOf(item: Pick<LayoutItem, "x" | "w" | "options">): Align {
  return storedAlign(item) ?? autoAlign(item);
}

/** The item with its alignment set, or back to automatic (null), keeping its other options. */
export function withAlign(item: LayoutItem, align: Align | null): LayoutItem {
  const { align: _old, ...rest } = item.options ?? {};
  const options = align ? { ...rest, align } : rest;
  const next: LayoutItem = { ...item };
  if (Object.keys(options).length > 0) next.options = options;
  else delete next.options;
  return next;
}
