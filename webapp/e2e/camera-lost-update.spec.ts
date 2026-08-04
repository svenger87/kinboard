import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every camera mutation rewrites the whole `cameras` array, and each read
 * that array out of `useCameraSettings()` — a value captured when the
 * component last rendered.
 *
 * So two changes in quick succession both computed from the same starting
 * list, and the second overwrote the first. Delete two cameras and the one
 * you deleted first comes back, because the second write still had it.
 * `staleTime: 30000` widened that window a great deal.
 */

interface Camera {
  id: string;
  position: number;
}

const START: Camera[] = [
  { id: "a", position: 0 },
  { id: "b", position: 1 },
  { id: "c", position: 2 },
];

const remove = (cameras: Camera[], id: string) =>
  cameras.filter((c) => c.id !== id).map((c, i) => ({ ...c, position: i }));

test("the old shape resurrects a camera you deleted", () => {
  // Both handlers read the same render-time snapshot.
  const snapshot = START;
  let stored = START;

  stored = remove(snapshot, "a"); // first delete lands
  stored = remove(snapshot, "b"); // second delete computed from the SAME snapshot

  expect(stored.map((c) => c.id)).toEqual(["a", "c"]);
  // "a" is back, and "b" is gone — the opposite of what was asked for.
  expect(stored.some((c) => c.id === "a")).toBe(true);
});

test("reading the live list each time deletes both", () => {
  let stored = START;
  const current = () => stored;

  stored = remove(current(), "a");
  stored = remove(current(), "b");

  expect(stored.map((c) => c.id)).toEqual(["c"]);
});

test("positions stay contiguous after sequential deletes", () => {
  let stored = START;
  stored = remove(stored, "a");
  stored = remove(stored, "b");
  expect(stored.map((c) => c.position)).toEqual([0]);
});

test("two adds in a row keep both cameras", () => {
  let stored: Camera[] = [];
  const current = () => stored;
  const add = (cameras: Camera[], id: string) => [...cameras, { id, position: cameras.length }];

  stored = add(current(), "x");
  stored = add(current(), "y");

  expect(stored.map((c) => c.id)).toEqual(["x", "y"]);
  expect(stored.map((c) => c.position)).toEqual([0, 1]);

  // Against a fixed snapshot, the second add would have dropped the first.
  const snapshot: Camera[] = [];
  let lost = add(snapshot, "x");
  lost = add(snapshot, "y");
  expect(lost.map((c) => c.id)).toEqual(["y"]);
});

test("no camera mutation reads the settings closure any more", () => {
  const source = readFileSync(join(__dirname, "..", "src", "hooks", "use-cameras.ts"), "utf8");

  // Everything after the query hook itself — the mutations.
  const mutations = source.slice(source.indexOf("export function useAddCamera"));
  expect(mutations).not.toContain("settings?.cameras || []");
  expect(mutations).not.toContain("const { data: settings } = useCameraSettings()");

  // All four go through the live read.
  expect(mutations.split("await currentCameras()").length - 1).toBe(4);
});

test("a save seeds the cache before invalidating", () => {
  // Otherwise a mutation started immediately after still reads the
  // pre-save value while the refetch is in flight.
  const source = readFileSync(join(__dirname, "..", "src", "hooks", "use-cameras.ts"), "utf8");
  const onSuccess = source.slice(source.indexOf("onSuccess: (_data, settings)"));
  expect(onSuccess.indexOf("setQueryData")).toBeLessThan(onSuccess.indexOf("invalidateQueries"));
});

test("the live read bypasses staleTime", () => {
  const source = readFileSync(join(__dirname, "..", "src", "hooks", "use-cameras.ts"), "utf8");
  const live = source.slice(source.indexOf("function useCurrentCameras"));
  expect(live).toContain("staleTime: 0");
});
