import { test, expect } from "@playwright/test";
import { firstFreeBox, specOf } from "../src/lib/layouts/place";
import { alignItems, checkItems, moveBy, resizeBy, setBox } from "../src/lib/layouts/arrange";
import { fitItems, rescaleItems } from "../src/lib/layouts/rescale";
import { builtInHome, builtInScreensaver } from "../src/lib/layouts/built-in";
import { gridFor } from "../src/lib/layouts/grid";
import { homeArea } from "../src/lib/layouts/home-area";
import { validateItems } from "../src/lib/layouts/validate";
import { SAVER_WIDGETS } from "../src/lib/layouts/widgets";
import { HOME_REFERENCE, homeBox, homeMin, type HomeAt } from "../src/lib/layouts/home-size";
import type { HomeLayoutItem, HomeWidgetKey, LayoutItem } from "../src/lib/layouts/types";

/**
 * The editor's maths per surface (RFC-022 step 6): placing a new widget,
 * the move/resize/align commands and redrawing for another size know Home's
 * widgets and minimums (HOME_WIDGETS, turned into steps for the layout's
 * area by home-size.ts), not only the screensaver's, and the screensaver's
 * answers are the ones they were. Some keys are on both
 * surfaces with different sizes (holidays: 16x8 on the screensaver, 12x4 on
 * Home), which is what makes the surface matter. Pure functions, no browser.
 */

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const area = homeArea(1080, 1920);
const rows = gridFor(area.width, area.height)!.rows;
/** Home on the 1080x1920 panel's area: what the editor passes. */
const AT: HomeAt = { surface: "home", ...area };
const min = (w: HomeWidgetKey, text: "S" | "M" | "L" | "XL" = "M") => homeMin(w, text, area.width, area.height);
const refRows = gridFor(HOME_REFERENCE.width, HOME_REFERENCE.height)!.rows;
const hi = (o: Partial<HomeLayoutItem> & { id: string; widget: HomeWidgetKey }): HomeLayoutItem => ({ x: 0, y: 0, w: 12, h: 12, text: "M", ...o });

test("Home's grid is the screen less the navigation bar", () => {
  // However tall the bar is at a width, Home keeps the width and loses some height.
  for (const [w, h] of [[1080, 1920], [1920, 1080], [800, 1280], [720, 1280], [600, 1024]] as const) {
    const a = homeArea(w, h);
    expect(a.width, `${w}x${h}`).toBe(w);
    expect(a.height, `${w}x${h}`).toBeLessThan(h);
  }
  // 1920x1080: the bar costs no row of cells there (24 steps either way); 1080x1920 loses one.
  const wide = homeArea(1920, 1080);
  expect(gridFor(wide.width, wide.height)!.rows).toBe(24);
  expect(rows).toBeLessThan(gridFor(1080, 1920)!.rows);
});

test("specOf answers per surface; an unknown key has none", () => {
  expect(specOf("holidays")).toEqual(SAVER_WIDGETS.holidays);
  expect(specOf("holidays", "screensaver")).toEqual(SAVER_WIDGETS.holidays);
  expect(specOf("holidays", AT)).toEqual({ kind: "list", min: min("holidays"), box: homeBox("holidays", "M", area.width, area.height) });
  // Home's minimum follows the box's text size, and plain "home" stands for a 1920x1080 panel.
  expect(specOf("holidays", AT, "XL")!.min.h).toBeGreaterThan(min("holidays").h);
  expect(specOf("holidays", "home")!.min).toEqual(homeMin("holidays", "M", HOME_REFERENCE.width, HOME_REFERENCE.height));
  expect(specOf("tasks", "screensaver")).toBeUndefined();
  expect(specOf("news", "home")).toBeUndefined();
  expect(specOf("toString", "home")).toBeUndefined();
});

test("firstFreeBox drops a Home widget at Home's default box; the screensaver's is unchanged", () => {
  expect(firstFreeBox([], "clock", rows, AT)).toEqual({ x: 0, y: 0, ...homeBox("clock", "M", area.width, area.height) });
  expect(firstFreeBox([], "clock", rows)).toEqual({ x: 0, y: 0, ...SAVER_WIDGETS.clock.box });
  expect(firstFreeBox([], "clock", rows, "screensaver")).toEqual({ x: 0, y: 0, ...SAVER_WIDGETS.clock.box });
  // Next to a 36-wide box only 12 columns are free: on a landscape panel Home's holidays (min 8) fit there, the screensaver's (min 16) go below.
  const wide = [{ x: 0, y: 0, w: 36, h: 8 }];
  expect(firstFreeBox(wide, "holidays", refRows, "home")).toEqual({ x: 36, y: 0, w: 12, h: 10 });
  // On the portrait panel the same 12 columns are 228px, too narrow for a list at M: it goes below.
  expect(firstFreeBox(wide, "holidays", rows, AT)).toMatchObject({ x: 0, y: 8 });
  expect(firstFreeBox(wide, "holidays", rows)).toEqual({ x: 0, y: 8, ...SAVER_WIDGETS.holidays.box });
  // A key the surface does not have gets no box.
  expect(firstFreeBox([], "news", rows, "home")).toBeNull();
});

test("move and resize hold Home's minimums for the layout's area, all or none", () => {
  const week = min("weekOverview");
  const hol = min("holidays");
  const items = [hi({ id: "week", widget: "weekOverview", ...week }), hi({ id: "h", widget: "holidays", x: 24, ...hol })];
  expect(resizeBy(items, ["week"], -1, 0, rows, AT)).toEqual({ ok: false, reason: "below_minimum" });
  expect(resizeBy(items, ["h"], 0, -1, rows, AT)).toEqual({ ok: false, reason: "below_minimum" });
  const grown = resizeBy(items, ["h"], 4, 4, rows, AT);
  expect(grown.ok && grown.items.find((i) => i.id === "h")).toMatchObject({ w: hol.w + 4, h: hol.h + 4 });
  expect(moveBy(items, ["h"], -1, 0, rows, AT)).toEqual({ ok: false, reason: "overlap" });
  expect(moveBy(items, ["h"], 0, rows, rows, AT)).toEqual({ ok: false, reason: "out_of_bounds" });
  // The same Home box judged as a screensaver one is under the screensaver's holidays minimum.
  expect(checkItems(items, ["h"], rows, AT).ok).toBe(true);
  expect(checkItems(items as LayoutItem<string>[], ["h"], rows)).toEqual({ ok: false, reason: "below_minimum" });
  expect(setBox(items, "h", { x: 24, y: 0, w: hol.w - 1, h: hol.h }, rows, AT)).toEqual({ ok: false, reason: "below_minimum" });
  // At XL the same box is under its minimum: the minimum follows the text size.
  expect(checkItems(items.map((i) => (i.id === "h" ? { ...i, text: "XL" as const } : i)), ["h"], rows, AT)).toEqual({ ok: false, reason: "below_minimum" });
  const aligned = alignItems([...items, hi({ id: "t", widget: "tasks", x: 0, y: 30, ...min("tasks") })], ["h", "t"], "top", rows, AT);
  expect(aligned.ok).toBe(false); // tasks to y 0 lands on the week overview
});

test("a box already under its minimum (saved for older minimums) can still be moved, not shrunk", () => {
  const items = [hi({ id: "d", widget: "date", w: 48, h: 2 })];
  expect(min("date").h).toBeGreaterThan(2);
  expect(moveBy(items, ["d"], 0, 1, rows, AT).ok).toBe(true);
  expect(resizeBy(items, ["d"], 0, 1, rows, AT).ok).toBe(true);
  expect(resizeBy(items, ["d"], 0, -1, rows, AT)).toEqual({ ok: false, reason: "below_minimum" });
});

test("the screensaver's commands answer as before when no surface is given", () => {
  const items = builtInScreensaver(1080, 1920);
  const grid = gridFor(1080, 1920)!;
  const clock = items.find((i) => i.widget === "clock")!;
  expect(resizeBy(items, [clock.id], 0, -(clock.h - SAVER_WIDGETS.clock.min.h) - 1, grid.rows)).toEqual({ ok: false, reason: "below_minimum" });
  expect(resizeBy(items, [clock.id], 0, -(clock.h - SAVER_WIDGETS.clock.min.h), grid.rows).ok).toBe(true);
  expect(moveBy(items, [clock.id], 0, 0, grid.rows)).toEqual(moveBy(items, [clock.id], 0, 0, grid.rows, "screensaver"));
});

test("rescaleItems holds Home's minimum heights", () => {
  const from = gridFor(area.width, area.height)!;
  const to = gridFor(homeArea(800, 1280).width, homeArea(800, 1280).height)!;
  expect(to.cellRows).toBeLessThan(from.cellRows);
  const items = [hi({ id: "week", widget: "weekOverview", x: 0, y: 0, w: 24, h: 8 }), hi({ id: "h", widget: "holidays", x: 24, y: 0, w: 12, h: 4 })];
  const out = rescaleItems(items, from, to, "home");
  expect(out.dropped).toEqual([]);
  for (const i of out.items) expect(i.h, i.id).toBeGreaterThanOrEqual(homeMin(i.widget, i.text, to.width, to.height).h);
});

test("fitItems redraws today's Home for another size: valid there, every item kept or listed, children kept apart", () => {
  const src = builtInHome(area.width, area.height, { scheduleChildren: [P1, P2] });
  expect(src.filter((i) => i.widget === "schedule")).toHaveLength(2);
  for (const [w, h] of [[1920, 1080], [1280, 720], [800, 1280], [720, 1280]] as const) {
    const to = homeArea(w, h);
    const out = fitItems(src, area, to, "home");
    expect(validateItems(out.items, to.width, to.height, "home").ok, `${w}x${h}`).toBe(true);
    expect([...out.items.map((i) => i.id), ...out.dropped].sort(), `${w}x${h}`).toEqual(src.map((i) => i.id).sort());
    for (const i of out.items.filter((x) => x.widget === "schedule")) expect(i.options?.personId).toBe(i.id.split(":")[1]);
  }
  // The same size: nothing moves.
  expect(fitItems(src, area, area, "home")).toEqual({ items: src, dropped: [] });
});

test("fitItems on the screensaver is as before: Home's keys are unknown there", () => {
  const src = builtInScreensaver(1080, 1920);
  const out = fitItems(src, { width: 1080, height: 1920 }, { width: 1280, height: 720 });
  expect(out).toEqual(fitItems(src, { width: 1080, height: 1920 }, { width: 1280, height: 720 }, "screensaver"));
  expect(validateItems(out.items, 1280, 720).ok).toBe(true);
  const homeOnly = fitItems([hi({ id: "tasks", widget: "tasks" })], { width: 1080, height: 1920 }, { width: 1080, height: 1920 });
  expect(homeOnly).toEqual({ items: [], dropped: ["tasks"] });
});
