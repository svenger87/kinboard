/**
 * The shapes of a saved layout: which widgets a family placed on which cells
 * of the grid, for the home screen and the screensaver. Kept apart from the
 * maths so the database, the API and the designer can share them.
 */

export type TextSize = "S" | "M" | "L" | "XL";

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

export interface LayoutItem {
  id: string;
  widget: SaverWidgetKey;
  /** Grid column and row of the top-left step, counted from 0. */
  x: number;
  y: number;
  /** Width and height in steps (four to a cell). */
  w: number;
  h: number;
  text: TextSize;
  options?: Record<string, unknown>;
}

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
  home: LayoutItem[];
  screensaver: LayoutItem[];
  created_at: string;
  updated_at: string;
}

/** Which layout a screen uses by default, per orientation. */
export interface LayoutDefaults {
  portrait: string | null;
  landscape: string | null;
}
