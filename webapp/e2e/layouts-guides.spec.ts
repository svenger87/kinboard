import { test, expect } from "@playwright/test";
import { guidesFor, snapBox, snapEdge } from "../src/lib/layouts/guides";

/**
 * The editor's guides and snapping, which need no browser: the lines (other
 * boxes' left, right and centre, and the screen's centre) that a box's own
 * edges and centre lie on, and a box moved by at most one step so one of
 * them does. Positions in steps: 48 columns, 24 rows here.
 */

const COLS = 48;
const ROWS = 24;
const b = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

test("a box whose left is one step right of another's left snaps onto it", () => {
  const other = b(4, 0, 8, 4);
  expect(snapBox(b(5, 10, 8, 4), [other], COLS, ROWS)).toEqual(b(4, 10, 8, 4));
  // One step left of it, too.
  expect(snapBox(b(3, 10, 8, 4), [other], COLS, ROWS)).toEqual(b(4, 10, 8, 4));
});

test("two steps away is out of reach: the box stays", () => {
  const other = b(4, 0, 8, 4);
  // Left 6, right 14 and centre 10 are all two steps from the lines 4, 12 and 8.
  expect(snapBox(b(6, 10, 8, 4), [other], COLS, ROWS)).toEqual(b(6, 10, 8, 4));
});

test("a wider threshold reaches further", () => {
  expect(snapBox(b(6, 10, 8, 4), [b(4, 0, 8, 4)], COLS, ROWS, 2)).toEqual(b(4, 10, 8, 4));
});

test("a box's centre snaps to the screen's centre", () => {
  // Centre at 25 across, 13 up and down; the screen's is 24, 12.
  expect(snapBox(b(21, 9, 8, 8), [], COLS, ROWS)).toEqual(b(20, 8, 8, 8));
});

test("a centre that would need half a step is no candidate", () => {
  // Width 9: its centre is always at .5, never on the screen's 24.
  expect(snapBox(b(20, 3, 9, 4), [], COLS, ROWS)).toEqual(b(20, 3, 9, 4));
});

test("an edge already on a line keeps the box where it is", () => {
  // Left on the other's left; its right is one step off the other's right, but nearer wins.
  const other = b(4, 0, 8, 4);
  expect(snapBox(b(4, 10, 9, 4), [other], COLS, ROWS)).toEqual(b(4, 10, 9, 4));
});

test("a snap that would land on another box leaves it unchanged", () => {
  // Only a box that already lies over another can be snapped onto one: any
  // box in the way offers its own near edge as a line, which is never
  // further than the box can go. The editor's drag reports such a box while
  // the pointer is over a neighbour.
  const other = b(4, 0, 8, 4);
  expect(snapBox(b(5, 2, 8, 4), [other], COLS, ROWS)).toEqual(b(5, 2, 8, 4));
});

test("a snap that would leave the screen leaves it unchanged", () => {
  // The only line in reach is another box's right at 41, for the box's left
  // at 40: moved there its right would be 49, past the 48 columns.
  const other = b(30, 0, 11, 4);
  expect(snapBox(b(40, 10, 8, 4), [other], COLS, ROWS)).toEqual(b(40, 10, 8, 4));
  // The same line is fine for a narrower box.
  expect(snapBox(b(40, 10, 7, 4), [other], COLS, ROWS)).toEqual(b(41, 10, 7, 4));
});

test("guidesFor returns the x lines the box's left, right and centre lie on", () => {
  const others = [b(4, 0, 8, 4), b(30, 0, 6, 4)];
  // Left 4 on the first's left, right 36 on the second's right, centre 20 on nothing.
  const g = guidesFor(b(4, 10, 32, 4), others, COLS, ROWS);
  expect(g.x.sort((p, q) => p - q)).toEqual([4, 36]);
  // A centre on the screen's centre is a guide too, and a .5 centre on another's .5 centre.
  expect(guidesFor(b(20, 10, 8, 4), [], COLS, ROWS).x).toEqual([24]);
  expect(guidesFor(b(10, 10, 5, 4), [b(30, 0, 5, 4), b(10, 20, 5, 4)], COLS, ROWS).x.sort((p, q) => p - q)).toEqual([10, 12.5, 15]);
});

test("guidesFor returns the y lines and no line twice", () => {
  const others = [b(0, 0, 8, 4), b(10, 0, 8, 4)];
  // Top 4 on both others' bottoms: one line.
  expect(guidesFor(b(20, 4, 8, 4), others, COLS, ROWS).y).toEqual([4]);
  expect(guidesFor(b(30, 6, 8, 4), others, COLS, ROWS)).toEqual({ x: [], y: [] });
});

test("snapEdge moves only the right or the bottom edge, onto the nearest line", () => {
  const other = b(0, 0, 20, 10);
  expect(snapEdge(b(0, 12, 19, 4), [other], COLS, ROWS, "right")).toEqual(b(0, 12, 20, 4));
  expect(snapEdge(b(0, 12, 21, 4), [other], COLS, ROWS, "right")).toEqual(b(0, 12, 20, 4));
  expect(snapEdge(b(22, 0, 8, 11), [other], COLS, ROWS, "bottom")).toEqual(b(22, 0, 8, 10));
  // Two steps away: unchanged.
  expect(snapEdge(b(0, 12, 22, 4), [other], COLS, ROWS, "right")).toEqual(b(0, 12, 22, 4));
  // A box already over another (as a resize reports it mid-way) stays as it is.
  expect(snapEdge(b(0, 12, 23, 4), [other, b(20, 14, 4, 4)], COLS, ROWS, "right")).toEqual(b(0, 12, 23, 4));
});
