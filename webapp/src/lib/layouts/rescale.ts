/**
 * Redraws a layout for a screen with a different number of rows. Columns
 * always stay 12, so only the vertical position and height change: scaled by
 * the rows ratio, held at the widget's minimum, and pushed down past whatever
 * they now collide with. What no longer fits is returned as dropped rather
 * than squeezed below readable, so the designer can tell the family.
 */
import type { Grid } from "./grid";
import { SAVER_WIDGETS } from "./widgets";
import { collides } from "./validate";
import type { LayoutItem } from "./types";

export function rescaleItems(
  items: LayoutItem[],
  from: Grid,
  to: Grid,
): { items: LayoutItem[]; dropped: string[] } {
  if (from.rows === to.rows) return { items, dropped: [] };
  const ratio = to.rows / from.rows;

  const scaled = items.map((i) => ({
    ...i,
    y: Math.round(i.y * ratio),
    h: Math.max(SAVER_WIDGETS[i.widget].min.h, Math.round(i.h * ratio)),
  }));

  const placed = new Map<string, LayoutItem>();
  const dropped: string[] = [];
  const reading = [...scaled].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const i of reading) {
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
