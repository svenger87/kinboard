/**
 * The editor's commands on the selected boxes: move or resize them all by so
 * many steps. A command is applied to every selected box or to none: when
 * any box would leave the screen, go under its widget's minimum or land on
 * another, the whole command is refused with the reason, like the server's
 * check would refuse the save.
 */
import { GRID } from "./grid";
import { collides } from "./validate";
import { SAVER_WIDGETS } from "./widgets";
import type { LayoutItem } from "./types";

export type ArrangeReason = "out_of_bounds" | "below_minimum" | "overlap";
export type ArrangeResult = { ok: true; items: LayoutItem[] } | { ok: false; reason: ArrangeReason };

const refuse = (reason: ArrangeReason): ArrangeResult => ({ ok: false, reason });

/**
 * Whether the changed boxes are on the screen, at least their minimum and
 * off every other box. Boxes not named in `changed` are taken as they are.
 */
export function checkItems(items: LayoutItem[], changed: string[], rows: number): ArrangeResult {
  const ids = new Set(changed);
  const moved = items.filter((i) => ids.has(i.id));
  for (const i of moved) {
    if (i.x < 0 || i.y < 0 || i.x + i.w > GRID.COLUMNS || i.y + i.h > rows) return refuse("out_of_bounds");
  }
  for (const i of moved) {
    const { min } = SAVER_WIDGETS[i.widget];
    if (i.w < min.w || i.h < min.h) return refuse("below_minimum");
  }
  for (const i of moved) {
    if (items.some((o) => o.id !== i.id && collides(o, i))) return refuse("overlap");
  }
  return { ok: true, items };
}

function applyTo(items: LayoutItem[], ids: string[], change: (i: LayoutItem) => LayoutItem, rows: number): ArrangeResult {
  const selected = new Set(ids);
  const next = items.map((i) => (selected.has(i.id) ? change(i) : i));
  return checkItems(next, ids, rows);
}

/** The selected boxes moved by (dx, dy) steps, all or none. */
export function moveBy(items: LayoutItem[], ids: string[], dx: number, dy: number, rows: number): ArrangeResult {
  return applyTo(items, ids, (i) => ({ ...i, x: i.x + dx, y: i.y + dy }), rows);
}

/** The selected boxes made dw steps wider and dh taller from their top left corner, all or none. */
export function resizeBy(items: LayoutItem[], ids: string[], dw: number, dh: number, rows: number): ArrangeResult {
  return applyTo(items, ids, (i) => ({ ...i, w: i.w + dw, h: i.h + dh }), rows);
}
