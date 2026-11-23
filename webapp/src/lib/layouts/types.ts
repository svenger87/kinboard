/**
 * The shapes of a saved layout: which widgets a family placed on which cells
 * of the grid, for the home screen and the screensaver. Kept apart from the
 * maths so the database, the API and the designer can share them.
 */

export type TextSize = "S" | "M" | "L" | "XL";

/** The two faces of a wall screen a layout arranges. */
export type Surface = "home" | "screensaver";

export type SaverWidgetKey =
  | "clock"
  | "date"
  | "nextEvent"
  | "weatherNow"
  | "forecast"
  | "events"
  | "birthdays"
  | "holidays"
  | "news"
  | "lessons"
  | "energy"
  | "vehicles"
  | "photoCount";

/**
 * The widgets Home can place: every card of Settings -> Widgets (the keys of
 * `WidgetVisibility`, kept in step by the Record in widgets.ts) plus the
 * clock block taken apart (RFC-022 §3.2). `date` here is Home's date with its
 * week number, not the screensaver's date line.
 */
export type HomeWidgetKey =
  | "clock"
  | "date"
  | "greeting"
  | "familyMembers"
  | "todayStrip"
  | "weather"
  | "upcomingEvents"
  | "schedule"
  | "birthday"
  | "holidays"
  | "weekOverview"
  | "mealPlan"
  | "wasteCollection"
  | "notes"
  | "tasks"
  | "shopping"
  | "vehicles"
  | "stonks"
  | "pocketMoney"
  | "creatures"
  | "photos"
  | "timers"
  | "media"
  | "messages"
  | "countdown";

/** The widget keys of a surface. */
export type WidgetKeyOf<S extends Surface> = S extends "home" ? HomeWidgetKey : SaverWidgetKey;

/**
 * One placed box. Generic over the widget key so Home and the screensaver
 * share the shape; without an argument it is a screensaver item, as it was
 * before Home had widgets.
 */
export interface LayoutItem<K extends string = SaverWidgetKey> {
  id: string;
  widget: K;
  /** Grid column and row of the top-left step, counted from 0. */
  x: number;
  y: number;
  /** Width and height in steps (four to a cell). */
  w: number;
  h: number;
  text: TextSize;
  /** Home's per-child widgets (schedule, pocket money) carry `personId` here. */
  options?: Record<string, unknown>;
}

export type SaverLayoutItem = LayoutItem<SaverWidgetKey>;
export type HomeLayoutItem = LayoutItem<HomeWidgetKey>;

export interface Layout {
  id: string;
  family_id: string;
  name: string;
  /** The screen size the layout was drawn for, in CSS pixels. */
  width: number;
  height: number;
  /**
   * The columns the positions count: LAYOUT_GRID (48 steps) for every layout
   * this build reads or writes. Another value (12: cells, from before
   * migrations/087_layout_steps.sql) marks a layout this build does not use.
   */
  grid: number;
  home: HomeLayoutItem[];
  screensaver: LayoutItem[];
  created_at: string;
  updated_at: string;
}

/** Which layout a screen uses by default, per orientation. */
export interface LayoutDefaults {
  portrait: string | null;
  landscape: string | null;
}
