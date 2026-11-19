"use client";

import type { CSSProperties } from "react";
import type { Grid } from "@/lib/layouts/grid";
import type { LayoutItem } from "@/lib/layouts/types";
import { LayoutGrid } from "./layout-grid";
import { SAVER_WIDGET_COMPONENTS } from "./saver-widgets";
import { SaverActionsProvider, type SaverActions } from "./saver-actions";

/**
 * The screensaver as the family designed it: the layout's widgets, each in its
 * box, over the photo and the effects. Rendered inside the screensaver's data
 * provider, which the widgets read from. `style` carries the screensaver's
 * burn-in drift; `actions` what tapping a widget does (opening a news item).
 */
const NO_ACTIONS: SaverActions = {};

export function DesignedScreensaver({
  items,
  grid,
  style,
  actions,
}: {
  items: LayoutItem[];
  grid: Grid;
  style?: CSSProperties;
  actions?: SaverActions;
}) {
  return (
    <SaverActionsProvider value={actions ?? NO_ACTIONS}>
      <div
        className="absolute inset-0"
        style={style}
        data-testid="designed-screensaver"
      >
        <LayoutGrid
          grid={grid}
          items={items}
          render={(item, box) => {
            const Widget = SAVER_WIDGET_COMPONENTS[item.widget];
            return <Widget item={item} box={box} editing={false} />;
          }}
        />
      </div>
    </SaverActionsProvider>
  );
}
