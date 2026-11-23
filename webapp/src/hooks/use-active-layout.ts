import { useEffect, useMemo, useState } from "react";
import { GRID, gridFor, type Grid } from "@/lib/layouts/grid";
import { resolveLayout } from "@/lib/layouts/resolve";
import { rescaleItems } from "@/lib/layouts/rescale";
import type { HomeLayoutItem, Layout, LayoutItem, Surface } from "@/lib/layouts/types";
import { collides } from "@/lib/layouts/validate";
import { HOME_WIDGETS, knownWidgetItems } from "@/lib/layouts/widgets";
import type { PreviewLayout } from "@/lib/screensaver-gate";
import { useLayoutDefaults, useLayouts, useOwnDeviceLayout } from "./use-layouts";

interface Viewport {
  width: number;
  height: number;
}

/**
 * The navigation bar's height at a screen width, in CSS pixels, as
 * globals.css sets `--nav-spacing`: the phone bar (2.8125rem) below 768px,
 * the desktop bar (4.25rem) from 768px and 4.5rem from 1024px. Without the
 * safe area, which only a phone has and a layout's drawn size does not know.
 */
export function navHeightAt(width: number): number {
  return width < 768 ? 45 : width < 1024 ? 68 : 72;
}

/**
 * The area Home's grid gets on a screen of this size: the screen less the
 * navigation bar at the bottom (RFC-022 §3.5). The editor's Home tab draws
 * on the same area, so a layout drawn for a screen has the same rows there
 * as on the screen.
 */
export function homeArea(size: { width: number; height: number }): Viewport {
  return { width: size.width, height: Math.max(0, size.height - navHeightAt(size.width)) };
}

/** What `--nav-spacing` is on this page, safe area included: 0 where there is no such variable. */
function measureNav(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;height:var(--nav-spacing, 0px)";
  document.body.appendChild(probe);
  const h = probe.offsetHeight;
  probe.remove();
  return h;
}

interface Screen extends Viewport {
  /** The navigation bar's height on this page (0 when not measured). */
  nav: number;
}

/** The page's size, and on Home the navigation bar's height. */
const readViewport = (withNav: boolean): Screen | null =>
  typeof window === "undefined"
    ? null
    : { width: window.innerWidth, height: window.innerHeight, nav: withNav ? measureNav() : 0 };

/**
 * The page's size, read at once on the client: starting at null made the
 * first render of every screensaver activation "not ready", which is what
 * let the built-in screensaver draw before a designed one. `withNav` also
 * measures the navigation bar (Home's grid ends above it).
 */
function useViewport(withNav = false): Screen | null {
  const [viewport, setViewport] = useState<Screen | null>(() => readViewport(withNav));
  useEffect(() => {
    const read = () =>
      setViewport((prev) => {
        const next = readViewport(withNav);
        return prev && next && prev.width === next.width && prev.height === next.height && prev.nav === next.nav ? prev : next;
      });
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
  }, [withNav]);
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

/**
 * Home's items redrawn for a grid with other rows: rescaleItems' rule (both
 * edges scaled, an edge on a whole cell stays on one, held at the widget's
 * minimum, pushed down past collisions, dropped when it no longer fits) with
 * Home's minimums. rescaleItems itself reads the screensaver's catalogue.
 */
function rescaleHome(items: HomeLayoutItem[], from: Grid, to: Grid): { items: HomeLayoutItem[]; dropped: string[] } {
  const ratio = to.cellRows / from.cellRows;
  const S = GRID.STEPS_PER_CELL;
  const edge = (v: number) => (v % S === 0 ? Math.round((v * ratio) / S) * S : Math.round(v * ratio));
  const scaled = items.map((i) => {
    const y = edge(i.y);
    return { ...i, y, h: Math.max(HOME_WIDGETS[i.widget].min.h, edge(i.y + i.h) - y) };
  });
  const placed = new Map<string, HomeLayoutItem>();
  const dropped: string[] = [];
  for (const i of [...scaled].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let y = Math.min(i.y, Math.max(0, to.rows - i.h));
    const moved = { ...i };
    while (y + i.h <= to.rows) {
      moved.y = y;
      if (![...placed.values()].some((p) => collides(p, moved))) break;
      y++;
    }
    if (y + i.h > to.rows) dropped.push(i.id);
    else placed.set(i.id, moved);
  }
  return { items: items.flatMap((i) => placed.get(i.id) ?? []), dropped };
}

/** `items` made for a `from` screen, fitted to the `to` screen's grid. */
function fitTo<I extends LayoutItem<string>>(items: I[], from: Viewport, viewport: Viewport, surface: Surface) {
  const viewportGrid = gridFor(viewport.width, viewport.height);
  const layoutGrid = gridFor(from.width, from.height);
  if (!viewportGrid || !layoutGrid) return null;
  if (layoutGrid.rows === viewportGrid.rows) return { grid: viewportGrid, items, dropped: [] as string[] };
  const rescaled =
    surface === "home"
      ? rescaleHome(items as unknown as HomeLayoutItem[], layoutGrid, viewportGrid)
      : rescaleItems(items as unknown as LayoutItem[], layoutGrid, viewportGrid);
  return { grid: viewportGrid, items: rescaled.items as unknown as I[], dropped: rescaled.dropped };
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
  const viewport = useViewport(isHome);
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
      const fitted = fitTo(knownWidgetItems(preview.items), preview, { width: viewport.width, height: viewport.height }, surface);
      return fitted ? { layout: null, ...fitted, ready: true } : none(true);
    }
    if (!ready || !viewport || !layouts.data || !defaults.data) return none(ready);
    // Which layout follows the whole screen (its orientation, its width);
    // the rows of Home's grid follow the area above the navigation bar.
    const screen = { width: viewport.width, height: viewport.height };
    const layout = resolveLayout({
      device: own.data ? { id: own.data.id, is_kiosk: own.data.isKiosk, layout_id: own.data.layoutId } : null,
      layouts: layouts.data,
      defaults: defaults.data,
      viewport: screen,
    });
    if (!layout) return none(true);
    if (isHome) {
      const items = knownWidgetItems(layout.home, "home");
      if (items.length === 0) return none(true);
      const area = { width: viewport.width, height: Math.max(0, viewport.height - viewport.nav) };
      const fitted = fitTo(items, homeArea(layout), area, surface);
      return fitted ? { layout, ...fitted, ready: true } : none(true);
    }
    const fitted = fitTo(knownWidgetItems(layout.screensaver), layout, screen, surface);
    return fitted ? { layout, ...fitted, ready: true } : none(true);
  }, [preview, isHome, ready, viewport, layouts.data, defaults.data, own.data, surface]);
}
