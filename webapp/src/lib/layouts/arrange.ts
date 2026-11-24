/**
 * The editor's commands on the selected boxes: move or resize them all by so
 * many steps. A command is applied to every selected box or to none: when
 * any box would leave the screen, go under its widget's minimum or land on
 * another, the whole command is refused with the reason, like the server's
 * check would refuse the save.
 *
 * Every command takes the surface last (the screensaver when left out): the
 * minimum a box may not go under is its widget's on that surface.
 */
import { GRID } from "./grid";
import { collides } from "./validate";
import { specOf } from "./place";
import type { LayoutItem, Surface } from "./types";

/** Any placed box, of either surface. */
type Item = LayoutItem<string>;

export type ArrangeReason = "out_of_bounds" | "below_minimum" | "overlap";
export type ArrangeResult<T extends Item = LayoutItem> = { ok: true; items: T[] } | { ok: false; reason: ArrangeReason };

const refuse = (reason: ArrangeReason) => ({ ok: false as const, reason });

/**
 * Whether the changed boxes are on the screen, at least their minimum and
 * off every other box. Boxes not named in `changed` are taken as they are.
 */
export function checkItems<T extends Item>(items: T[], changed: string[], rows: number, surface: Surface = "screensaver"): ArrangeResult<T> {
  const ids = new Set(changed);
  const moved = items.filter((i) => ids.has(i.id));
  for (const i of moved) {
    if (i.x < 0 || i.y < 0 || i.x + i.w > GRID.COLUMNS || i.y + i.h > rows) return refuse("out_of_bounds");
  }
  for (const i of moved) {
    // A key the surface does not know has no minimum here; validateItems refuses it on save.
    const min = specOf(i.widget, surface)?.min ?? { w: 1, h: 1 };
    if (i.w < min.w || i.h < min.h) return refuse("below_minimum");
  }
  for (const i of moved) {
    if (items.some((o) => o.id !== i.id && collides(o, i))) return refuse("overlap");
  }
  return { ok: true, items };
}

function applyTo<T extends Item>(items: T[], ids: string[], change: (i: T) => T, rows: number, surface: Surface): ArrangeResult<T> {
  const selected = new Set(ids);
  const next = items.map((i) => (selected.has(i.id) ? change(i) : i));
  return checkItems(next, ids, rows, surface);
}

/** The selected boxes moved by (dx, dy) steps, all or none. */
export function moveBy<T extends Item>(items: T[], ids: string[], dx: number, dy: number, rows: number, surface: Surface = "screensaver"): ArrangeResult<T> {
  return applyTo(items, ids, (i) => ({ ...i, x: i.x + dx, y: i.y + dy }), rows, surface);
}

/** The selected boxes made dw steps wider and dh taller from their top left corner, all or none. */
export function resizeBy<T extends Item>(items: T[], ids: string[], dw: number, dh: number, rows: number, surface: Surface = "screensaver"): ArrangeResult<T> {
  return applyTo(items, ids, (i) => ({ ...i, w: i.w + dw, h: i.h + dh }), rows, surface);
}

export type AlignEdge = "left" | "right" | "top" | "bottom" | "hcenter" | "vcenter";

/**
 * The selected boxes lined up on one edge of the selection: left, right, top
 * or bottom to the outermost among them, or their centres (hcenter across,
 * vcenter up and down) on the centre of the selection's bounding box,
 * rounded down to a whole step. All or none.
 */
export function alignItems<T extends Item>(items: T[], ids: string[], edge: AlignEdge, rows: number, surface: Surface = "screensaver"): ArrangeResult<T> {
  const sel = items.filter((i) => ids.includes(i.id));
  if (sel.length === 0) return { ok: true, items };
  const left = Math.min(...sel.map((i) => i.x));
  const right = Math.max(...sel.map((i) => i.x + i.w));
  const top = Math.min(...sel.map((i) => i.y));
  const bottom = Math.max(...sel.map((i) => i.y + i.h));
  const to: Record<AlignEdge, (i: T) => T> = {
    left: (i) => ({ ...i, x: left }),
    right: (i) => ({ ...i, x: right - i.w }),
    top: (i) => ({ ...i, y: top }),
    bottom: (i) => ({ ...i, y: bottom - i.h }),
    hcenter: (i) => ({ ...i, x: Math.floor((left + right - i.w) / 2) }),
    vcenter: (i) => ({ ...i, y: Math.floor((top + bottom - i.h) / 2) }),
  };
  return applyTo(items, ids, to[edge], rows, surface);
}

/**
 * Three or more selected boxes spaced evenly along x or y: the outermost two
 * stay, the free steps between them are shared out equally between
 * neighbours, and steps left over go one each to the gaps from the first on.
 * Fewer than three: nothing to spread, the items come back as they are.
 */
export function distribute<T extends Item>(items: T[], ids: string[], axis: "x" | "y", rows: number, surface: Surface = "screensaver"): ArrangeResult<T> {
  const pos = axis === "x" ? "x" : "y";
  const len = axis === "x" ? "w" : "h";
  const sel = items.filter((i) => ids.includes(i.id)).sort((a, b) => a[pos] - b[pos] || a[pos] + a[len] - (b[pos] + b[len]));
  if (sel.length < 3) return { ok: true, items };
  const first = sel[0];
  const last = sel[sel.length - 1];
  const inner = sel.slice(1, -1);
  const free = last[pos] - (first[pos] + first[len]) - inner.reduce((n, i) => n + i[len], 0);
  const gaps = sel.length - 1;
  const base = Math.floor(free / gaps);
  const extra = free - base * gaps;
  const placed = new Map<string, number>();
  let at = first[pos] + first[len];
  inner.forEach((i, n) => {
    at += base + (n < extra ? 1 : 0);
    placed.set(i.id, at);
    at += i[len];
  });
  return applyTo(items, ids, (i) => (placed.has(i.id) ? { ...i, [pos]: placed.get(i.id)! } : i), rows, surface);
}

/** Every selected box given the width (or height) of the first one selected, from its top left corner. All or none. */
export function matchSize<T extends Item>(items: T[], ids: string[], dim: "w" | "h", rows: number, surface: Surface = "screensaver"): ArrangeResult<T> {
  const ref = items.find((i) => i.id === ids[0]);
  if (!ref) return { ok: true, items };
  return applyTo(items, ids, (i) => ({ ...i, [dim]: ref[dim] }), rows, surface);
}

/** The four numbers that place a box, in steps. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One box put at a position and size given as numbers (the inspector's
 * fields): refused as out of bounds unless all four are whole steps, and
 * like any other command when it would leave the screen, go under the
 * widget's minimum or land on another box. An id not in the items changes nothing.
 */
export function setBox<T extends Item>(items: T[], id: string, box: Box, rows: number, surface: Surface = "screensaver"): ArrangeResult<T> {
  const { x, y, w, h } = box;
  if (![x, y, w, h].every(Number.isInteger)) return refuse("out_of_bounds");
  if (!items.some((i) => i.id === id)) return { ok: true, items };
  return applyTo(items, [id], (i) => ({ ...i, x, y, w, h }), rows, surface);
}
