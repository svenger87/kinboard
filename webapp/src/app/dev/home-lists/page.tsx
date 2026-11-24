"use client";

import { notFound, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { LayoutGrid } from "@/components/layouts/layout-grid";
import { HomeDataProvider } from "@/components/layouts/home-data-context";
import { LISTS_WIDGETS } from "@/components/layouts/home-widgets/lists";
import { HOME_WIDGET_COMPONENTS } from "@/components/layouts/home-widgets";
import { useHomeData } from "@/hooks/use-home-data";
import { boxRect, gridFor } from "@/lib/layouts/grid";
import { homeMin, homeTextPx } from "@/lib/layouts/home-size";
import type { HomeLayoutItem, HomeWidgetKey, TextSize } from "@/lib/layouts/types";

/**
 * Home's list widgets (RFC-022 step 4) in boxes on a 1080x1920 grid, on the
 * app's theme, for e2e/home-list-widgets-ui.spec.ts and a look by eye.
 * Query: `widgets` (comma-separated keys, default all nine), `size`
 * ("min", each at its minimum, or "large", 24x20 steps) or `w`/`h` in steps,
 * `text` (S, M, L, XL). The boxes flow left to right, four steps apart.
 *
 * `probe=1` measures minimums instead: for a Home area of `sw`x`sh` px (a
 * screen less its nav bar), each widget in `widgets` (any Home widget) is
 * drawn at its minimum width (homeMin) and at every height from `from` (2)
 * to `max` steps, one column per widget, each box at that screen's pixel
 * size and Home's text size. `data-probe-min` marks the box at its minimum;
 * `full=1` draws every box full width instead.
 * Needs a family session. Not served in production.
 */

const WIDTH = 1080;
const HEIGHT = 1920;
const ALL = Object.keys(LISTS_WIDGETS) as HomeWidgetKey[];

function items(params: URLSearchParams): HomeLayoutItem[] {
  const keys = (params.get("widgets")?.split(",").filter((k) => k in LISTS_WIDGETS) as HomeWidgetKey[] | undefined) ?? ALL;
  const size = params.get("size") ?? "min";
  const text = (["S", "M", "L", "XL"].includes(params.get("text") ?? "") ? params.get("text") : "M") as TextSize;
  const out: HomeLayoutItem[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const widget of keys) {
    const min = homeMin(widget, text, WIDTH, HEIGHT);
    const w = Number(params.get("w")) || (size === "large" ? 24 : min.w);
    const h = Number(params.get("h")) || (size === "large" ? 20 : min.h);
    if (x + w > 48) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    out.push({ id: widget, widget, x, y, w, h, text });
    x += w;
    rowH = Math.max(rowH, h);
  }
  return out;
}

function Boxes() {
  const params = useSearchParams();
  const layout = useMemo(() => items(new URLSearchParams(params.toString())), [params]);
  const data = useHomeData();
  const grid = gridFor(WIDTH, HEIGHT)!;
  return (
    <HomeDataProvider value={data}>
      <LayoutGrid
        grid={grid}
        items={layout}
        surface="home"
        render={(item, box) => {
          const Widget = LISTS_WIDGETS[item.widget]!;
          return <Widget item={item} box={box} editing={params.get("editing") === "1"} />;
        }}
      />
    </HomeDataProvider>
  );
}

/** One column per widget, one box per height, sized as the grid of a `sw`x`sh` area draws it. */
function Probe({ params }: { params: URLSearchParams }) {
  const data = useHomeData();
  const sw = Number(params.get("sw")) || WIDTH;
  const sh = Number(params.get("sh")) || HEIGHT;
  const grid = gridFor(sw, sh);
  const text = (params.get("text") ?? "XL") as TextSize;
  const max = Number(params.get("max")) || 20;
  const keys = (params.get("widgets") ?? "").split(",").filter((k) => k in HOME_WIDGET_COMPONENTS) as HomeWidgetKey[];
  if (!grid) return <p data-testid="probe-no-grid">no grid</p>;
  const font = homeTextPx(text, sw, sh);
  const from = Math.max(1, Number(params.get("from")) || 2);
  let left = 0;
  return (
    <HomeDataProvider value={data}>
      {keys.map((widget) => {
        const Widget = HOME_WIDGET_COMPONENTS[widget]!;
        const min = homeMin(widget, text, sw, sh);
        // `full=1`: full width, as the clock block's pieces sit.
        const w = params.get("full") === "1" ? 48 : min.w;
        const width = Math.round(boxRect({ x: 0, y: 0, w, h: 2 }, grid).width);
        const x = left;
        left += width + 16;
        let top = 0;
        return Array.from({ length: Math.max(0, max - from + 1) }, (_, i) => i + from).map((h) => {
          const height = Math.round(boxRect({ x: 0, y: 0, w, h }, grid).height);
          const y = top;
          top += height + 16;
          const item = { id: `${widget}-${h}`, widget, x: 0, y: 0, w, h, text } as HomeLayoutItem;
          return (
            <div
              key={item.id}
              data-probe={widget}
              data-probe-h={h}
              data-probe-min={h === min.h || undefined}
              style={{ position: "absolute", left: x, top: y, width, height, overflow: "hidden", fontSize: font, ["--kb-em" as string]: `${font}px` }}
            >
              <Widget item={item} box={{ width, height }} />
            </div>
          );
        });
      })}
    </HomeDataProvider>
  );
}

function Widgets() {
  const params = useSearchParams();
  if (params.get("probe") === "1") return <Probe params={new URLSearchParams(params.toString())} />;
  return <Boxes />;
}

export default function HomeListsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div data-testid="home-lists" className="bg-background text-foreground" style={{ width: WIDTH, minHeight: HEIGHT, position: "relative" }}>
      <Suspense>
        <Widgets />
      </Suspense>
    </div>
  );
}
