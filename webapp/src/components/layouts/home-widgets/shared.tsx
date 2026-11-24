"use client";

import type { HomeLayoutItem } from "@/lib/layouts/types";

/**
 * What every Home widget in a designed layout is given: its item, the box it
 * is drawn in (whole pixels, from LayoutGrid) and whether the designer is
 * showing it. As on the screensaver, sizes inside a widget are in em of the
 * box's font size. Unlike the screensaver, Home is touched: targets stay at
 * least 48px whatever the box (RFC-022 §3.3), and a list's "+n" links to the
 * widget's page.
 */
export interface HomeWidgetProps {
  item: HomeLayoutItem;
  box: { width: number; height: number };
  editing?: boolean;
}
