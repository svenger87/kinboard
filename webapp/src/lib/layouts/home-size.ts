/**
 * Home's sizes on a layout's own grid: its text size, and each widget's
 * minimum and default box in steps for that grid (RFC-022 §3.1, §3.3).
 *
 * A widget needs pixels (ems of its text and 48px touch targets, HomeNeed in
 * widgets.ts), but a box is counted in steps, and a step is 1/48 of the
 * layout's width: 38px on a 1920x1080 panel, 21px on the same panel turned
 * to portrait. Text follows the screen's short side, so it is the same on
 * both. A minimum in steps that held on one therefore held nothing on the
 * other (a 2-step date is 53px tall in landscape and 18px in portrait). Here
 * the pixels are turned into steps for the grid at hand, so the validation,
 * the designer and the built-in Home all share one rule.
 */
import { GRID, TEXT_FACTOR, gridFor, type Grid } from "./grid";
import { navHeightAt } from "./home-area";
import { HOME_WIDGETS } from "./widgets";
import type { HomeWidgetKey, Surface, TextSize } from "./types";

/**
 * Home's text at M: 18px on a screen 1080px on its short side, today's
 * Home's card titles (body text is 0.8em of it, 14.4px against today's 14px).
 * The screensaver's own scale (textPx) is a tenth larger and stays as it is.
 */
export const HOME_TEXT_BASE = 18 / 1080;

/**
 * The text size (px) of a Home box, for the area Home's grid gets
 * (homeArea). It follows the screen's short side, as the screensaver's
 * does; the short side is the screen's, not the area's, so a landscape
 * panel's bar does not make its text smaller than a portrait one's.
 */
export function homeTextPx(size: TextSize, width: number, height: number): number {
  const short = Math.min(width, height + navHeightAt(width));
  return HOME_TEXT_BASE * short * (TEXT_FACTOR[size] ?? 1);
}

/**
 * The steps a box needs to be `px` tall (or wide) on this grid: a box of n
 * steps is n·step − gap. A box may come up to a pixel short: boxes are drawn
 * at whole pixels, and on a 1280x720 panel (a 23.75px step) the step after
 * 47.25px is 71px, which a 48px target would otherwise always pay for.
 */
export function stepsFor(px: number, grid: Grid): number {
  return Math.max(1, Math.ceil((px - NEED_SLACK + GRID.GAP) / grid.step - 1e-6));
}

/** How many px a box may be short of a need (see stepsFor). */
const NEED_SLACK = 1;

/**
 * Home on an area of this size: what the editor's commands and the placing
 * of a new box are given, so a minimum is the one for that layout's grid.
 */
export interface HomeAt {
  surface: "home";
  width: number;
  height: number;
}

/** A surface, or Home on a given area. Plain "home" stands for HOME_REFERENCE. */
export type SurfaceAt = Surface | HomeAt;

/**
 * The area plain "home" is taken for: a 1920x1080 panel less its bar. Only
 * code without a layout at hand uses it (specs, a key check); everything
 * that draws or saves a Home passes its own area.
 */
export const HOME_REFERENCE = { width: 1920, height: 1007 } as const;

export function surfaceOf(at: SurfaceAt): Surface {
  return typeof at === "string" ? at : at.surface;
}

/** The area a Home minimum is worked out for. */
export function homeAreaOf(at: SurfaceAt): { width: number; height: number } {
  return typeof at === "string" ? HOME_REFERENCE : { width: at.width, height: at.height };
}

/** The steps a need of `px` takes on `grid`, at most the whole grid. */
function toSteps(need: { w: number; h: number }, grid: Grid, floor: { w: number; h: number }) {
  return {
    w: Math.min(GRID.COLUMNS, Math.max(floor.w, stepsFor(need.w, grid))),
    h: Math.min(grid.rows, Math.max(floor.h, stepsFor(need.h, grid))),
  };
}

/**
 * A Home widget's smallest box, in steps, at text size `text` on an area of
 * `width`x`height` (the screen less the navigation bar). Never more than the
 * grid: a need larger than the screen is met by the whole screen, and the
 * widget fits itself into that. Without a grid (too small a screen), its
 * need on the reference area.
 */
export function homeMin(widget: HomeWidgetKey, text: TextSize, width: number, height: number): { w: number; h: number } {
  const spec = HOME_WIDGETS[widget];
  const grid = gridFor(width, height) ?? gridFor(HOME_REFERENCE.width, HOME_REFERENCE.height)!;
  const em = homeTextPx(text, grid.width, grid.height);
  return toSteps(spec.need(em), grid, spec.floor ?? { w: 1, h: 1 });
}

/** The size a Home widget is drawn at on today's Home (its comfort need), in steps; its minimum when it has none. */
export function homeComfort(widget: HomeWidgetKey, text: TextSize, width: number, height: number): { w: number; h: number } {
  const spec = HOME_WIDGETS[widget];
  if (!spec.comfort) return homeMin(widget, text, width, height);
  const grid = gridFor(width, height) ?? gridFor(HOME_REFERENCE.width, HOME_REFERENCE.height)!;
  const em = homeTextPx(text, grid.width, grid.height);
  return toSteps(spec.comfort(em), grid, spec.floor ?? { w: 1, h: 1 });
}

/** The box a Home widget is dropped with: its default box, or its minimum where that is larger. */
export function homeBox(widget: HomeWidgetKey, text: TextSize, width: number, height: number): { w: number; h: number } {
  const min = homeComfort(widget, text, width, height);
  const box = HOME_WIDGETS[widget].box;
  return { w: Math.max(min.w, box.w), h: Math.max(min.h, box.h) };
}

/** The need of a widget in px at a text size on an area, for a spec or a probe. */
export function homeNeedPx(widget: HomeWidgetKey, text: TextSize, width: number, height: number): { w: number; h: number } {
  return HOME_WIDGETS[widget].need(homeTextPx(text, width, height));
}
