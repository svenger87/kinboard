"use client";

import { notFound, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { LayoutGrid } from "@/components/layouts/layout-grid";
import { HomeDataProvider } from "@/components/layouts/home-data-context";
import { REST_WIDGETS } from "@/components/layouts/home-widgets/rest";
import { useHomeData } from "@/hooks/use-home-data";
import { gridFor } from "@/lib/layouts/grid";
import { HOME_WIDGETS } from "@/lib/layouts/widgets";
import type { HomeLayoutItem, HomeWidgetKey, LayoutItem, TextSize } from "@/lib/layouts/types";

/**
 * The "rest" group of Home widgets (RFC-022 step 4) in boxes on a real grid:
 * `?size=min` puts each at its minimum, `?size=large` at 24x14 steps, and
 * `?text=S|M|L|XL` sets the text size; `?w=&h=` the screen (1080x1920 by
 * default). `?person=<id>` pins the per-child widgets. A visual check while
 * the widgets are built; needs a family session. Not served in production.
 */

const KEYS: HomeWidgetKey[] = ["weekOverview", "schedule", "vehicles", "stonks", "pocketMoney", "creatures", "photos", "timers", "media"];

/** Rows of boxes left to right, wrapping at 48 steps. */
function pack(sizes: { key: HomeWidgetKey; w: number; h: number }[], text: TextSize, person: string | null): HomeLayoutItem[] {
  const items: HomeLayoutItem[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const { key, w, h } of sizes) {
    if (x + w > 48) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const options = person && HOME_WIDGETS[key].perChild ? { personId: person } : undefined;
    items.push({ id: key, widget: key, x, y, w, h, text, ...(options ? { options } : {}) });
    x += w;
    rowH = Math.max(rowH, h);
  }
  return items;
}

function Widgets() {
  const params = useSearchParams();
  const width = Number(params.get("w")) || 1080;
  const height = Number(params.get("h")) || 1920;
  const text = (params.get("text") ?? "M") as TextSize;
  const large = params.get("size") === "large";
  const person = params.get("person");
  const editing = params.get("editing") === "1";
  const data = useHomeData();
  const grid = gridFor(width, height)!;
  const items = useMemo(
    () =>
      pack(
        KEYS.map((key) => (large ? { key, w: 24, h: 14 } : { key, ...HOME_WIDGETS[key].min })),
        text,
        person,
      ),
    [large, text, person],
  );
  return (
    <div style={{ width, height, position: "relative" }} className="bg-background text-foreground" data-testid="home-rest-grid">
      <HomeDataProvider value={data}>
        <LayoutGrid
          grid={grid}
          // LayoutGrid is typed for the screensaver's items; it reads only the box fields.
          items={items as unknown as LayoutItem[]}
          render={(item, box) => {
            const Widget = REST_WIDGETS[item.widget as HomeWidgetKey];
            return Widget ? <Widget item={item as unknown as HomeLayoutItem} box={box} editing={editing} /> : null;
          }}
        />
      </HomeDataProvider>
    </div>
  );
}

export default function HomeRestWidgetsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense>
      <Widgets />
    </Suspense>
  );
}
