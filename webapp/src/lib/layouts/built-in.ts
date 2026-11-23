/**
 * The built-in arrangements: builtInScreensaver below, builtInHome at the end.
 *
 * Today's screensaver arrangement expressed as boxes, for a family that has
 * not drawn its own layout: the starting point of the designer and the
 * fallback on screens that follow the built-in. Portrait: news top left,
 * weather and forecast top right (right-aligned), and a stack at the bottom
 * left: events, birthdays, then the clock with the date directly under it.
 * Landscape: news top left, weather and forecast top right, clock and date
 * bottom left, events bottom right; birthdays sit between the two columns
 * along the bottom. Rows are scarce on a landscape panel (6 at 1920x1080),
 * so heights shrink toward each widget's minimum there. The arrangement is
 * worked out in whole cells and returned in steps (four to a cell).
 */
import { GRID, gridFor, orientationOf } from "./grid";
import { HOME_WIDGETS } from "./widgets";
import { DEFAULT_WIDGET_ORDER, DEFAULT_WIDGET_VISIBILITY, type WidgetVisibility } from "../../types/widgets";
import type { HomeLayoutItem, HomeWidgetKey, LayoutItem, SaverWidgetKey } from "./types";

export function builtInScreensaver(width: number, height: number): LayoutItem[] {
  const rows = gridFor(width, height)?.cellRows ?? GRID.MIN_ROWS;
  const S = GRID.STEPS_PER_CELL;
  const box = (widget: SaverWidgetKey, x: number, y: number, w: number, h: number): LayoutItem => ({
    id: widget, widget, x: x * S, y: y * S, w: w * S, h: h * S, text: "M",
  });

  if (orientationOf(width, height) === "portrait") {
    // The left column is stacked from the bottom: date, clock, birthdays,
    // events, news. With rows to spare it is today's arrangement; when they
    // are scarce events and birthdays shrink toward their minimums first,
    // then birthdays go, then news, so nothing is ever below its minimum.
    const clockH = rows < 7 ? 2 : 3;
    const avail = rows - 1 - clockH; // rows above the clock for news, events, birthdays
    let news = 0;
    let events = 0;
    let birthdays = 0;
    if (avail >= 10) {
      // 7 = events 4 + birthdays 3 at full size; news takes the rest, up to 6.
      events = 4;
      birthdays = 3;
      news = Math.min(6, avail - 7);
    } else if (avail >= 8) {
      // Everything at least at its minimum; spare rows go to events first.
      birthdays = 2;
      events = Math.min(4, avail - 5);
      news = avail - events - birthdays;
    } else if (avail >= 6) {
      events = Math.min(4, avail - 3); // birthdays dropped
      news = avail - events;
    } else {
      events = Math.min(4, avail); // news dropped too
    }
    const items: LayoutItem[] = [];
    if (news) items.push(box("news", 0, 0, 5, news));
    items.push(box("weatherNow", 7, 0, 5, 1), box("forecast", 7, 1, 5, 3));
    let y = rows - 1 - clockH;
    items.push(box("clock", 0, y, 6, clockH), box("date", 0, rows - 1, 6, 1));
    if (birthdays) {
      y -= birthdays;
      items.push(box("birthdays", 0, y, 6, birthdays));
    }
    y -= events;
    items.push(box("events", 0, y, 6, events));
    return items;
  }
  return [
    box("news", 0, 0, 4, rows - 3),
    box("weatherNow", 8, 0, 4, 1),
    box("forecast", 8, 1, 4, 2),
    box("clock", 0, rows - 3, 4, 2),
    box("date", 0, rows - 1, 4, 1),
    box("events", 8, 3, 4, rows - 3),
    box("birthdays", 4, rows - 2, 4, 2),
  ];
}

/** A card of Settings -> Widgets, as opposed to a piece of the clock block. */
type HomeCardKey = keyof WidgetVisibility;

/**
 * What today's Home of a family is made of, beyond the screen's shape. All of
 * it optional: without it the built-in is the default Home of a new family.
 */
export interface BuiltInHomeOptions {
  /** Settings -> Widgets' switches; missing keys take their defaults, as on Home. */
  visible?: Partial<WidgetVisibility>;
  /** The saved card order; unknown and repeated keys are ignored, missing ones follow in default order. */
  order?: readonly string[];
  /**
   * One schedule card per child, in this order (person ids). Empty or
   * absent: one schedule card for everyone. The caller applies today's rule
   * (the per-child setting and the timetabled children).
   */
  scheduleChildren?: readonly string[];
  /** One pocket-money card per child, likewise (today: per-child mode and more than one child). */
  pocketMoneyChildren?: readonly string[];
}

/**
 * The clock block's pieces top to bottom, as today's Home stacks them (the
 * Clock component draws the time, then the date and week, then the greeting;
 * the members and the today strip follow), with their heights in steps. A
 * landscape panel has few rows (24 steps at 1920x1080), so its block starts
 * smaller; spare rows go to the clock, as today's block takes the spare
 * height with `flex-1`.
 */
const HOME_HEAD: Record<"portrait" | "landscape", [HomeWidgetKey, number][]> = {
  portrait: [["clock", 8], ["date", 2], ["greeting", 2], ["familyMembers", 4], ["todayStrip", 2]],
  landscape: [["clock", 4], ["date", 2], ["greeting", 2], ["familyMembers", 3], ["todayStrip", 2]],
};

/** Cards that span more than one column on today's Home (`sm:col-span-2`). */
const TODAY_SPAN: Partial<Record<HomeCardKey, number>> = { weekOverview: 2 };

/** The tallest a row of cards starts, in steps (four cells). */
const CARD_ROW_MAX = 16;

/** Today's order: the saved keys first (known, once each), then the rest in default order. */
function mergeOrder(defaults: readonly HomeCardKey[], saved: readonly string[]): HomeCardKey[] {
  const valid = new Set<string>(defaults);
  const ordered = saved.filter((k, n): k is HomeCardKey => valid.has(k) && saved.indexOf(k) === n);
  return [...ordered, ...defaults.filter((k) => !ordered.includes(k))];
}

/**
 * Today's Home expressed as boxes, for a layout whose Home nobody has drawn:
 * the starting point of the designer's Home tab and what a designed Home
 * falls back to. `width` and `height` are the area the grid gets (the screen
 * less the navigation bar, RFC-022 §3.5).
 *
 * The clock block runs across the top, full width. Below it the visible
 * cards follow in the family's order, in two columns (portrait, or narrower
 * than 1024px) or four (a landscape panel), the week overview across two
 * columns as today (and it needs 24 steps), per-child cards once per child. Where today's
 * grid leaves a hole before a card too wide for it, the next card that fits
 * takes it (CSS grid's `dense`): a designed Home has no rows to waste. A
 * designed Home never scrolls (RFC-022 §7.1), so card rows start at four
 * cells and shrink toward their cards' minimums; rows that still do not
 * fit are left out, as they sat below the fold today.
 * Spare rows go to the clock. Every box is at least its minimum and inside
 * the grid, so validateItems(…, "home") accepts the result.
 */
export function builtInHome(width: number, height: number, options: BuiltInHomeOptions = {}): HomeLayoutItem[] {
  const rows = gridFor(width, height)?.rows ?? GRID.MIN_ROWS * GRID.STEPS_PER_CELL;
  const orientation = orientationOf(width, height);
  const cols = orientation === "landscape" && width >= 1024 ? 4 : 2;
  const colW = GRID.COLUMNS / cols;

  // The cards, in order, with the columns each spans.
  const visible: WidgetVisibility = { ...DEFAULT_WIDGET_VISIBILITY, ...options.visible };
  const cards = mergeOrder(DEFAULT_WIDGET_ORDER, options.order ?? [])
    .filter((k) => visible[k])
    .flatMap((widget) => {
      const kids = widget === "schedule" ? options.scheduleChildren : widget === "pocketMoney" ? options.pocketMoneyChildren : undefined;
      const people = kids && kids.length > 0 ? [...new Set(kids)] : [undefined];
      const span = Math.min(cols, Math.max(TODAY_SPAN[widget] ?? 1, Math.ceil(HOME_WIDGETS[widget].min.w / colW)));
      return people.map((personId) => ({ widget, personId, span }));
    });
  type Card = (typeof cards)[number];

  // Dense placement into rows of `cols` columns.
  const pack = (list: Card[]) => {
    const taken: boolean[][] = [];
    const placed: { card: Card; row: number; col: number }[] = [];
    for (const card of list) {
      for (let row = 0, done = false; !done; row++) {
        taken[row] ??= Array<boolean>(cols).fill(false);
        for (let col = 0; col + card.span <= cols && !done; col++) {
          if (taken[row].slice(col, col + card.span).some(Boolean)) continue;
          for (let c = col; c < col + card.span; c++) taken[row][c] = true;
          placed.push({ card, row, col });
          done = true;
        }
      }
    }
    const rowMin = Array<number>(taken.length).fill(0);
    for (const p of placed) rowMin[p.row] = Math.max(rowMin[p.row], HOME_WIDGETS[p.card.widget].min.h);
    // A row left empty (the last scanned one, when nothing went in) is dropped.
    while (rowMin.length > 0 && rowMin[rowMin.length - 1] === 0) rowMin.pop();
    return { placed, rowMin };
  };

  const head = HOME_HEAD[orientation];
  const headH = head.reduce((sum, [, h]) => sum + h, 0);
  const region = Math.max(0, rows - headH);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  // Whole rows that do not fit are left out, as they sat below the fold today.
  const packed = pack(cards);
  let fit = packed.rowMin.length;
  while (fit > 0 && sum(packed.rowMin.slice(0, fit)) > region) fit--;
  packed.rowMin = packed.rowMin.slice(0, fit);
  packed.placed = packed.placed.filter((p) => p.row < fit);
  // The tallest common row height that fits; a row never goes below its tallest card's minimum.
  let heights = packed.rowMin;
  for (let t = CARD_ROW_MAX; t >= 0; t--) {
    heights = packed.rowMin.map((m) => Math.max(m, t));
    if (sum(heights) <= region) break;
  }
  const spare = region - sum(heights);

  const items: HomeLayoutItem[] = [];
  let y = 0;
  for (const [widget, h] of head) {
    const hh = widget === "clock" ? h + spare : h;
    items.push({ id: widget, widget, x: 0, y, w: GRID.COLUMNS, h: hh, text: "M" });
    y += hh;
  }
  const rowY = heights.map((_, r) => y + sum(heights.slice(0, r)));
  for (const { card, row, col } of packed.placed) {
    const item: HomeLayoutItem = {
      id: card.personId ? `${card.widget}:${card.personId}` : card.widget,
      widget: card.widget,
      x: col * colW,
      y: rowY[row],
      w: card.span * colW,
      h: heights[row],
      text: "M",
    };
    if (card.personId) item.options = { personId: card.personId };
    items.push(item);
  }
  return items;
}
