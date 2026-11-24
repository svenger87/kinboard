/**
 * The widgets a family can place, per surface: the screensaver's below,
 * Home's (HOME_WIDGETS, RFC-022) after them. The screensaver widgets, with the smallest box each
 * stays readable in and the box it starts with when dropped on the grid.
 * "list" widgets show more rows the taller they get, "value" widgets show
 * one thing, "fixed" widgets are drawn at one arrangement. Sizes are in
 * steps (four to a cell); the table lists them in cells.
 */
import { GRID } from "./grid";
import type { HomeWidgetKey, SaverWidgetKey, Surface, WidgetKeyOf } from "./types";

export interface WidgetSpec {
  kind: "list" | "value" | "fixed";
  min: { w: number; h: number };
  box: { w: number; h: number };
}

const S = GRID.STEPS_PER_CELL;

/** A widget's minimum and default box, given in cells and stored in steps. */
const spec = (
  kind: WidgetSpec["kind"],
  w: number,
  h: number,
  box: { w: number; h: number } = { w, h },
): WidgetSpec => ({ kind, min: { w: w * S, h: h * S }, box: { w: box.w * S, h: box.h * S } });

export const SAVER_WIDGETS: Record<SaverWidgetKey, WidgetSpec> = {
  clock: spec("value", 4, 2, { w: 6, h: 3 }),
  date: spec("value", 3, 1),
  nextEvent: spec("value", 4, 1),
  weatherNow: spec("value", 2, 1),
  forecast: spec("fixed", 4, 2),
  events: spec("list", 4, 3, { w: 6, h: 5 }),
  birthdays: spec("list", 4, 2),
  holidays: spec("list", 4, 2),
  news: spec("list", 4, 3, { w: 5, h: 6 }),
  lessons: spec("list", 4, 2),
  // As small as one line of figures (half a cell high); dropped on the grid at the old size.
  energy: spec("fixed", 2, 1, { w: 3, h: 2 }),
  vehicles: spec("fixed", 2, 1, { w: 3, h: 2 }),
  photoCount: spec("value", 1, 1),
};

/**
 * How a Home widget fills a box it did not choose (RFC-022 §3.1): "list"
 * shows more or fewer entries and ends in "+n", "value" grows with its box,
 * "fixed" draws its own arrangement fitted to the box, and "value+fixed" is
 * a value that adds a fixed part when the box is wide enough (the weather
 * now, then its forecast row).
 */
export type HomeWidgetKind = WidgetSpec["kind"] | "value+fixed";

/**
 * What a Home widget needs to be complete, in px, given its text size in px
 * (`em`, the box's font size, homeTextPx). Touch targets are 48px whatever
 * the text size (RFC-022 §3.3), so a need is ems of text with 48px floors,
 * not a number of grid steps: a step is 1/48 of the layout's width, and the
 * same steps are 38px on a 1920x1080 panel and 21px on the same panel
 * turned to portrait, while the text follows the short side and stays put.
 * home-size.ts turns a need into steps for a layout's own grid.
 */
export type HomeNeed = (em: number) => { w: number; h: number };

export interface HomeWidgetSpec {
  kind: HomeWidgetKind;
  /** The smallest box, in px at a text size (see HomeNeed). */
  need: HomeNeed;
  /**
   * The size it is drawn at on today's Home, when that is more than its
   * smallest: the built-in Home starts it there (the members with names and
   * status lines under their avatars; at the minimum they sit beside them).
   */
  comfort?: HomeNeed;
  /**
   * A floor in steps, whatever the pixels: the week overview spans two
   * columns of today's Home (24 steps, RFC-022 §3.1).
   */
  floor?: { w: number; h: number };
  /** The box it is dropped with, in steps, when that is more than its minimum. */
  box: { w: number; h: number };
  /**
   * One widget per child (`options.personId`, a person of the family). The
   * same widget without a person is today's single card for all children.
   */
  perChild?: true;
  /** Part of the block at the top of today's Home (RFC-022 §3.2). */
  clockBlock?: true;
}

/** A touch target's side on Home, whatever the text size (RFC-022 §3.3). */
export const HOME_TARGET = 48;
const T = HOME_TARGET;
const target = (ems: number, em: number) => Math.max(T, ems * em);

/**
 * The card every Home widget is drawn in (home-widgets/frame.tsx), as
 * today's Home card: 0.89em of padding all round, a title row as tall as
 * its icon badge (2.23em, 40px at M), whose 48px target reaches 4px into
 * the padding above and below, and 0.56em under it.
 */
const PAD = 0.89;
const headerRow = (em: number) => Math.max(T - 8, 2.23 * em) + 0.56 * em;

/**
 * A list card: its title row, `entries` entries, the 48px "+n", the card's
 * padding and border, and the 6px between rows (HOME_ROW_GAP). An entry is
 * `entry` em tall at large text and a 48px row (and its 1px borders) plus
 * `lead` em at small text, where its target sets its height and a heading
 * or second line comes on top: the tallest entry the widget draws at the
 * minimum width. Measured by e2e/home-list-widgets-ui.spec.ts on nine
 * screens at S, M and XL (the first height that holds, less a step).
 */
const list = (entry: number, entries = 1, lead = 0): HomeNeed => (em) => ({
  w: LIST_W * em,
  h: 2 * PAD * em + 2 + headerRow(em) + entries * (Math.max(T + 2 + lead * em, entry * em) + 6) + target(1.3, em),
});
/** A list card's smallest width in em: a title with its count, an entry's text on two lines. */
const LIST_W = 14;
/**
 * A fixed card: its arrangement at the text size, `w` by `h` em with its
 * padding, and at least its title row with a line under it (its set-up
 * prompt, a title and a hint); `minW` px across at least (a row of 48px
 * buttons).
 */
const card = (w: number, h: number, minW = 0): HomeNeed => (em) => ({
  w: Math.max(minW, w * em),
  h: Math.max(h * em, 2 * PAD * em + 2 + headerRow(em) + target(1.2, em)),
});

const home = (
  kind: HomeWidgetKind,
  need: HomeNeed,
  box: { w: number; h: number },
  extra: Pick<HomeWidgetSpec, "perChild" | "clockBlock" | "floor" | "comfort"> = {},
): HomeWidgetSpec => ({ kind, need, box, ...extra });

/**
 * Home's widgets. Minimums are what the content needs at the box's text
 * size (HomeNeed), so the same widget gets about twice the steps on a
 * portrait panel as on the same panel in landscape, and more at XL than at
 * M. Every card stays usable at its minimum: a value at its text size, a
 * fixed widget in its smallest arrangement without shrinking, a list its
 * title, one entry and its "+n" (two entries for tasks and shopping, which
 * are ticked off there). The clock block's pieces need what they had on
 * the old Home: the date on one line with its week badge (a 48px target),
 * the greeting's line, each member with avatar, name and status line, the
 * today strip's row of pills. Measured on every screen of the matrix by
 * e2e/home-list-widgets-ui.spec.ts and pinned by e2e/home-size.spec.ts.
 * `box` is the size a widget is dropped with, in steps, where that is more
 * than its minimum.
 */
export const HOME_WIDGETS: Record<HomeWidgetKey, HomeWidgetSpec> = {
  // The clock block, taken apart. Dropped full width, as they sit today.
  // The clock fills its box; at its smallest the digits are 2.6em tall and the time a 48px button.
  clock: home("value", (em) => ({ w: 6 * em, h: target(2.6, em) }), { w: 48, h: 8 }, { clockBlock: true }),
  // One line: weekday, day and month at 0.9em, the week badge's 48px button beside it.
  date: home("value", (em) => ({ w: 15 * em, h: target(1.4, em) }), { w: 48, h: 2 }, { clockBlock: true }),
  // One line at 0.9em.
  greeting: home("value", (em) => ({ w: 9 * em, h: 1.4 * em }), { w: 48, h: 2 }, { clockBlock: true }),
  // Each member's avatar (3.5em, 48px at least) with name and status line: beside it at
  // the minimum, under it as on today's Home (comfort).
  familyMembers: home("fixed", (em) => ({ w: 24 * em, h: target(3.5, em) }), { w: 48, h: 4 }, {
    clockBlock: true,
    comfort: (em) => ({ w: 16 * em, h: target(3.5, em) + 2.6 * em }),
  }),
  // One row of pills, or the 48px "+n".
  todayStrip: home("list", (em) => ({ w: 14 * em, h: target(2.1, em) }), { w: 48, h: 2 }, { clockBlock: true }),
  // The cards of Settings -> Widgets.
  weather: home("value+fixed", card(9, 4.1), { w: 12, h: 8 }),
  upcomingEvents: home("list", list(2.9, 1, 0.9), { w: 12, h: 12 }),
  schedule: home("fixed", card(13.8, 9), { w: 12, h: 12 }, { perChild: true }),
  birthday: home("list", list(3.3), { w: 12, h: 10 }),
  holidays: home("list", list(3.3), { w: 12, h: 10 }),
  weekOverview: home("fixed", card(18, 9), { w: 24, h: 12 }, { floor: { w: 24, h: 1 } }),
  mealPlan: home("list", list(2.8), { w: 12, h: 12 }),
  wasteCollection: home("list", list(5.1), { w: 12, h: 11 }),
  notes: home("list", list(4.1, 1, 0.8), { w: 12, h: 12 }),
  tasks: home("list", list(3, 2, 0.6), { w: 12, h: 12 }),
  shopping: home("list", list(2.4, 2, 0.3), { w: 12, h: 12 }),
  vehicles: home("fixed", card(9, 4.1), { w: 12, h: 8 }),
  stonks: home("fixed", card(9, 4.1), { w: 12, h: 8 }),
  pocketMoney: home("value", card(9, 5.2), { w: 12, h: 8 }, { perChild: true }),
  creatures: home("fixed", card(13.8, 9), { w: 12, h: 12 }),
  photos: home("fixed", card(9, 9), { w: 12, h: 12 }),
  timers: home("fixed", card(20, 6.5, 320), { w: 12, h: 8 }),
  media: home("fixed", card(13.8, 6.5), { w: 12, h: 8 }),
  messages: home("list", list(2.5), { w: 12, h: 12 }),
  countdown: home("list", list(1.9), { w: 12, h: 8 }),
};

/** The catalogue of a surface. */
export function widgetsFor<S extends Surface>(surface: S): Record<WidgetKeyOf<S>, HomeWidgetSpec | WidgetSpec> {
  return (surface === "home" ? HOME_WIDGETS : SAVER_WIDGETS) as Record<WidgetKeyOf<S>, HomeWidgetSpec | WidgetSpec>;
}

/**
 * The items whose widget this build knows. A layout saved by a newer version
 * (a widget added later, then a rollback) must not crash a kiosk or the
 * editor: the unknown ones are left out, the rest draw as saved.
 */
export function knownWidgetItems<T extends { widget: string }>(
  items: readonly T[] | null | undefined,
  surface: Surface = "screensaver",
): T[] {
  if (!Array.isArray(items)) return [];
  const known = widgetsFor(surface);
  return items.filter((i) => !!i && typeof i.widget === "string" && Object.hasOwn(known, i.widget));
}
