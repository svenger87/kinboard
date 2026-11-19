"use client";

import { GRID, type Grid } from "@/lib/layouts/grid";
import type { Box } from "@/lib/layouts/arrange";
import type { Guides } from "@/lib/layouts/guides";

/**
 * Where a guide is drawn, in the screen's own pixels, for a box being moved
 * that lies on it: on the box's own edge or centre as drawn. A box is drawn
 * half a gap inside its steps on each side, so a line that is the box's left
 * is drawn at the step's start, its right a gap before, and its centre half
 * a gap before (`at` in steps from the grid's offset).
 */
function drawnAt(at: number, start: number, size: number, offset: number, step: number): number {
  const px = offset + at * step;
  if (at === start) return px;
  if (at === start + size) return px - GRID.GAP;
  return px - GRID.GAP / 2;
}

/**
 * The guides of the box being dragged or resized: a line across the whole
 * canvas for each other box's edge or centre (or the screen's centre) that
 * the box lines up with. One screen pixel wide whatever the canvas scale,
 * in the primary colour, over the boxes but never in the pointer's way.
 */
export function GuideLines({ grid, box, guides, scale }: { grid: Grid; box: Box; guides: Guides; scale: number }) {
  const line = 1 / (scale || 1);
  const style = { background: "hsl(var(--primary))" };
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
      {guides.x.map((at) => (
        <div
          key={`x${at}`}
          data-testid="editor-guide"
          data-axis="x"
          data-at={at}
          className="absolute top-0"
          style={{ ...style, left: drawnAt(at, box.x, box.w, grid.offsetX, grid.step) - line / 2, width: line, height: grid.height }}
        />
      ))}
      {guides.y.map((at) => (
        <div
          key={`y${at}`}
          data-testid="editor-guide"
          data-axis="y"
          data-at={at}
          className="absolute left-0"
          style={{ ...style, top: drawnAt(at, box.y, box.h, grid.offsetY, grid.step) - line / 2, height: line, width: grid.width }}
        />
      ))}
    </div>
  );
}
