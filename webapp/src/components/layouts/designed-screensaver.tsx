"use client";

import type { CSSProperties } from "react";
import type { Grid } from "@/lib/layouts/grid";
import type { LayoutItem } from "@/lib/layouts/types";
import { LayoutGrid } from "./layout-grid";
import { SAVER_WIDGET_COMPONENTS } from "./saver-widgets";

/**
 * The screensaver as the family designed it: the layout's widgets, each in its
 * box, over the photo and the effects. Rendered inside the screensaver's data
 * provider, which the widgets read from. `style` carries the screensaver's
 * burn-in drift.
 */
export function DesignedScreensaver({ items, grid, style }: { items: LayoutItem[]; grid: Grid; style?: CSSProperties }) {
  return (
    <div className="absolute inset-0" style={style} data-testid="designed-screensaver">
      <LayoutGrid
        grid={grid}
        items={items}
        render={(item, box) => {
          const Widget = SAVER_WIDGET_COMPONENTS[item.widget];
          return <Widget item={item} box={box} editing={false} />;
        }}
      />
    </div>
  );
}
