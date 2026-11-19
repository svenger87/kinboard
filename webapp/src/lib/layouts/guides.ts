/**
 * The editor's guides and snapping. A guide is a line across the screen that
 * the box being dragged lines up with: another box's left, right or centre,
 * or the screen's centre, wherever the box's own left, right or centre lies
 * on it. On a drop the box is moved by at most a step (`threshold`) so one of
 * them does; never onto another box or off the screen. The screen's edges
 * are no lines: the grid already stops a box there. All in steps; a centre
 * may be at half a step, and a box is never moved to half a step.
 */
import { collides } from "./validate";
import type { Box } from "./arrange";

/** The lines a box lies on, across (x) and up and down (y), in steps. */
export type Guides = { x: number[]; y: number[] };

type Axis = "x" | "y";

const start = (b: Box, a: Axis) => (a === "x" ? b.x : b.y);
const size = (b: Box, a: Axis) => (a === "x" ? b.w : b.h);
/** A box's left, right and centre (or top, bottom and middle). */
const features = (b: Box, a: Axis) => [start(b, a), start(b, a) + size(b, a), start(b, a) + size(b, a) / 2];

/** The lines a box can line up with on one axis: every other box's edges and centre, and the screen's centre. */
function candidates(others: Box[], a: Axis, extent: number): number[] {
  return [...new Set([...others.flatMap((o) => features(o, a)), extent / 2])];
}

/** Whether a box is on the screen and off every other box. */
function fits(b: Box, others: Box[], columns: number, rows: number): boolean {
  return b.x >= 0 && b.y >= 0 && b.x + b.w <= columns && b.y + b.h <= rows && !others.some((o) => collides(o, b));
}

/**
 * The smallest whole move, at most `threshold` steps, that puts one of
 * `points` on one of `lines`; 0 when one already is or none is in reach.
 * Of two equally near moves, the one to the left (or up) wins.
 */
function nearestMove(points: number[], lines: number[], threshold: number): number {
  let best: number | null = null;
  for (const p of points) {
    for (const l of lines) {
      const d = l - p;
      if (!Number.isInteger(d) || Math.abs(d) > threshold) continue;
      if (best === null || Math.abs(d) < Math.abs(best) || (Math.abs(d) === Math.abs(best) && d < best)) best = d;
    }
  }
  return best ?? 0;
}

/** The lines among the others' edges and centres (and the screen's centre) that the box's left, right or centre lie on, per axis. */
export function guidesFor(box: Box, others: Box[], columns: number, rows: number): Guides {
  const on = (a: Axis, extent: number) => {
    const own = features(box, a);
    return candidates(others, a, extent).filter((l) => own.includes(l));
  };
  return { x: on("x", columns), y: on("y", rows) };
}

/**
 * The box moved, not resized, by at most `threshold` steps on each axis so
 * that its nearest edge or centre lies on a line; unchanged when no line is
 * in reach, or when the moved box would overlap another or leave the screen.
 */
export function snapBox(box: Box, others: Box[], columns: number, rows: number, threshold = 1): Box {
  const dx = nearestMove(features(box, "x"), candidates(others, "x", columns), threshold);
  const dy = nearestMove(features(box, "y"), candidates(others, "y", rows), threshold);
  if (dx === 0 && dy === 0) return box;
  const next = { ...box, x: box.x + dx, y: box.y + dy };
  return fits(next, others, columns, rows) ? next : box;
}

/**
 * The box after a resize from its bottom right corner, with only the edge
 * that moved (`right` or `bottom`) brought onto the nearest line within
 * `threshold` steps; unchanged when none is in reach, or when the box would
 * then overlap another, leave the screen or have no size.
 */
export function snapEdge(box: Box, others: Box[], columns: number, rows: number, edge: "right" | "bottom", threshold = 1): Box {
  const a: Axis = edge === "right" ? "x" : "y";
  const d = nearestMove([start(box, a) + size(box, a)], candidates(others, a, a === "x" ? columns : rows), threshold);
  if (d === 0) return box;
  const next = a === "x" ? { ...box, w: box.w + d } : { ...box, h: box.h + d };
  return size(next, a) > 0 && fits(next, others, columns, rows) ? next : box;
}
