import { useEffect, useMemo, useState } from "react";
import { gridFor, type Grid } from "@/lib/layouts/grid";
import { homeArea } from "@/lib/layouts/home-area";
import { resolveLayout } from "@/lib/layouts/resolve";
import { rescaleItems } from "@/lib/layouts/rescale";
import type { HomeLayoutItem, Layout, LayoutItem, Surface } from "@/lib/layouts/types";
import { knownWidgetItems } from "@/lib/layouts/widgets";
import type { PreviewLayout } from "@/lib/screensaver-gate";
import { useLayoutDefaults, useLayouts, useOwnDeviceLayout } from "./use-layouts";

interface Viewport {
  width: number;
  height: number;
}

/** The page's size. */
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

export interface ActiveLayout<I = LayoutItem> {
  /** The layout this screen was given; null with no layout, and for a preview (which has `grid` and `items` all the same). */
  layout: Layout | null;
  grid: Grid | null;
  items: I[];
  dropped: string[];
  /** Everything it depends on has answered (or failed): until then a screen draws neither the built-in nor a layout. */
  ready: boolean;
}

const none = <I,>(ready: boolean): ActiveLayout<I> => ({ layout: null, grid: null, items: [], dropped: [], ready });

/** `items` made for a `from` screen, fitted to the `to` screen's grid. */
function fitTo<I extends LayoutItem<string>>(items: I[], from: Viewport, viewport: Viewport, surface: Surface) {
  const viewportGrid = gridFor(viewport.width, viewport.height);
  const layoutGrid = gridFor(from.width, from.height);
  if (!viewportGrid || !layoutGrid) return null;
  if (layoutGrid.rows === viewportGrid.rows) return { grid: viewportGrid, items, dropped: [] as string[] };
  const rescaled = rescaleItems(items, layoutGrid, viewportGrid, surface);
  return { grid: viewportGrid, items: rescaled.items, dropped: rescaled.dropped };
}

/**
 * The layout this screen draws and its items, fitted to the screen's grid.
 * Null while anything it depends on is still loading, so a screen never shows
 * one layout and then flips to another. With `preview` (the layout editor's
 * Preview of the screensaver), that arrangement instead, fitted the same way.
 *
 * Assignment is the same for both surfaces (resolveLayout): the screen's own
 * layout, else on a kiosk the family's default for its orientation, else
 * none; a laptop or a phone only with a layout of its own, and nothing below
 * the grid's 600px (RFC-022 §3.6). On Home the grid is the screen less the
 * navigation bar, and a layout whose `home` is empty is no layout: today's
 * Home.
 */
export function useActiveLayout(surface: "screensaver", preview?: PreviewLayout | null): ActiveLayout<LayoutItem>;
export function useActiveLayout(surface: "home"): ActiveLayout<HomeLayoutItem>;
export function useActiveLayout(
  surface: Surface,
  preview: PreviewLayout | null = null,
): ActiveLayout<LayoutItem<string>> {
  const isHome = surface === "home";
  const viewport = useViewport();
  const layouts = useLayouts();
  const defaults = useLayoutDefaults();
  const own = useOwnDeviceLayout();
  // No device on this screen (not paired): the query is disabled and the
  // device simply does not count as an assignment.
  const ownLoading = own.isLoading;
  const ready = !!viewport && !layouts.isLoading && !defaults.isLoading && !ownLoading;

  return useMemo((): ActiveLayout<LayoutItem<string>> => {
    if (preview && !isHome) {
      if (!viewport) return none(false);
      const fitted = fitTo(knownWidgetItems(preview.items), preview, viewport, surface);
      return fitted ? { layout: null, ...fitted, ready: true } : none(true);
    }
    if (!ready || !viewport || !layouts.data || !defaults.data) return none(ready);
    // Which layout follows the whole screen (its orientation, its width);
    // the rows of Home's grid follow the area above the navigation bar
    // (homeArea, the same for the editor, the server and this screen).
    const layout = resolveLayout({
      device: own.data ? { id: own.data.id, is_kiosk: own.data.isKiosk, layout_id: own.data.layoutId } : null,
      layouts: layouts.data,
      defaults: defaults.data,
      viewport,
    });
    if (!layout) return none(true);
    if (isHome) {
      const items = knownWidgetItems(layout.home, "home");
      if (items.length === 0) return none(true);
      const fitted = fitTo(items, homeArea(layout.width, layout.height), homeArea(viewport.width, viewport.height), surface);
      return fitted ? { layout, ...fitted, ready: true } : none(true);
    }
    const fitted = fitTo(knownWidgetItems(layout.screensaver), layout, viewport, surface);
    return fitted ? { layout, ...fitted, ready: true } : none(true);
  }, [preview, isHome, ready, viewport, layouts.data, defaults.data, own.data, surface]);
}
