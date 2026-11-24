import { test, expect } from "@playwright/test";
import { validateItems } from "../src/lib/layouts/validate";
import { builtInHome } from "../src/lib/layouts/built-in";
import { gridFor } from "../src/lib/layouts/grid";
import { HOME_WIDGETS, SAVER_WIDGETS, knownWidgetItems } from "../src/lib/layouts/widgets";
import { HOME_REFERENCE, homeBox, homeComfort, homeMin } from "../src/lib/layouts/home-size";
import { checkHomePeople } from "../src/lib/layouts/server";
import { DEFAULT_WIDGET_ORDER, DEFAULT_WIDGET_VISIBILITY } from "../src/types/widgets";
import type { HomeLayoutItem, HomeWidgetKey } from "../src/lib/layouts/types";

/**
 * Home's widget catalogue (RFC-022 step 1): the kinds and minimums each Home
 * widget is drawn with, validateItems per surface, and the built-in Home a
 * layout starts from. Pure functions, pinned here without a browser.
 * Positions are in steps, four to a cell: 48 columns.
 */

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const item = (o: Partial<HomeLayoutItem> & { id: string }): HomeLayoutItem => ({
  widget: "tasks", x: 0, y: 0, w: 24, h: 16, text: "M", ...o,
});
const home = (items: unknown, w = 1080, h = 1920) => validateItems(items, w, h, "home");

const SIZES: [number, number][] = [
  [1080, 1920], [720, 1280], [800, 1280], [600, 1024], [1920, 1080], [1280, 720], [1280, 800],
  [2560, 1440], [2552, 1274], [1024, 768], [800, 600], [3840, 2160],
];

test.describe("Home catalogue", () => {
  test("has every card of Settings -> Widgets and the five pieces of the clock block", () => {
    for (const k of DEFAULT_WIDGET_ORDER) expect(HOME_WIDGETS[k as HomeWidgetKey], k).toBeTruthy();
    for (const k of Object.keys(DEFAULT_WIDGET_VISIBILITY)) expect(Object.hasOwn(HOME_WIDGETS, k), k).toBe(true);
    const block = Object.entries(HOME_WIDGETS).filter(([, s]) => s.clockBlock).map(([k]) => k);
    expect(block.sort()).toEqual(["clock", "date", "familyMembers", "greeting", "todayStrip"]);
    expect(Object.keys(HOME_WIDGETS)).toHaveLength(DEFAULT_WIDGET_ORDER.length + 5);
  });

  test("kinds follow RFC-022 §3.1 and §3.2", () => {
    const kinds = Object.fromEntries(Object.entries(HOME_WIDGETS).map(([k, s]) => [k, s.kind]));
    expect(kinds).toEqual({
      clock: "value", date: "value", greeting: "value", familyMembers: "fixed", todayStrip: "list",
      weather: "value+fixed", upcomingEvents: "list", schedule: "fixed", birthday: "list", holidays: "list",
      weekOverview: "fixed", mealPlan: "list", wasteCollection: "list", notes: "list", tasks: "list",
      shopping: "list", vehicles: "fixed", stonks: "fixed", pocketMoney: "value", creatures: "fixed",
      photos: "fixed", timers: "fixed", media: "fixed", messages: "list", countdown: "list",
    });
  });

  test("only the schedule and pocket money are per child", () =>
    expect(Object.entries(HOME_WIDGETS).filter(([, s]) => s.perChild).map(([k]) => k).sort()).toEqual(["pocketMoney", "schedule"]));

  test("the week overview needs 24 steps of width; at M every other card fits a quarter of a landscape panel and half a portrait one", () => {
    const { width, height } = HOME_REFERENCE;
    for (const text of ["S", "M", "L", "XL"] as const) expect(homeMin("weekOverview", text, width, height).w).toBeGreaterThanOrEqual(24);
    for (const [k, s] of Object.entries(HOME_WIDGETS)) {
      if (k === "weekOverview" || s.clockBlock) continue;
      expect(homeMin(k as HomeWidgetKey, "M", width, height).w, k).toBeLessThanOrEqual(12);
      expect(homeMin(k as HomeWidgetKey, "M", 1080, 1847).w, k).toBeLessThanOrEqual(24);
    }
  });

  test("on every screen and text size, a default box is at least the minimum and fits the grid", () => {
    for (const [w, h] of SIZES) {
      const rows = gridFor(w, h)!.rows;
      for (const text of ["S", "M", "L", "XL"] as const) {
        for (const k of Object.keys(HOME_WIDGETS) as HomeWidgetKey[]) {
          const min = homeMin(k, text, w, h);
          const box = homeBox(k, text, w, h);
          expect(box.w, `${k} ${text} ${w}x${h}`).toBeGreaterThanOrEqual(min.w);
          expect(box.h, `${k} ${text} ${w}x${h}`).toBeGreaterThanOrEqual(min.h);
          expect(box.w, `${k} ${text} ${w}x${h}`).toBeLessThanOrEqual(48);
          expect(min.h, `${k} ${text} ${w}x${h}`).toBeLessThanOrEqual(rows);
        }
      }
    }
  });
});

test.describe("validateItems per surface", () => {
  test("Home accepts its widgets and returns them typed", () => {
    const items = [item({ id: "a" }), item({ id: "b", widget: "clock", x: 24, w: 24, h: 8 })];
    expect(home(items)).toEqual({ ok: true, items });
  });
  test("a screensaver-only widget is unknown on Home", () =>
    expect(home([item({ id: "a", widget: "news" as never })])).toEqual({ ok: false, error: "unknown_widget", itemId: "a" }));
  test("a Home-only widget is unknown on the screensaver, the default surface", () => {
    expect(validateItems([item({ id: "a" })], 1080, 1920)).toMatchObject({ error: "unknown_widget" });
    expect(validateItems([item({ id: "a" })], 1080, 1920, "screensaver")).toMatchObject({ error: "unknown_widget" });
  });
  test("Home's minimums apply: week overview 23 wide is below its minimum", () =>
    expect(home([item({ id: "a", widget: "weekOverview", w: 23, h: 8 })])).toEqual({ ok: false, error: "below_minimum", itemId: "a" }));
  test("the week overview at its minimum is accepted, a step lower is not", () => {
    const min = homeMin("weekOverview", "M", 1080, 1920);
    expect(home([item({ id: "a", widget: "weekOverview", ...min })])).toMatchObject({ ok: true });
    expect(home([item({ id: "a", widget: "weekOverview", ...min, h: min.h - 1 })])).toMatchObject({ error: "below_minimum" });
  });
  test("a minimum follows the text size: a box fine at M is below it at XL", () => {
    const min = homeMin("birthday", "M", 1080, 1920);
    expect(home([item({ id: "a", widget: "birthday", ...min })])).toMatchObject({ ok: true });
    expect(home([item({ id: "a", widget: "birthday", ...min, text: "XL" })])).toMatchObject({ error: "below_minimum" });
  });
  test("one schedule per child, plus one for everyone", () =>
    expect(home([
      item({ id: "a", widget: "schedule", options: { personId: P1 } }),
      item({ id: "b", widget: "schedule", x: 24, options: { personId: P2 } }),
      item({ id: "c", widget: "schedule", y: 16 }),
    ])).toMatchObject({ ok: true }));
  test("the same child twice is a duplicate", () =>
    expect(home([
      item({ id: "a", widget: "pocketMoney", options: { personId: P1 } }),
      item({ id: "b", widget: "pocketMoney", x: 24, options: { personId: P1 } }),
    ])).toEqual({ ok: false, error: "duplicate", itemId: "b" }));
  test("two tasks are a duplicate", () =>
    expect(home([item({ id: "a" }), item({ id: "b", x: 24 })])).toMatchObject({ error: "duplicate" }));
  test("a person on a widget that is not per child is refused", () =>
    expect(home([item({ id: "a", options: { personId: P1 } })])).toEqual({ ok: false, error: "bad_person", itemId: "a" }));
  for (const bad of ["", "p1", 7, null]) {
    test(`personId ${JSON.stringify(bad)} is refused`, () =>
      expect(home([item({ id: "a", widget: "schedule", options: { personId: bad } })])).toEqual({ ok: false, error: "bad_person", itemId: "a" }));
  }
  test("the screensaver passes options through unchanged, as before", () => {
    const one = { id: "a", widget: "clock", x: 0, y: 0, w: 16, h: 8, text: "M", options: { personId: "anything" } };
    expect(validateItems([one], 1080, 1920)).toEqual({ ok: true, items: [one] });
  });
  test("Home keeps the shared rules: overlap and bounds", () => {
    expect(home([item({ id: "a" }), item({ id: "b", widget: "notes", x: 23, y: 15 })])).toMatchObject({ error: "overlap", itemId: "b" });
    expect(home([item({ id: "a", x: 40 })])).toMatchObject({ error: "out_of_bounds", itemId: "a" });
  });
  test("knownWidgetItems reads the surface's catalogue", () => {
    const items = [{ widget: "tasks" }, { widget: "news" }, { widget: "clock" }];
    expect(knownWidgetItems(items, "home").map((i) => i.widget)).toEqual(["tasks", "clock"]);
    expect(knownWidgetItems(items).map((i) => i.widget)).toEqual(["news", "clock"]);
    expect(Object.hasOwn(SAVER_WIDGETS, "tasks")).toBe(false);
  });
});

/**
 * Today's default Home's cards per screen (each size taken as the area Home
 * gets). Minimums follow the pixels (home-size.ts): the clock block holds
 * today's date, greeting, members with their names and strip on every
 * screen, and every card has today's padding, so a portrait panel has fewer
 * rows left for cards than when each piece was 2 steps (720x1280, 800x1280 and
 * 600x1024: 5, was 8). Landscape panels keep their row of four. 800x600 has
 * no row left for a card under its clock block: on a screen that small the
 * old Home scrolled to reach its cards, and a designed Home never scrolls.
 */
const DEFAULT_CARDS: Record<string, number> = {
  "1080x1920": 8, "720x1280": 5, "800x1280": 5, "600x1024": 5, "1920x1080": 4, "1280x720": 4, "1280x800": 4, "2560x1440": 4, "2552x1274": 4, "1024x768": 4, "800x600": 0, "3840x2160": 7,
};
/** Every widget switched on: [one card for all children, one per child]. */
const EVERY_CARDS: Record<string, [number, number]> = {
  "1080x1920": [9, 9], "720x1280": [7, 7], "800x1280": [7, 7], "600x1024": [4, 6], "1920x1080": [4, 4], "1280x720": [4, 4], "1280x800": [4, 4], "2560x1440": [7, 7], "2552x1274": [7, 7], "1024x768": [4, 4], "800x600": [0, 0], "3840x2160": [7, 7],
};

test.describe("builtInHome", () => {
  const ALL = Object.fromEntries(Object.keys(DEFAULT_WIDGET_VISIBILITY).map((k) => [k, true]));
  const VARIANTS = {
    defaults: {},
    "every widget": { visible: ALL },
    "every widget, per child": { visible: ALL, scheduleChildren: [P1, P2], pocketMoneyChildren: [P2, P1] },
    "nothing but the clock block": { visible: Object.fromEntries(Object.keys(ALL).map((k) => [k, false])) },
  };
  for (const [w, h] of SIZES) {
    for (const [label, opts] of Object.entries(VARIANTS)) {
      test(`valid at ${w}x${h}, ${label}, and never past the last row`, () => {
        const items = builtInHome(w, h, opts);
        expect(home(items, w, h)).toMatchObject({ ok: true });
        const rows = gridFor(w, h)!.rows;
        expect(Math.max(...items.map((i) => i.y + i.h))).toBeLessThanOrEqual(rows);
        // The cards it places, not just a valid layout: an empty card row is valid too.
        const cards = items.filter((i) => !HOME_WIDGETS[i.widget].clockBlock).length;
        if (label === "nothing but the clock block" || DEFAULT_CARDS[`${w}x${h}`] === 0) expect(cards).toBe(0);
        else if (label === "defaults") expect(cards, "today's default cards").toBe(DEFAULT_CARDS[`${w}x${h}`]);
        else expect(cards, "every widget").toBe(EVERY_CARDS[`${w}x${h}`][label === "every widget" ? 0 : 1]);
        // A landscape screen of 24 rows keeps its row of four cards.
        if (label !== "nothing but the clock block" && w > h && gridFor(w, h)!.rows === 24) expect(cards).toBeGreaterThanOrEqual(4);
        // The clock block is always there, full width, in today's order; only
        // the greeting may be left out, on a screen too short for a row of
        // cards under the rest (1024x768).
        const head = items.filter((i) => HOME_WIDGETS[i.widget].clockBlock);
        const want = ["clock", "date", "greeting", "familyMembers", "todayStrip"].filter((k) => k !== "greeting" || head.some((i) => i.widget === k));
        expect(head.map((i) => [i.widget, i.x, i.w])).toEqual(want.map((k) => [k, 0, 48]));
        if (head.length === 4) expect(cards, "the greeting goes only to make room for cards").toBeGreaterThan(0);
      });
    }
  }

  test("1080x1920: today's default Home, two columns, the clock block on top and the grid filled to the last row", () => {
    const items = builtInHome(1080, 1920);
    expect(items.map((i) => [i.widget, i.x, i.y, i.w, i.h])).toEqual([
      // 21px steps: the date's week badge needs 48px (4 steps), the members
      // with names and status lines 108px (7), the strip's "+n" 48px (4).
      ["clock", 0, 0, 48, 12],
      ["date", 0, 12, 48, 4],
      ["greeting", 0, 16, 48, 3],
      ["familyMembers", 0, 19, 48, 7],
      ["todayStrip", 0, 26, 48, 4],
      // The rest in rows of cards, the week overview across both columns.
      ["weather", 0, 30, 24, 11],
      ["upcomingEvents", 24, 30, 24, 11],
      ["schedule", 0, 41, 24, 11],
      ["weekOverview", 0, 52, 48, 11],
      ["mealPlan", 24, 41, 24, 11],
      ["tasks", 0, 63, 24, 14],
      ["timers", 24, 63, 24, 14],
      ["messages", 0, 77, 24, 11],
    ]);
    expect(gridFor(1080, 1920)!.rows).toBe(88);
  });

  test("1920x1080: four columns, one row of cards; the week overview spans two; the rest is left out", () => {
    const items = builtInHome(1920, 1080);
    const cards = items.slice(5);
    expect(cards.map((i) => [i.widget, i.x, i.w])).toEqual([
      ["weather", 0, 12], ["upcomingEvents", 12, 12], ["schedule", 24, 12], ["mealPlan", 36, 12],
    ]);
    expect(new Set(cards.map((i) => i.h))).toEqual(new Set([8]));
    expect(cards[0].y + cards[0].h).toBe(24);
  });

  test("spare rows go to the clock", () => {
    const items = builtInHome(1080, 1920, { visible: Object.fromEntries(Object.keys(ALL).map((k) => [k, false])) });
    expect(items).toHaveLength(5);
    const rest = items.slice(1).reduce((n, i) => n + i.h, 0);
    expect(items[0]).toMatchObject({ widget: "clock", h: 88 - rest });
    // The other pieces as on today's Home (the members with names under their avatars).
    for (const i of items.slice(1)) expect(i.h, i.widget).toBe(homeComfort(i.widget, "M", 1080, 1920).h);
  });

  test("follows the saved order and the switches; unknown and repeated keys are ignored", () => {
    const items = builtInHome(1080, 1920, {
      visible: { shopping: true, weather: false },
      order: ["shopping", "toaster", "tasks", "shopping"],
    });
    expect(items.slice(5).map((i) => i.widget)).toEqual(
      ["shopping", "tasks", "upcomingEvents", "schedule", "weekOverview", "mealPlan", "timers", "messages"]);
  });

  test("one card per child, with the person in its options and its id", () => {
    const items = builtInHome(1080, 1920, { scheduleChildren: [P1, P2] });
    const schedules = items.filter((i) => i.widget === "schedule");
    expect(schedules.map((i) => [i.id, i.options])).toEqual([
      [`schedule:${P1}`, { personId: P1 }],
      [`schedule:${P2}`, { personId: P2 }],
    ]);
  });

  test("a landscape screen narrower than 1024px keeps two columns, as Home does below lg", () => {
    const cards = builtInHome(1000, 700).slice(5);
    expect(new Set(cards.map((i) => i.w))).toEqual(new Set([24]));
  });
});

test.describe("checkHomePeople", () => {
  /** A stand-in for the admin client: the family's people that are not binned. */
  const fakeDb = (people: string[], error?: string) => {
    const calls: unknown[][] = [];
    const q = {
      from: (...a: unknown[]) => (calls.push(["from", ...a]), q),
      select: (...a: unknown[]) => (calls.push(["select", ...a]), q),
      eq: (...a: unknown[]) => (calls.push(["eq", ...a]), q),
      is: (...a: unknown[]) => (calls.push(["is", ...a]), q),
      in: (col: string, ids: string[]) => {
        calls.push(["in", col, ids]);
        return Promise.resolve(error ? { data: null, error: { message: error } } : { data: people.filter((p) => ids.includes(p)).map((id) => ({ id })), error: null });
      },
    };
    return { db: q, calls };
  };

  test("no person named: no query", async () => {
    const { db, calls } = fakeDb([]);
    expect(await checkHomePeople(db, "fam", [item({ id: "a" })])).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });
  test("people of the family pass; the query is scoped to the family and leaves out the bin", async () => {
    const { db, calls } = fakeDb([P1, P2]);
    const items = [item({ id: "a", widget: "schedule", options: { personId: P1 } }), item({ id: "b", widget: "pocketMoney", options: { personId: P2 } })];
    expect(await checkHomePeople(db, "fam", items)).toEqual({ ok: true });
    expect(calls).toContainEqual(["eq", "family_id", "fam"]);
    expect(calls).toContainEqual(["is", "deleted_at", null]);
  });
  test("a person of another family (or binned) is the first failing item", async () => {
    const { db } = fakeDb([P1]);
    const items = [item({ id: "a", widget: "schedule", options: { personId: P1 } }), item({ id: "b", widget: "pocketMoney", options: { personId: P2 } })];
    expect(await checkHomePeople(db, "fam", items)).toEqual({ ok: false, error: "bad_person", itemId: "b" });
  });
  test("a database error is reported, not taken for a pass", async () => {
    const { db } = fakeDb([], "boom");
    expect(await checkHomePeople(db, "fam", [item({ id: "a", widget: "schedule", options: { personId: P1 } })]))
      .toEqual({ ok: false, error: "db", message: "boom" });
  });
});
