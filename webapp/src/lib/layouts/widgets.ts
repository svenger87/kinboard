/**
 * The screensaver widgets a family can place, with the smallest box each
 * stays readable in and the box it starts with when dropped on the grid.
 * "list" widgets show more rows the taller they get, "value" widgets show
 * one thing, "fixed" widgets are drawn at one arrangement.
 */
import type { SaverWidgetKey } from "./types";

export interface WidgetSpec {
  kind: "list" | "value" | "fixed";
  min: { w: number; h: number };
  box: { w: number; h: number };
}

const spec = (
  kind: WidgetSpec["kind"],
  w: number,
  h: number,
  box: { w: number; h: number } = { w, h },
): WidgetSpec => ({ kind, min: { w, h }, box });

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
  energy: spec("fixed", 3, 2),
  vehicles: spec("fixed", 3, 2),
  photoCount: spec("value", 1, 1),
};
