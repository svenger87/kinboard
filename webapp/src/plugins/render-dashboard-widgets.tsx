import React, { type ComponentType, type ReactNode } from "react";
import type { SurfacePlugin } from "./types";

/** Helper for the home page — render any registered dashboard widget.
 *  Failing-fast if a widget throws is React's job; we just collect the
 *  widget elements. */
export function renderDashboardWidgets(plugins: readonly SurfacePlugin[]): ReactNode[] {
  return plugins
    .filter((p): p is SurfacePlugin & { dashboardWidget: ComponentType<Record<string, never>> } =>
      Boolean(p.dashboardWidget),
    )
    .map((p) =>
      React.createElement(p.dashboardWidget, { key: p.id } as Record<string, never> & { key: string }),
    );
}
