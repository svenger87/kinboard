/**
 * Today's screensaver arrangement expressed as boxes, for a family that has
 * not drawn its own layout: the starting point of the designer and the
 * fallback on screens that follow the built-in. Portrait: news top left,
 * weather and forecast top right (right-aligned), and a stack at the bottom
 * left: events, birthdays, then the clock with the date directly under it.
 * Landscape: news top left, weather and forecast top right, clock and date
 * bottom left, events bottom right; birthdays sit between the two columns
 * along the bottom. Rows are scarce on a landscape panel (6 at 1920x1080),
 * so heights shrink toward each widget's minimum there.
 */
import { gridFor, orientationOf } from "./grid";
import type { LayoutItem, SaverWidgetKey } from "./types";

export function builtInScreensaver(width: number, height: number): LayoutItem[] {
  const rows = gridFor(width, height)?.rows ?? 6;
  const box = (widget: SaverWidgetKey, x: number, y: number, w: number, h: number): LayoutItem => ({
    id: widget, widget, x, y, w, h, text: "M",
  });

  if (orientationOf(width, height) === "portrait") {
    return [
      box("news", 0, 0, 5, Math.min(6, rows - 11)),
      box("weatherNow", 7, 0, 5, 1),
      box("forecast", 7, 1, 5, 3),
      box("events", 0, rows - 11, 6, 4),
      box("birthdays", 0, rows - 7, 6, 3),
      box("clock", 0, rows - 4, 6, 3),
      box("date", 0, rows - 1, 6, 1),
    ];
  }
  return [
    box("news", 0, 0, 4, rows - 3),
    box("weatherNow", 8, 0, 4, 1),
    box("forecast", 8, 1, 4, 2),
    box("clock", 0, rows - 3, 4, 2),
    box("date", 0, rows - 1, 4, 1),
    box("events", 8, 3, 4, rows - 3),
    box("birthdays", 4, rows - 2, 4, 2),
  ];
}
