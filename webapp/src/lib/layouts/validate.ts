/**
 * What a saved screensaver may contain. The server runs this on every save
 * and the designer runs it before offering one, so an arrangement the
 * screens could not draw never reaches the database. It takes `unknown`
 * because it is the check on the request body.
 */
import { gridFor, GRID } from "./grid";
import { SAVER_WIDGETS } from "./widgets";
import type { LayoutItem, SaverWidgetKey, TextSize } from "./types";

export type LayoutError =
  | "unknown_widget"
  | "out_of_bounds"
  | "below_minimum"
  | "overlap"
  | "duplicate"
  | "bad_text_size";

export type ValidateResult =
  | { ok: true; items: LayoutItem[] }
  | { ok: false; error: LayoutError; itemId?: string };

const TEXT_SIZES: readonly string[] = ["S", "M", "L", "XL"];
const fail = (error: LayoutError, itemId?: string): ValidateResult => ({ ok: false, error, itemId });

export function validateItems(items: unknown, width: number, height: number): ValidateResult {
  const grid = gridFor(width, height);
  if (!grid || !Array.isArray(items)) return fail("out_of_bounds");

  const out: LayoutItem[] = [];
  const ids = new Set<string>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object") return fail("out_of_bounds");
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || r.id === "") return fail("out_of_bounds");
    const id = r.id;
    // rescaleItems keys by id, so two items may not share one.
    if (ids.has(id)) return fail("duplicate", id);
    ids.add(id);
    if (typeof r.widget !== "string" || !Object.hasOwn(SAVER_WIDGETS, r.widget)) return fail("unknown_widget", id);
    if (typeof r.text !== "string" || !TEXT_SIZES.includes(r.text)) return fail("bad_text_size", id);
    const { x, y, w, h } = r;
    if (![x, y, w, h].every(Number.isInteger)) return fail("out_of_bounds", id);
    const item: LayoutItem = {
      id,
      widget: r.widget as SaverWidgetKey,
      x: x as number,
      y: y as number,
      w: w as number,
      h: h as number,
      text: r.text as TextSize,
    };
    if (r.options && typeof r.options === "object" && !Array.isArray(r.options)) {
      item.options = r.options as Record<string, unknown>;
    }
    out.push(item);
  }

  for (const i of out) {
    if (i.x < 0 || i.y < 0 || i.w < 1 || i.h < 1 || i.x + i.w > GRID.COLUMNS || i.y + i.h > grid.rows) {
      return fail("out_of_bounds", i.id);
    }
  }
  for (const i of out) {
    const { min } = SAVER_WIDGETS[i.widget];
    if (i.w < min.w || i.h < min.h) return fail("below_minimum", i.id);
  }
  const seen = new Set<string>();
  for (const i of out) {
    if (seen.has(i.widget)) return fail("duplicate", i.id);
    seen.add(i.widget);
  }
  for (let a = 0; a < out.length; a++) {
    for (let b = a + 1; b < out.length; b++) {
      if (collides(out[a], out[b])) return fail("overlap", out[b].id);
    }
  }
  return { ok: true, items: out };
}

/** Whether two boxes share at least one cell. */
export function collides(a: Pick<LayoutItem, "x" | "y" | "w" | "h">, b: Pick<LayoutItem, "x" | "y" | "w" | "h">): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
