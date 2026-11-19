/**
 * The screensaver widgets a family can place, with the smallest box each
 * stays readable in and the box it starts with when dropped on the grid.
 * "list" widgets show more rows the taller they get, "value" widgets show
 * one thing, "fixed" widgets are drawn at one arrangement. Sizes are in
 * steps (four to a cell); the table lists them in cells.
 */
import { GRID } from "./grid";
import type { SaverWidgetKey } from "./types";

export interface WidgetSpec {
  kind: "list" | "value" | "fixed";
  min: { w: number; h: number };
  box: { w: number; h: number };
}

const S = GRID.STEPS_PER_CELL;

/** A widget's minimum and default box, given in cells and stored in steps. */
const spec = (
  kind: WidgetSpec["kind"],
  w: number,
  h: number,
  box: { w: number; h: number } = { w, h },
): WidgetSpec => ({ kind, min: { w: w * S, h: h * S }, box: { w: box.w * S, h: box.h * S } });

export const SAVER_WIDGETS: Record<SaverWidgetKey, WidgetSpec> = {
  clock: spec("value", 4, 2, { w: 6, h: 3 }),
  date: spec("value", 3, 1),
  nextEvent: spec("value", 4, 1),
  weatherNow: spec("value", 2, 1),
  forecast: spec("fixed", 4, 2),
  events: spec("list", 4, 3, { w: 6, h: 5 }),
  birthdays: spec("list", 4, 2),
  holidays: spec("list", 4, 2),
  news: spec("list", 4, 3, { w: 5, h: 6 }),
  lessons: spec("list", 4, 2),
  // As small as one line of figures (half a cell high); dropped on the grid at the old size.
  energy: spec("fixed", 2, 1, { w: 3, h: 2 }),
  vehicles: spec("fixed", 2, 1, { w: 3, h: 2 }),
  photoCount: spec("value", 1, 1),
};

/**
 * The items whose widget this build knows. A layout saved by a newer version
 * (a widget added later, then a rollback) must not crash a kiosk or the
 * editor: the unknown ones are left out, the rest draw as saved.
 */
export function knownWidgetItems<T extends { widget: string }>(items: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(items)) return [];
  return items.filter((i) => !!i && typeof i.widget === "string" && Object.hasOwn(SAVER_WIDGETS, i.widget));
}
