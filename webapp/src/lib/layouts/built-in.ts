/**
 * Today's screensaver arrangement expressed as boxes, for a family that has
 * not drawn its own layout: the starting point of the designer and the
 * fallback on screens that follow the built-in. Portrait stacks news and the
 * weather on top, lists in the middle and the clock at the bottom; landscape
 * runs three columns. Rows are scarce on a landscape panel (6 at 1920x1080),
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
      box("news", 0, 0, 5, 6),
      box("date", 5, 0, 7, 1),
      box("weatherNow", 5, 1, 7, 1),
      box("forecast", 5, 2, 7, 3),
      box("events", 0, 6, 6, 5),
      box("birthdays", 6, 6, 6, 3),
      box("clock", 0, rows - 3, 6, 3),
    ];
  }
  return [
    box("news", 0, 0, 4, rows - 3),
    box("clock", 0, rows - 3, 4, 3),
    box("date", 4, 0, 4, 1),
    box("weatherNow", 4, 1, 4, 1),
    box("forecast", 4, 2, 4, 2),
    box("birthdays", 4, 4, 4, rows - 4),
    box("events", 8, 0, 4, rows),
  ];
}
