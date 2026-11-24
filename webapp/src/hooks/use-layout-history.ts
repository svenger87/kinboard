"use client";

import { useCallback, useMemo, useState } from "react";
import type { LayoutItem } from "@/lib/layouts/types";

/** How many steps back undo reaches. */
export const HISTORY_LIMIT = 50;

/** Any placed box, of either surface. */
type Item = LayoutItem<string>;

/** One surface's arrangements: the screensaver's unless a Home item type is given. */
export interface History<T extends Item = LayoutItem> {
  past: T[][];
  present: T[];
  future: T[][];
}

/** Whether two arrangements are the same, item by item. */
export function sameItems(a: readonly Item[], b: readonly Item[]): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** One edit: the present moves into the past (the oldest step falls off), redo is gone. No-op when nothing changed. */
export function pushHistory<T extends Item>(h: History<T>, next: T[]): History<T> {
  if (sameItems(h.present, next)) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undoHistory<T extends Item>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redoHistory<T extends Item>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

/**
 * The editor's items with undo and redo, for this visit only. `dirty` says
 * whether they differ from `initial`, which the editor moves to what it last
 * saved, so a save makes it clean and an undo past the save makes it dirty
 * again. One history per surface: the editor keeps one for Home and one for
 * the screensaver, so undo only ever changes the face on screen.
 */
export function useLayoutHistory<T extends Item = LayoutItem>(initial: T[]): {
  items: T[];
  set(next: T[]): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
} {
  const [history, setHistory] = useState<History<T>>(() => ({ past: [], present: initial, future: [] }));
  const set = useCallback((next: T[]) => setHistory((h) => pushHistory(h, next)), []);
  const undo = useCallback(() => setHistory((h) => undoHistory(h)), []);
  const redo = useCallback(() => setHistory((h) => redoHistory(h)), []);
  const dirty = useMemo(() => !sameItems(history.present, initial), [history.present, initial]);
  return {
    items: history.present,
    set,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    dirty,
  };
}
