/**
 * Redraws a layout for a screen with a different number of rows. Columns
 * always stay 12, so only the vertical position and height change: scaled by
 * the rows ratio, held at the widget's minimum, and pushed down past whatever
 * they now collide with. What no longer fits is returned as dropped rather
 * than squeezed below readable, so the designer can tell the family.
 */
import { gridFor, type Grid } from "./grid";
import { SAVER_WIDGETS } from "./widgets";
import { collides, validateItems } from "./validate";
import { firstFreeSpot, growToward } from "./place";
import type { LayoutItem, SaverWidgetKey } from "./types";

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

/**
 * A layout's items redrawn for another screen, as many as can be kept: what
 * rescaleItems cannot place is dropped, then whatever the server's check
 * still refuses (an item that was never valid, a size the new screen's
 * columns cannot hold) is dropped one at a time until the rest is valid.
 * The dropped widgets then get whatever cells are still free (placeDropped).
 * Used when a layout is copied to a new size, so the copy keeps everything
 * that fits instead of starting empty. `dropped` holds item ids.
 */
export function fitItems(
  items: unknown,
  from: { width: number; height: number },
  to: { width: number; height: number },
): { items: LayoutItem[]; dropped: string[] } {
  const a = gridFor(from.width, from.height);
  const b = gridFor(to.width, to.height);
  const ids = Array.isArray(items)
    ? items.flatMap((i) => (i && typeof i === "object" && typeof (i as { id?: unknown }).id === "string" ? [(i as { id: string }).id] : []))
    : [];
  if (!a || !b || !Array.isArray(items)) return { items: [], dropped: ids };

  // Only well-formed items can be rescaled; the rest are dropped up front.
  const dropped: string[] = [];
  const wellFormed: LayoutItem[] = [];
  for (const raw of items) {
    const one = validateItems([raw], from.width, from.height);
    if (one.ok) wellFormed.push(one.items[0]);
    else if (raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string") dropped.push((raw as { id: string }).id);
  }
  const rescaled = rescaleItems(wellFormed, a, b);
  dropped.push(...rescaled.dropped);
  let kept = rescaled.items;
  for (;;) {
    const checked = validateItems(kept, to.width, to.height);
    if (checked.ok) {
      kept = checked.items;
      break;
    }
    const bad = checked.itemId;
    if (!bad || !kept.some((i) => i.id === bad)) {
      dropped.push(...kept.map((i) => i.id));
      kept = [];
      break;
    }
    dropped.push(bad);
    kept = kept.filter((i) => i.id !== bad);
  }
  return placeDropped(kept, wellFormed.filter((i) => dropped.includes(i.id)), dropped, b.rows, to);
}

/** The order dropped widgets get the free cells in: the clock first, the least missed last. */
const REPLACE_ORDER: SaverWidgetKey[] = [
  "clock", "date", "events", "weatherNow", "news", "birthdays", "forecast",
  "nextEvent", "lessons", "holidays", "energy", "vehicles", "photoCount",
];

/**
 * Gives dropped widgets the free cells that are left: in REPLACE_ORDER, each
 * at its minimum box in the first free spot (rows top to bottom, columns left
 * to right), then, in the same order, each grown toward its default box. Only
 * a widget with no free spot even at its minimum stays dropped. The ids and
 * text sizes are the original items'.
 */
function placeDropped(
  kept: LayoutItem[],
  candidates: LayoutItem[],
  dropped: string[],
  rows: number,
  to: { width: number; height: number },
): { items: LayoutItem[]; dropped: string[] } {
  const rank = (i: LayoutItem) => REPLACE_ORDER.indexOf(i.widget);
  const usedWidgets = new Set(kept.map((i) => i.widget));
  const ordered = [...candidates].sort((a, b) => rank(a) - rank(b));
  const placed: LayoutItem[] = [];
  for (const item of ordered) {
    // A second copy of a widget already on the screen stays dropped.
    if (usedWidgets.has(item.widget)) continue;
    const spot = firstFreeSpot([...kept, ...placed], SAVER_WIDGETS[item.widget].min, rows);
    if (!spot) continue;
    placed.push({ ...item, ...spot });
    usedWidgets.add(item.widget);
  }
  for (let n = 0; n < placed.length; n++) {
    const others = [...kept, ...placed.filter((_, m) => m !== n)];
    placed[n] = { ...placed[n], ...growToward(placed[n], SAVER_WIDGETS[placed[n].widget].box, others, rows) };
  }
  const items = [...kept, ...placed];
  const checked = validateItems(items, to.width, to.height);
  // Cannot fail (each box was placed on free cells at or above its minimum); kept as the last word.
  if (!checked.ok) return { items: kept, dropped };
  const back = new Set(placed.map((i) => i.id));
  return { items: checked.items, dropped: dropped.filter((id) => !back.has(id)) };
}
