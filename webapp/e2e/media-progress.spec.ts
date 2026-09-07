import { test, expect } from "@playwright/test";
import { interpolatedPosition } from "../src/components/media/progress";
import type { MediaPlayerState } from "../src/plugins/media/types";

/**
 * The progress bar moves without anybody polling for it.
 *
 * Three players polled once a second to animate a bar is traffic a wall panel
 * does not need, so position is extrapolated from the last reading instead.
 * RFC-003 §2.2.
 */

const at = (iso: string) => new Date(iso);
const base = (over: Partial<MediaPlayerState> = {}): MediaPlayerState => ({
  status: "playing",
  position: 30,
  duration: 200,
  positionUpdatedAt: "2026-09-07T10:00:00.000Z",
  capabilities: ["transport"],
  ...over,
});

test("advances while playing", () => {
  expect(interpolatedPosition(base(), at("2026-09-07T10:00:10.000Z"))).toBe(40);
});

test("stands still while paused", () => {
  const s = base({ status: "paused" });
  expect(interpolatedPosition(s, at("2026-09-07T10:00:10.000Z"))).toBe(30);
});

test("never runs past the end of the track", () => {
  // A track that finished while the tab was backgrounded must not report 900s
  // into a 200s song, which would render a bar past the end of its own box.
  expect(interpolatedPosition(base(), at("2026-09-07T10:15:00.000Z"))).toBe(200);
});

test("never goes backwards when a clock corrects itself", () => {
  // A panel correcting its time by NTP must not produce a negative position.
  expect(interpolatedPosition(base(), at("2026-09-07T09:59:00.000Z"))).toBe(30);
});

test("is undefined when the device reports no position", () => {
  const s = base({ position: undefined });
  expect(interpolatedPosition(s, at("2026-09-07T10:00:10.000Z"))).toBeUndefined();
});

test("falls back to the raw position when there is no timestamp", () => {
  const s = base({ positionUpdatedAt: undefined });
  expect(interpolatedPosition(s, at("2026-09-07T10:00:10.000Z"))).toBe(30);
});

test("tolerates a duration it was never given", () => {
  const s = base({ duration: undefined });
  expect(interpolatedPosition(s, at("2026-09-07T10:00:10.000Z"))).toBe(40);
});
