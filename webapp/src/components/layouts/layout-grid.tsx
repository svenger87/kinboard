"use client";

import type { ReactNode } from "react";
import { boxRect, textPx, type Grid } from "@/lib/layouts/grid";
import type { HomeLayoutItem, LayoutItem } from "@/lib/layouts/types";

/**
 * A layout drawn on its grid: one absolutely positioned box per item, at
 * whole pixels (the grid's offsets can be half pixels at odd widths), clipped,
 * with the item's text size as the box's font size. `render` gets the rounded
 * box size. Either surface's items: `render` gets them with their own type.
 */
export function LayoutGrid<I extends LayoutItem | HomeLayoutItem>({
  grid,
  items,
  render,
}: {
  grid: Grid;
  items: I[];
  render: (item: I, box: { width: number; height: number }) => ReactNode;
}) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {items.map((item) => {
        const r = boxRect(item, grid);
        const box = { width: Math.round(r.width), height: Math.round(r.height) };
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
              fontSize: textPx(item.text, grid.width, grid.height),
            }}
          >
            {render(item, box)}
          </div>
        );
      })}
    </div>
  );
}
