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
  /** Grid column and row of the top-left cell, counted from 0. */
  x: number;
  y: number;
  /** Width and height in cells. */
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
