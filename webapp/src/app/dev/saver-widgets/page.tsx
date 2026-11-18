"use client";

import { notFound } from "next/navigation";
import { useMemo, useState } from "react";
import { LayoutGrid } from "@/components/layouts/layout-grid";
import { ScreensaverDataProvider, useScreensaverDataValue } from "@/components/layouts/screensaver-data-context";
import { SAVER_WIDGET_COMPONENTS } from "@/components/layouts/saver-widgets";
import { useScreensaverData } from "@/hooks/use-screensaver-data";
import { builtInScreensaver } from "@/lib/layouts/built-in";
import { gridFor } from "@/lib/layouts/grid";
import type { LayoutItem } from "@/lib/layouts/types";

/**
 * Every screensaver widget in a box, on a 1080x1920 grid: the built-in
 * arrangement and, in the free rows above the clock, the widgets it does not
 * use. A visual check while the layouts are built; needs a family session.
 * Not served in production.
 */

const WIDTH = 1080;
const HEIGHT = 1920;

const EXTRA: LayoutItem[] = [
  { id: "nextEvent", widget: "nextEvent", x: 6, y: 9, w: 6, h: 1, text: "M" },
  { id: "photoCount", widget: "photoCount", x: 6, y: 10, w: 2, h: 1, text: "M" },
  { id: "holidays", widget: "holidays", x: 0, y: 11, w: 6, h: 3, text: "M" },
  { id: "lessons", widget: "lessons", x: 6, y: 11, w: 6, h: 3, text: "M" },
  { id: "energy", widget: "energy", x: 0, y: 14, w: 6, h: 3, text: "M" },
  { id: "vehicles", widget: "vehicles", x: 6, y: 14, w: 6, h: 3, text: "M" },
  // The forecast at its smallest box and in a large one, beside the clock.
  { id: "forecast-small", widget: "forecast", x: 0, y: 17, w: 4, h: 2, text: "M" },
  { id: "forecast-large", widget: "forecast", x: 6, y: 17, w: 6, h: 5, text: "XL" },
];

function Widgets({ editing }: { editing: boolean }) {
  const value = useScreensaverDataValue(useScreensaverData());
  const grid = gridFor(WIDTH, HEIGHT)!;
  const items = useMemo(() => [...builtInScreensaver(WIDTH, HEIGHT), ...EXTRA], []);
  return (
    <ScreensaverDataProvider value={value}>
      <LayoutGrid
        grid={grid}
        items={items}
        render={(item, box) => {
          const Widget = SAVER_WIDGET_COMPONENTS[item.widget];
          return (
            <div style={{ width: "100%", height: "100%", outline: "1px dashed rgba(255,255,255,0.25)" }}>
              <Widget item={item} box={box} editing={editing} />
            </div>
          );
        }}
      />
    </ScreensaverDataProvider>
  );
}

export default function SaverWidgetsPage() {
  const [editing, setEditing] = useState(false);
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div style={{ width: WIDTH, height: HEIGHT, position: "relative", background: "#1c1f26", color: "white" }}>
      <label style={{ position: "absolute", top: 4, left: 4, zIndex: 1, fontSize: 12, opacity: 0.6 }}>
        <input type="checkbox" checked={editing} onChange={(e) => setEditing(e.target.checked)} /> editing
      </label>
      <Widgets editing={editing} />
    </div>
  );
}
