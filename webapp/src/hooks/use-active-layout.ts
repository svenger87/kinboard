import { useEffect, useMemo, useState } from "react";
import { gridFor, type Grid } from "@/lib/layouts/grid";
import { resolveLayout } from "@/lib/layouts/resolve";
import { rescaleItems } from "@/lib/layouts/rescale";
import type { Layout, LayoutItem } from "@/lib/layouts/types";
import { knownWidgetItems } from "@/lib/layouts/widgets";
import { useLayoutDefaults, useLayouts, useOwnDeviceLayout } from "./use-layouts";

interface Viewport {
  width: number;
  height: number;
}

const readViewport = (): Viewport | null =>
  typeof window === "undefined" ? null : { width: window.innerWidth, height: window.innerHeight };

/**
 * The page's size, read at once on the client: starting at null made the
 * first render of every screensaver activation "not ready", which is what
 * let the built-in screensaver draw before a designed one.
 */
function useViewport(): Viewport | null {
  const [viewport, setViewport] = useState<Viewport | null>(readViewport);
  useEffect(() => {
    const read = () =>
      setViewport((prev) => (prev && prev.width === window.innerWidth && prev.height === window.innerHeight ? prev : readViewport()));
    read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return viewport;
}

export interface ActiveLayout {
  layout: Layout | null;
  grid: Grid | null;
  items: LayoutItem[];
  dropped: string[];
  /** Everything it depends on has answered (or failed): until then a screen draws neither the built-in nor a layout. */
  ready: boolean;
}

const none = (ready: boolean): ActiveLayout => ({ layout: null, grid: null, items: [], dropped: [], ready });

/**
 * The layout this screen draws and its items, fitted to the screen's grid.
 * Null while anything it depends on is still loading, so a screen never shows
 * one layout and then flips to another.
 */
export function useActiveLayout(surface: "screensaver"): ActiveLayout {
  const viewport = useViewport();
  const layouts = useLayouts();
  const defaults = useLayoutDefaults();
  const own = useOwnDeviceLayout();
  // No device on this screen (not paired): the query is disabled and the
  // device simply does not count as an assignment.
  const ownLoading = own.isLoading;
  const ready = !!viewport && !layouts.isLoading && !defaults.isLoading && !ownLoading;

  return useMemo(() => {
    if (!ready || !viewport || !layouts.data || !defaults.data) return none(ready);
    const layout = resolveLayout({
      device: own.data ? { id: own.data.id, is_kiosk: own.data.isKiosk, layout_id: own.data.layoutId } : null,
      layouts: layouts.data,
      defaults: defaults.data,
      viewport,
    });
    const viewportGrid = gridFor(viewport.width, viewport.height);
    const layoutGrid = layout ? gridFor(layout.width, layout.height) : null;
    if (!layout || !viewportGrid || !layoutGrid) return none(true);
    const items = knownWidgetItems(layout[surface]);
    if (layoutGrid.rows === viewportGrid.rows) return { layout, grid: viewportGrid, items, dropped: [], ready: true };
    const rescaled = rescaleItems(items, layoutGrid, viewportGrid);
    return { layout, grid: viewportGrid, items: rescaled.items, dropped: rescaled.dropped, ready: true };
  }, [ready, viewport, layouts.data, defaults.data, own.data, surface]);
}
