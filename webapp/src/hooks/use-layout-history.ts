"use client";

import { useCallback, useMemo, useState } from "react";
import type { LayoutItem } from "@/lib/layouts/types";

/** How many steps back undo reaches. */
export const HISTORY_LIMIT = 50;

export interface History {
  past: LayoutItem[][];
  present: LayoutItem[];
  future: LayoutItem[][];
}

/** Whether two arrangements are the same, item by item. */
export function sameItems(a: LayoutItem[], b: LayoutItem[]): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** One edit: the present moves into the past (the oldest step falls off), redo is gone. No-op when nothing changed. */
export function pushHistory(h: History, next: LayoutItem[]): History {
  if (sameItems(h.present, next)) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undoHistory(h: History): History {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redoHistory(h: History): History {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

/**
 * The editor's items with undo and redo, for this visit only. `dirty` says
 * whether they differ from `initial`, which the editor moves to what it last
 * saved, so a save makes it clean and an undo past the save makes it dirty
 * again.
 */
export function useLayoutHistory(initial: LayoutItem[]): {
  items: LayoutItem[];
  set(next: LayoutItem[]): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
} {
  const [history, setHistory] = useState<History>(() => ({ past: [], present: initial, future: [] }));
  const set = useCallback((next: LayoutItem[]) => setHistory((h) => pushHistory(h, next)), []);
  const undo = useCallback(() => setHistory(undoHistory), []);
  const redo = useCallback(() => setHistory(redoHistory), []);
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
