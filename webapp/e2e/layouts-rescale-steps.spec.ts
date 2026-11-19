import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { builtInScreensaver } from "../src/lib/layouts/built-in";
import { fitItems } from "../src/lib/layouts/rescale";
import type { LayoutItem } from "../src/lib/layouts/types";

/**
 * Positions moved from 12 cells to 48 quarter-cell steps. A layout on whole
 * cells must rescale exactly as it did: the fixture holds what the 12-column
 * code produced for the 1080x1920 built-in on other screens, captured before
 * the change.
 */

interface Entry {
  to: { width: number; height: number };
  items: LayoutItem[];
  dropped: string[];
}
const FIXTURE: Entry[] = JSON.parse(readFileSync(join(__dirname, "fixtures/layouts-rescale-12col.json"), "utf8"));

for (const entry of FIXTURE) {
  test(`1080x1920 built-in fitted to ${entry.to.width}x${entry.to.height} matches the 12-column result ×4`, () => {
    const got = fitItems(builtInScreensaver(1080, 1920), { width: 1080, height: 1920 }, entry.to);
    const want = entry.items.map((i) => ({ ...i, x: i.x * 4, y: i.y * 4, w: i.w * 4, h: i.h * 4 }));
    expect(got.items).toEqual(want);
    expect(got.dropped).toEqual(entry.dropped);
  });
}
