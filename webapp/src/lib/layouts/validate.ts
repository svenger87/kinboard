/**
 * What a saved arrangement may contain, per surface (Home or the
 * screensaver). The server runs this on every save and the designer runs it
 * before offering one, so an arrangement the screens could not draw never
 * reaches the database. It takes `unknown` because it is the check on the
 * request body. Whether a Home item's person belongs to the family needs the
 * database and is checked on the server (checkHomePeople in server.ts).
 */
import { gridFor, GRID } from "./grid";
import { HOME_WIDGETS, widgetsFor } from "./widgets";
import type { HomeWidgetKey, LayoutItem, SaverWidgetKey, Surface, TextSize } from "./types";

export type LayoutError =
  | "unknown_widget"
  | "out_of_bounds"
  | "below_minimum"
  | "overlap"
  | "duplicate"
  | "bad_text_size"
  /** Home only: `options.personId` on a widget that is not per child, or not a person's id. */
  | "bad_person";

export type ValidateResult<K extends string = SaverWidgetKey> =
  | { ok: true; items: LayoutItem<K>[] }
  | { ok: false; error: LayoutError; itemId?: string };

const TEXT_SIZES: readonly string[] = ["S", "M", "L", "XL"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: LayoutError, itemId?: string) => ({ ok: false as const, error, itemId });

/** The person a Home item is for, or undefined for a widget shown for everyone. */
export function personOf(item: Pick<LayoutItem<string>, "options">): string | undefined {
  const p = item.options?.personId;
  return typeof p === "string" ? p : undefined;
}

export function validateItems(items: unknown, width: number, height: number, surface?: "screensaver"): ValidateResult<SaverWidgetKey>;
export function validateItems(items: unknown, width: number, height: number, surface: "home"): ValidateResult<HomeWidgetKey>;
export function validateItems(items: unknown, width: number, height: number, surface: Surface): ValidateResult<SaverWidgetKey> | ValidateResult<HomeWidgetKey>;
export function validateItems(
  items: unknown,
  width: number,
  height: number,
  surface: Surface = "screensaver",
): ValidateResult<string> {
  const grid = gridFor(width, height);
  if (!grid || !Array.isArray(items)) return fail("out_of_bounds");
  const catalogue: Record<string, { min: { w: number; h: number } }> = widgetsFor(surface);

  const out: LayoutItem<string>[] = [];
  const ids = new Set<string>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object") return fail("out_of_bounds");
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || r.id === "") return fail("out_of_bounds");
    const id = r.id;
    // rescaleItems keys by id, so two items may not share one.
    if (ids.has(id)) return fail("duplicate", id);
    ids.add(id);
    if (typeof r.widget !== "string" || !Object.hasOwn(catalogue, r.widget)) return fail("unknown_widget", id);
    if (typeof r.text !== "string" || !TEXT_SIZES.includes(r.text)) return fail("bad_text_size", id);
    const { x, y, w, h } = r;
    if (![x, y, w, h].every(Number.isInteger)) return fail("out_of_bounds", id);
    const item: LayoutItem<string> = {
      id,
      widget: r.widget,
      x: x as number,
      y: y as number,
      w: w as number,
      h: h as number,
      text: r.text as TextSize,
    };
    if (r.options && typeof r.options === "object" && !Array.isArray(r.options)) {
      item.options = r.options as Record<string, unknown>;
    }
    if (surface === "home" && item.options && Object.hasOwn(item.options, "personId")) {
      const p = item.options.personId;
      if (!HOME_WIDGETS[item.widget as HomeWidgetKey].perChild || typeof p !== "string" || !UUID.test(p)) {
        return fail("bad_person", id);
      }
    }
    out.push(item);
  }

  for (const i of out) {
    if (i.x < 0 || i.y < 0 || i.w < 1 || i.h < 1 || i.x + i.w > GRID.COLUMNS || i.y + i.h > grid.rows) {
      return fail("out_of_bounds", i.id);
    }
  }
  for (const i of out) {
    const { min } = catalogue[i.widget];
    if (i.w < min.w || i.h < min.h) return fail("below_minimum", i.id);
  }
  // Each widget once; on Home a per-child widget once per child (and once
  // for everyone, without a person).
  const seen = new Set<string>();
  for (const i of out) {
    const key = surface === "home" ? `${i.widget}\u0000${personOf(i) ?? ""}` : i.widget;
    if (seen.has(key)) return fail("duplicate", i.id);
    seen.add(key);
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
