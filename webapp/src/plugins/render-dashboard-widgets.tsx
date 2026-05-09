import type { ComponentType, ReactNode } from "react";
import type { SurfacePlugin } from "./types";

/** Helper for the home page — render any registered dashboard widget.
 *  Failing-fast if a widget throws is React's job; we just collect the
 *  widget elements. */
export function renderDashboardWidgets(plugins: readonly SurfacePlugin[]): ReactNode[] {
  return plugins
    .filter((p): p is SurfacePlugin & { dashboardWidget: ComponentType<object> } =>
      Boolean(p.dashboardWidget),
    )
    .map((p) => {
      const Widget = p.dashboardWidget;
      return <Widget key={p.id} />;
    });
}
