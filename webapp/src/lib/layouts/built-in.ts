/**
 * Today's screensaver arrangement expressed as boxes, for a family that has
 * not drawn its own layout: the starting point of the designer and the
 * fallback on screens that follow the built-in. Portrait: news top left,
 * weather and forecast top right (right-aligned), and a stack at the bottom
 * left: events, birthdays, then the clock with the date directly under it.
 * Landscape: news top left, weather and forecast top right, clock and date
 * bottom left, events bottom right; birthdays sit between the two columns
 * along the bottom. Rows are scarce on a landscape panel (6 at 1920x1080),
 * so heights shrink toward each widget's minimum there. The arrangement is
 * worked out in whole cells and returned in steps (four to a cell).
 */
import { GRID, gridFor, orientationOf } from "./grid";
import type { LayoutItem, SaverWidgetKey } from "./types";

export function builtInScreensaver(width: number, height: number): LayoutItem[] {
  const rows = gridFor(width, height)?.cellRows ?? GRID.MIN_ROWS;
  const S = GRID.STEPS_PER_CELL;
  const box = (widget: SaverWidgetKey, x: number, y: number, w: number, h: number): LayoutItem => ({
    id: widget, widget, x: x * S, y: y * S, w: w * S, h: h * S, text: "M",
  });

  if (orientationOf(width, height) === "portrait") {
    // The left column is stacked from the bottom: date, clock, birthdays,
    // events, news. With rows to spare it is today's arrangement; when they
    // are scarce events and birthdays shrink toward their minimums first,
    // then birthdays go, then news, so nothing is ever below its minimum.
    const clockH = rows < 7 ? 2 : 3;
    const avail = rows - 1 - clockH; // rows above the clock for news, events, birthdays
    let news = 0;
    let events = 0;
    let birthdays = 0;
    if (avail >= 10) {
      // 7 = events 4 + birthdays 3 at full size; news takes the rest, up to 6.
      events = 4;
      birthdays = 3;
      news = Math.min(6, avail - 7);
    } else if (avail >= 8) {
      // Everything at least at its minimum; spare rows go to events first.
      birthdays = 2;
      events = Math.min(4, avail - 5);
      news = avail - events - birthdays;
    } else if (avail >= 6) {
      events = Math.min(4, avail - 3); // birthdays dropped
      news = avail - events;
    } else {
      events = Math.min(4, avail); // news dropped too
    }
    const items: LayoutItem[] = [];
    if (news) items.push(box("news", 0, 0, 5, news));
    items.push(box("weatherNow", 7, 0, 5, 1), box("forecast", 7, 1, 5, 3));
    let y = rows - 1 - clockH;
    items.push(box("clock", 0, y, 6, clockH), box("date", 0, rows - 1, 6, 1));
    if (birthdays) {
      y -= birthdays;
      items.push(box("birthdays", 0, y, 6, birthdays));
    }
    y -= events;
    items.push(box("events", 0, y, 6, events));
    return items;
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
