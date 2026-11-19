"use client";

import { useCallback, useId, useState } from "react";
import { GRID, type Grid } from "@/lib/layouts/grid";

/** How the editor draws the grid: dots at every step plus the cells' edges, the cells' edges only, or nothing. */
export type GridDisplay = "dots" | "lines" | "off";

export const GRID_DISPLAYS: readonly GridDisplay[] = ["dots", "lines", "off"];
const STORAGE_KEY = "kinboard_layout_grid_display";
/** Below this many screen pixels per step the dots run together, and only the cells' edges are drawn. */
const MIN_DOT_STEP_PX = 8;

function readDisplay(): GridDisplay {
  if (typeof window === "undefined") return "dots";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return GRID_DISPLAYS.includes(v as GridDisplay) ? (v as GridDisplay) : "dots";
  } catch {
    return "dots";
  }
}

/** The grid display chosen in this browser (dots by default), and a setter that remembers it. */
export function useGridDisplay(): [GridDisplay, (v: GridDisplay) => void] {
  const [display, setDisplay] = useState<GridDisplay>(readDisplay);
  const set = useCallback((v: GridDisplay) => {
    setDisplay(v);
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* Storage unavailable: the choice lasts as long as the page. */
    }
  }, []);
  return [display, set];
}

/**
 * The grid under the editor's boxes, in the screen's own pixels (the canvas
 * scales it with the boxes): a dot where each step starts, which is where a
 * box's top left corner can sit, and the outline of each cell, four steps
 * of a cell plus its gap. One SVG with two repeating patterns, however fine
 * the grid. The dots are left out when a step is under 8 screen pixels.
 */
export function GridOverlay({ grid, display, scale }: { grid: Grid; display: GridDisplay; scale: number }) {
  // useId's colons are not allowed in a url(#…) reference.
  const id = `kb-grid-${useId().replace(/[^\w-]/g, "")}`;
  const s = scale || 1;
  const pitch = grid.step * GRID.STEPS_PER_CELL;
  const width = grid.columns * grid.step;
  const height = grid.rows * grid.step;
  const line = 1 / s;
  const dots = display === "dots" && grid.step * s >= MIN_DOT_STEP_PX;
  return (
    <svg
      data-testid="editor-grid-overlay"
      data-display={display}
      data-dots={dots}
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0"
      width={grid.width}
      height={grid.height}
    >
      {display !== "off" && (
        <>
          <defs>
            <pattern id={`${id}-cells`} patternUnits="userSpaceOnUse" x={grid.offsetX} y={grid.offsetY} width={pitch} height={pitch}>
              <rect
                x={line / 2}
                y={line / 2}
                width={grid.cell - line}
                height={grid.cell - line}
                rx={Math.min(8, grid.cell / 6)}
                fill="rgba(255,255,255,0.025)"
                stroke="rgba(255,255,255,0.16)"
                strokeWidth={line}
              />
            </pattern>
            {dots && (
              <pattern id={`${id}-dots`} patternUnits="userSpaceOnUse" x={grid.offsetX - grid.step / 2} y={grid.offsetY - grid.step / 2} width={grid.step} height={grid.step}>
                <circle cx={grid.step / 2} cy={grid.step / 2} r={1.25 / s} fill="rgba(255,255,255,0.4)" />
              </pattern>
            )}
          </defs>
          <rect x={grid.offsetX} y={grid.offsetY} width={width - GRID.GAP} height={height - GRID.GAP} fill={`url(#${id}-cells)`} />
          {dots && (
            <rect x={grid.offsetX - grid.step / 2} y={grid.offsetY - grid.step / 2} width={width} height={height} fill={`url(#${id}-dots)`} />
          )}
        </>
      )}
    </svg>
  );
}
