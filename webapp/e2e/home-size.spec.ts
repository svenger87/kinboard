import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { builtInHome } from "../src/lib/layouts/built-in";
import { boxRect, gridFor, textPx } from "../src/lib/layouts/grid";
import { homeArea } from "../src/lib/layouts/home-area";
import { HOME_TEXT_BASE, homeMin, homeNeedPx, homeTextPx } from "../src/lib/layouts/home-size";
import { growToMinimums } from "../src/lib/layouts/home-fit";
import { fitItems } from "../src/lib/layouts/rescale";
import { collides, validateItems } from "../src/lib/layouts/validate";
import { HOME_WIDGETS } from "../src/lib/layouts/widgets";
import type { HomeLayoutItem, HomeWidgetKey } from "../src/lib/layouts/types";

/**
 * Home's sizes follow pixels, not grid steps (home-size.ts). A step is 1/48
 * of the layout's width, so the same count of steps is 38px on a 1920x1080
 * panel and 21px on that panel turned to portrait, while text follows the
 * short side. Minimums in steps held in landscape and not in portrait: the
 * built-in Home's date was 18px tall on 1080x1920, with 20px text and a
 * 48px week badge, and it fitted itself down to dashes. Pure functions.
 */

/**
 * Screens of every shape that hold a grid. A step is width/48 and text
 * follows the short side, so steps per em go with the aspect ratio: 1.78 on
 * 16:9 (what the old step minimums were tuned on), 1.6 on 16:10, 1.33 on
 * 4:3, 1.0 in portrait, 2.37 on an ultrawide. One rule in px covers them all.
 */
const SCREENS: [number, number][] = [
  [1080, 1920], [720, 1280], [800, 1280], [1024, 768], [1280, 800], [1920, 1080], [2560, 1080], [1280, 720], [2560, 1440],
];
const TEXT = ["S", "M", "L", "XL"] as const;

/**
 * What each piece of the clock block needs on a 1080x1920 panel, measured
 * on today's Home at 18px card titles: the date on one line with its week
 * badge, a 48px touch target; the greeting's 24px line; a member's 64px
 * avatar with a 14px name and 13px status line under it (105px); the today
 * strip's 42px pills and its 48px "+n".
 */
const HEAD_NEEDS_1080: Record<string, number> = { date: 48, greeting: 24, familyMembers: 105, todayStrip: 48 };

test("the built-in Home's clock block holds what today's Home shows, on a portrait 1080x1920 panel", () => {
  const area = homeArea(1080, 1920);
  const grid = gridFor(area.width, area.height)!;
  const items = builtInHome(area.width, area.height);
  const short: string[] = [];
  for (const [widget, need] of Object.entries(HEAD_NEEDS_1080)) {
    const item = items.find((i) => i.widget === widget)!;
    // A box may come up a pixel short: boxes are drawn at whole pixels.
    const px = boxRect(item, grid).height;
    if (px < need - 1) short.push(`${widget} ${Math.round(px)}px < ${need}px`);
  }
  expect(short, "head boxes shorter than their content").toEqual([]);
});

test("on every shape of screen, the built-in Home's clock block holds what its pieces need", () => {
  const short: string[] = [];
  for (const [w, h] of SCREENS) {
    const area = homeArea(w, h);
    const grid = gridFor(area.width, area.height)!;
    for (const item of builtInHome(area.width, area.height).slice(0, 5)) {
      const need = homeNeedPx(item.widget, item.text, area.width, area.height).h;
      const px = boxRect(item, grid).height;
      if (px < need - 1) short.push(`${w}x${h} ${item.widget} ${Math.round(px)}px < ${Math.round(need)}px`);
    }
  }
  expect(short).toEqual([]);
});

test("a minimum box is as large as its widget's need, on every screen and text size, and a step less is not", () => {
  const loose: string[] = [];
  const short: string[] = [];
  for (const [w, h] of SCREENS) {
    const area = homeArea(w, h);
    const grid = gridFor(area.width, area.height)!;
    for (const text of TEXT) {
      for (const widget of Object.keys(HOME_WIDGETS) as HomeWidgetKey[]) {
        const min = homeMin(widget, text, area.width, area.height);
        const need = homeNeedPx(widget, text, area.width, area.height);
        const box = boxRect({ x: 0, y: 0, ...min }, grid);
        const tag = `${widget} ${text} ${w}x${h}`;
        if (min.h < grid.rows && box.height < need.h - 1) short.push(`${tag}: ${Math.round(box.height)}px tall < ${Math.round(need.h)}`);
        if (min.w < 48 && box.width < need.w - 1) short.push(`${tag}: ${Math.round(box.width)}px wide < ${Math.round(need.w)}`);
        // Tight: one step less would be short (except where a floor in steps decides).
        const floor = HOME_WIDGETS[widget].floor ?? { w: 1, h: 1 };
        if (min.h > Math.max(1, floor.h) && boxRect({ x: 0, y: 0, w: min.w, h: min.h - 1 }, grid).height >= need.h - 1) loose.push(`${tag} h`);
      }
    }
  }
  expect(short).toEqual([]);
  expect(loose).toEqual([]);
});

test("the same widget takes about twice the steps on a portrait panel as on the landscape one", () => {
  const p = homeArea(1080, 1920);
  const l = homeArea(1920, 1080);
  for (const widget of ["date", "familyMembers", "upcomingEvents", "birthday"] as const) {
    const portrait = homeMin(widget, "M", p.width, p.height).h;
    const landscape = homeMin(widget, "M", l.width, l.height).h;
    expect(portrait / landscape, widget).toBeGreaterThanOrEqual(1.5);
  }
});

test("Home's text: M is today's Home's 18px card title on a 1080 short side, either way round; S/L/XL step around it", () => {
  const portrait = homeArea(1080, 1920);
  const landscape = homeArea(1920, 1080);
  expect(homeTextPx("M", portrait.width, portrait.height)).toBeCloseTo(18, 5);
  expect(homeTextPx("M", landscape.width, landscape.height)).toBeCloseTo(18, 5);
  expect(homeTextPx("M", homeArea(720, 1280).width, homeArea(720, 1280).height)).toBeCloseTo(12, 5);
  expect(homeTextPx("XL", portrait.width, portrait.height) / homeTextPx("M", portrait.width, portrait.height)).toBeCloseTo(1.7, 5);
  expect(homeTextPx("S", portrait.width, portrait.height) / homeTextPx("M", portrait.width, portrait.height)).toBeCloseTo(0.8, 5);
  expect(HOME_TEXT_BASE * 1080).toBeCloseTo(18, 5);
  // The screensaver's scale is its own and unchanged.
  expect(textPx("M", 1080, 1920)).toBeCloseTo(19.98, 1);
});

/** A Home saved for a 1080x1920 kiosk while the minimums were 2 steps for the date, greeting and strip (14 boxes, S to L). */
const SAVED: HomeLayoutItem[] = JSON.parse(readFileSync(join(__dirname, "fixtures/home-portrait-step-minimums.json"), "utf8"));

test.describe("a Home saved under the old step minimums", () => {
  const area = homeArea(1080, 1920);
  const rows = gridFor(area.width, area.height)!.rows;

  test("is below today's minimums: the server would refuse it as it stands", () => {
    expect(validateItems(SAVED, area.width, area.height, "home")).toMatchObject({ ok: false, error: "below_minimum", itemId: "date" });
    expect(validateItems(SAVED, area.width, area.height, "home", { minimums: false })).toMatchObject({ ok: true });
  });

  test("is drawn grown to its minimums, nothing overlapping, nothing past the last row, nothing left out", () => {
    const out = growToMinimums(SAVED, area.width, area.height);
    expect(out.fits).toBe(true);
    expect(validateItems(out.items, area.width, area.height, "home")).toMatchObject({ ok: true });
    expect(out.items.map((i) => i.id).sort()).toEqual(SAVED.map((i) => i.id).sort());
    for (const a of out.items) for (const b of out.items) if (a !== b) expect(collides(a, b), `${a.id} ${b.id}`).toBe(false);
    expect(Math.max(...out.items.map((i) => i.y + i.h))).toBeLessThanOrEqual(rows);
    // The pieces of the clock block keep their order and their full width.
    const head = out.items.filter((i) => HOME_WIDGETS[i.widget].clockBlock).sort((a, b) => a.y - b.y);
    expect(head.map((i) => [i.widget, i.x, i.w])).toEqual(["clock", "date", "greeting", "familyMembers", "todayStrip"].map((k) => [k, 0, 48]));
    // The steps came from boxes with room to spare: the clock keeps its height, the cards gave theirs.
    expect(out.items.find((i) => i.id === "clock")!.h).toBe(9);
  });

  test("the designer's Fit (fitItems on its own size) is what the screen draws", () => {
    const fitted = fitItems(SAVED, area, area, "home");
    expect(fitted.dropped).toEqual([]);
    expect(fitted.items).toEqual(growToMinimums(SAVED, area.width, area.height).items);
  });

  test("a layout that already meets its minimums is drawn as saved", () => {
    const fine = builtInHome(area.width, area.height);
    expect(growToMinimums(fine, area.width, area.height)).toEqual({ items: fine, changed: [], fits: true });
  });

  test("when the rows cannot hold the minimums, it is drawn as saved", () => {
    // A column of boxes at exactly their minimum filling every row, and two too small: nothing has a step to give.
    const date = homeMin("date", "M", area.width, area.height).h;
    const stack: HomeLayoutItem[] = [{ id: "a", widget: "date", x: 0, y: 0, w: 48, h: 2, text: "M" }];
    let y = 2;
    while (y + date <= rows - 2) {
      stack.push({ id: `d${y}`, widget: "date", x: 0, y, w: 48, h: date, text: "M" });
      y += date;
    }
    stack.push({ id: "z", widget: "greeting", x: 0, y, w: 48, h: rows - y, text: "M" });
    const out = growToMinimums(stack, area.width, area.height);
    expect(out.fits).toBe(false);
    expect(out.items).toEqual(stack);
  });
});
