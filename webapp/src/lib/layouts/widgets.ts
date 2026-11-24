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

export interface HomeWidgetSpec {
  kind: HomeWidgetKind;
  /** Smallest box, in steps. */
  min: { w: number; h: number };
  /** The box it is dropped with, in steps. */
  box: { w: number; h: number };
  /**
   * One widget per child (`options.personId`, a person of the family). The
   * same widget without a person is today's single card for all children.
   */
  perChild?: true;
  /** Part of the block at the top of today's Home (RFC-022 §3.2). */
  clockBlock?: true;
}

/** A Home widget's spec, given directly in steps: Home's minimums are not all whole cells. */
const home = (kind: HomeWidgetKind, w: number, h: number, box: { w: number; h: number }, extra: Pick<HomeWidgetSpec, "perChild" | "clockBlock"> = {}): HomeWidgetSpec => ({
  kind, min: { w, h }, box, ...extra,
});

/**
 * Home's widgets, in steps (48 across, four to a cell). Every card stays
 * usable at its minimum: a fixed widget fits its smallest arrangement, and a
 * list its title, one entry and its "+n" (two entries for tasks and
 * shopping, which are ticked off there) at text XL on every landscape screen
 * of the matrix -- measured by e2e/home-list-widgets-ui.spec.ts, capped so
 * today's Home still fits its one row of cards on 1920x1080 (11 steps, and the
 * today strip's 2 in the block above it). A capped list shows less at XL. On a portrait
 * screen a list at its minimum and at XL shows its title and count only: the
 * box is too narrow for an entry at that size, and the title is its link. A card's minimum width is at most 12
 * steps (a quarter of the screen, a column of today's four), except the
 * week overview, which needs its seven columns (24 steps, RFC-022 §3.1).
 */
export const HOME_WIDGETS: Record<HomeWidgetKey, HomeWidgetSpec> = {
  // The clock block, taken apart. Dropped full width, as they sit today.
  clock: home("value", 16, 4, { w: 48, h: 8 }, { clockBlock: true }),
  date: home("value", 12, 2, { w: 48, h: 2 }, { clockBlock: true }),
  greeting: home("value", 12, 2, { w: 48, h: 2 }, { clockBlock: true }),
  familyMembers: home("fixed", 16, 3, { w: 48, h: 4 }, { clockBlock: true }),
  todayStrip: home("list", 16, 2, { w: 48, h: 2 }, { clockBlock: true }),
  // The cards of Settings -> Widgets.
  weather: home("value+fixed", 8, 4, { w: 12, h: 8 }),
  upcomingEvents: home("list", 12, 9, { w: 12, h: 12 }),
  schedule: home("fixed", 12, 8, { w: 12, h: 12 }, { perChild: true }),
  birthday: home("list", 12, 10, { w: 12, h: 10 }),
  holidays: home("list", 12, 10, { w: 12, h: 10 }),
  weekOverview: home("fixed", 24, 8, { w: 24, h: 12 }),
  mealPlan: home("list", 12, 10, { w: 12, h: 12 }),
  wasteCollection: home("list", 12, 11, { w: 12, h: 11 }),
  notes: home("list", 12, 11, { w: 12, h: 12 }),
  tasks: home("list", 12, 11, { w: 12, h: 12 }),
  shopping: home("list", 12, 10, { w: 12, h: 12 }),
  vehicles: home("fixed", 8, 4, { w: 12, h: 8 }),
  stonks: home("fixed", 8, 4, { w: 12, h: 8 }),
  pocketMoney: home("value", 8, 4, { w: 12, h: 8 }, { perChild: true }),
  creatures: home("fixed", 12, 8, { w: 12, h: 12 }),
  photos: home("fixed", 8, 8, { w: 12, h: 12 }),
  timers: home("fixed", 12, 6, { w: 12, h: 8 }),
  media: home("fixed", 12, 6, { w: 12, h: 8 }),
  messages: home("list", 12, 8, { w: 12, h: 12 }),
  countdown: home("list", 12, 8, { w: 12, h: 8 }),
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
