import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { firstFreeBox, nudge } from "../src/lib/layouts/place";
import { builtInScreensaver } from "../src/lib/layouts/built-in";
import { HISTORY_LIMIT, pushHistory, redoHistory, undoHistory, type History } from "../src/hooks/use-layout-history";
import { validateItems } from "../src/lib/layouts/validate";
import type { LayoutItem } from "../src/lib/layouts/types";

/**
 * The editor's rules that need no browser: where a new widget goes, how far
 * an arrow key moves one, and the undo history. No database needed.
 */

const box = (widget: LayoutItem["widget"], x: number, y: number, w: number, h: number): LayoutItem => ({ id: widget, widget, x, y, w, h, text: "M" });

test("a new widget goes to the first free spot of its default box, rows first", () => {
  expect(firstFreeBox([], "events", 22)).toEqual({ x: 0, y: 0, w: 6, h: 5 });
  // The left half is taken on the top rows: the events start beside it.
  expect(firstFreeBox([box("news", 0, 0, 6, 6)], "events", 22)).toEqual({ x: 6, y: 0, w: 6, h: 5 });
});

test("with no room for the default box it shrinks toward the minimum, and gives up below it", () => {
  // Six free rows of four columns: events (default 6x5, minimum 4x3) take 4x5.
  const items = [box("news", 0, 0, 8, 6)];
  expect(firstFreeBox(items, "events", 6)).toEqual({ x: 8, y: 0, w: 4, h: 5 });
  const full = [box("news", 0, 0, 9, 6)];
  expect(firstFreeBox(full, "events", 6)).toBeNull();
});

test("on the built-in portrait layout every unplaced widget finds a valid spot", () => {
  const items = builtInScreensaver(1080, 1920);
  for (const widget of ["nextEvent", "holidays", "lessons", "energy", "vehicles", "photoCount"] as const) {
    const spot = firstFreeBox(items, widget, 22)!;
    expect(spot, widget).not.toBeNull();
    expect(validateItems([...items, { id: widget, widget, ...spot, text: "M" }], 1080, 1920).ok, widget).toBe(true);
  }
});

test("an arrow key moves a widget one cell, but not off the grid or onto another", () => {
  const items = [box("clock", 0, 0, 4, 2), box("date", 4, 0, 3, 1)];
  expect(nudge(items, "clock", 0, 1, 6)!.find((i) => i.id === "clock")).toMatchObject({ x: 0, y: 1 });
  expect(nudge(items, "clock", -1, 0, 6)).toBeNull();
  expect(nudge(items, "clock", 1, 0, 6)).toBeNull();
  expect(nudge([box("clock", 0, 4, 4, 2)], "clock", 0, 1, 6)).toBeNull();
});

test("undo and redo walk the history; a new edit clears redo; 50 steps at most", () => {
  const a = [box("clock", 0, 0, 4, 2)];
  const b = [box("clock", 1, 0, 4, 2)];
  const c = [box("clock", 2, 0, 4, 2)];
  let h: History = { past: [], present: a, future: [] };
  h = pushHistory(h, b);
  h = pushHistory(h, c);
  h = undoHistory(h);
  expect(h.present).toBe(b);
  h = redoHistory(h);
  expect(h.present).toBe(c);
  h = undoHistory(undoHistory(h));
  expect(h.present).toBe(a);
  h = pushHistory(h, c);
  expect(h.future).toEqual([]);
  expect(pushHistory(h, [...c])).toBe(h); // no change, no step

  for (let i = 0; i < 80; i++) h = pushHistory(h, [box("clock", 0, i % 4, 4, 2), box("date", 4, i, 3, 1)]);
  expect(h.past.length).toBe(HISTORY_LIMIT);
});

test("the editor uses react-grid-layout pinned, with collisions refused and no compaction", () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
  expect(pkg.dependencies["react-grid-layout"]).toBe("2.2.4");
  const canvas = readFileSync(join(__dirname, "..", "src/components/layouts/editor/canvas.tsx"), "utf8");
  expect(canvas).toContain("getCompactor(null, false, true)");
  expect(canvas).toMatch(/maxRows:\s*grid\.rows/);
  expect(canvas).toMatch(/margin:\s*\[24, 24\]/);
});

test("the editor's strings exist in German, English and French alike", () => {
  const keys = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object"
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
      : [prefix.slice(0, -1)];
  const editorOf = (lang: string) =>
    JSON.parse(readFileSync(join(__dirname, "..", "messages", `${lang}.json`), "utf8")).settings.layouts.editor;
  const en = keys(editorOf("en")).sort();
  expect(en.length).toBeGreaterThan(40);
  expect(keys(editorOf("de")).sort()).toEqual(en);
  expect(keys(editorOf("fr")).sort()).toEqual(en);
});
