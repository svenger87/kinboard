/**
 * A saved Home whose boxes are smaller than today's minimums for its grid
 * (home-size.ts), made to fit them: what a screen draws for such a layout,
 * and what the designer's "Fit" saves (through fitItems).
 *
 * The minimums used to be fixed step counts, so a layout saved before
 * they followed the pixels can hold a 2-step date that is 18px tall on a
 * portrait panel. Such a box is grown to its minimum, and whatever sits
 * below it moves down by as much, keeping the gaps that were there, so
 * nothing ever overlaps. If that runs past the last row, the steps are
 * taken back one at a time from the boxes on the way down that are larger
 * than they need, always the one with the most to spare, so no single box
 * (the clock, a list) pays for all of it. If even that cannot make it fit, the layout is left as it was and
 * each widget fits itself into its box as well as it can.
 */
import { gridFor, GRID } from "./grid";
import { homeMin } from "./home-size";
import { collides } from "./validate";
import { HOME_WIDGETS } from "./widgets";
import type { HomeWidgetKey, LayoutItem } from "./types";

type Item = LayoutItem<string>;

export interface GrowResult<T extends Item> {
  items: T[];
  /** Ids of the boxes that moved or changed size. */
  changed: string[];
  /**
   * Whether every box is now at least its minimum. False also when the
   * heights could not be met within the rows: `items` are then the input,
   * unchanged. A width that had no room to grow leaves it false with the
   * rest fitted.
   */
  fits: boolean;
}

const known = (w: string): w is HomeWidgetKey => Object.hasOwn(HOME_WIDGETS, w);

/** Every box of a Home at least its minimum on this area, with nothing overlapping; see the file's comment. */
export function growToMinimums<T extends Item>(items: readonly T[], width: number, height: number): GrowResult<T> {
  const grid = gridFor(width, height);
  const same = { items: [...items], changed: [], fits: false };
  if (!grid) return same;
  const rows = grid.rows;
  const mins = items.map((i) => (known(i.widget) ? homeMin(i.widget, i.text, width, height) : { w: 1, h: 1 }));
  if (items.every((i, n) => i.w >= mins[n].w && i.h >= mins[n].h)) return { items: [...items], changed: [], fits: true };

  // Widths: grown to the right, else to the left, else moved over, where no other box is in the way.
  const boxes = items.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h }));
  items.forEach((_, n) => {
    const want = Math.min(GRID.COLUMNS, mins[n].w);
    const b = boxes[n];
    if (b.w >= want) return;
    const others = boxes.filter((_, m) => m !== n);
    for (const x of [b.x, b.x + b.w - want, GRID.COLUMNS - want]) {
      const tried = { ...b, x, w: want };
      if (x >= 0 && x + want <= GRID.COLUMNS && !others.some((o) => collides(o, tried))) {
        boxes[n] = tried;
        break;
      }
    }
  });

  // Heights: each at least its minimum; then the boxes are stacked again.
  const heights = boxes.map((b, n) => Math.max(b.h, Math.min(rows, mins[n].h)));
  // Top to bottom as saved; a box is below another it shares columns with if it started lower.
  const order = boxes.map((_, n) => n).sort((a, b) => boxes[a].y - boxes[b].y || boxes[a].x - boxes[b].x);
  const across = (a: number, b: number) => boxes[a].x < boxes[b].x + boxes[b].w && boxes[b].x < boxes[a].x + boxes[a].w;
  // The room each box keeps above it as saved: its gap to the nearest box
  // above that shares its columns, or its row when nothing is above it.
  const above = (i: number, j: number) => across(i, j) && boxes[j].y + boxes[j].h <= boxes[i].y && j !== i;
  const lead = boxes.map((b, i) =>
    Math.min(b.y, ...boxes.map((o, j) => (above(i, j) ? b.y - (o.y + o.h) : Infinity))),
  );
  // Stacked again from the top: each box right under the lowest of those
  // above it, plus its own room. A box moves up as well as down.
  const stack = () => {
    const top = new Array<number>(boxes.length).fill(0);
    const pushedBy = new Array<number>(boxes.length).fill(-1);
    for (const i of order) {
      top[i] = lead[i];
      for (const j of order) {
        if (j === i || !(boxes[j].y < boxes[i].y || (boxes[j].y === boxes[i].y && boxes[j].x < boxes[i].x))) continue;
        // Above it as saved, or side by side before a width grew into it.
        if (!across(i, j)) continue;
        const under = top[j] + heights[j] + lead[i];
        if (under > top[i]) {
          top[i] = under;
          pushedBy[i] = j;
        }
      }
    }
    return { top, pushedBy };
  };

  let { top, pushedBy } = stack();
  const bottomOf = (n: number) => top[n] + heights[n];
  for (let guard = 0; guard < rows * boxes.length; guard++) {
    const last = boxes.map((_, n) => n).reduce((a, b) => (bottomOf(b) > bottomOf(a) ? b : a), 0);
    if (bottomOf(last) <= rows) break;
    // The chain of boxes that pushed the lowest one down: one of them gives up a step.
    const chain: number[] = [];
    for (let n = last; n >= 0 && !chain.includes(n); n = pushedBy[n]) chain.push(n);
    const spare = chain.filter((n) => heights[n] > mins[n].h);
    if (spare.length === 0) return same;
    // The one with the most to spare; of two alike, the higher one (the clock before the cards under it).
    const give = spare.reduce((a, b) => (heights[b] - mins[b].h > heights[a] - mins[a].h ? b : a));
    heights[give]--;
    ({ top, pushedBy } = stack());
  }

  const out = items.map((i, n) => ({ ...i, x: boxes[n].x, y: top[n], w: boxes[n].w, h: heights[n] }));
  const sound =
    out.every((i) => i.y >= 0 && i.y + i.h <= rows && i.x >= 0 && i.x + i.w <= GRID.COLUMNS) &&
    out.every((a, n) => out.every((b, m) => m <= n || !collides(a, b)));
  if (!sound) return same;
  const changed = out.filter((o, n) => o.x !== items[n].x || o.y !== items[n].y || o.w !== items[n].w || o.h !== items[n].h).map((o) => o.id);
  return { items: out, changed, fits: out.every((o, n) => o.w >= Math.min(GRID.COLUMNS, mins[n].w) && o.h >= Math.min(rows, mins[n].h)) };
}
