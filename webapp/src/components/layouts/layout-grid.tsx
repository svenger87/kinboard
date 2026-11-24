"use client";

import type { ReactNode } from "react";
import { boxRect, textPx, type Grid } from "@/lib/layouts/grid";
import { homeTextPx } from "@/lib/layouts/home-size";
import type { HomeLayoutItem, LayoutItem, Surface } from "@/lib/layouts/types";

/**
 * A layout drawn on its grid: one absolutely positioned box per item, at
 * whole pixels (the grid's offsets can be half pixels at odd widths), clipped,
 * with the item's text size as the box's font size: the screensaver's scale,
 * or Home's (homeTextPx, today's Home's type at M). `render` gets the rounded
 * box size. Either surface's items: `render` gets them with their own type.
 */
export function LayoutGrid<I extends LayoutItem | HomeLayoutItem>({
  grid,
  items,
  render,
  surface = "screensaver",
}: {
  grid: Grid;
  items: I[];
  render: (item: I, box: { width: number; height: number }) => ReactNode;
  surface?: Surface;
}) {
  const fontPx = surface === "home" ? homeTextPx : textPx;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {items.map((item) => {
        const r = boxRect(item, grid);
        const box = { width: Math.round(r.width), height: Math.round(r.height) };
        const font = fontPx(item.text, grid.width, grid.height);
        // Home's title rows are text M for the screen in every box (home-widgets/frame.tsx).
        const head = surface === "home" ? homeTextPx("M", grid.width, grid.height) : font;
        return (
          <div
            key={item.id}
            data-layout-item={item.widget}
            data-layout-id={item.id}
            style={{
              position: "absolute",
              left: Math.round(r.left),
              top: Math.round(r.top),
              width: box.width,
              height: box.height,
              overflow: "hidden",
              fontSize: font,
              // Home's text roles (globals.css) read the box's size from here, in px, so nesting never compounds.
              ["--kb-em" as string]: `${font}px`,
              ["--kb-head-em" as string]: `${head}px`,
            }}
          >
            {render(item, box)}
          </div>
        );
      })}
    </div>
  );
}
