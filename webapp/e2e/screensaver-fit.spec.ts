import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Found by scripts/screen-matrix.mjs on portrait screens:
 *
 *  - The time came out 40% wider than the cards it is fitted to (217px font
 *    for 384px cards at 1080x1920). useFitToWidth set a 100px probe on the
 *    clock and read the width back; that read sometimes returned the width
 *    at the old size. Later, with the probe gone, the clock came out too
 *    small, measured before the display font had swapped in, which changes
 *    the digits' width without touching the cards'.
 *  - At 720px wide (1080x1920 at Windows 150%) with the forecast on, the
 *    news list ran 37px under the weather.
 */

const hook = () => readFileSync("src/hooks/use-fit-to-width.ts", "utf8");
const saver = () => readFileSync("src/components/screensaver.tsx", "utf8");

test("the fit works from the size and width the text has now, with no probe", () => {
  const code = hook();
  expect(code).not.toMatch(/PROBE|style\.fontSize\s*=/);
  expect(code).toContain("const fit = Math.floor((size * width) / now);");
});

test("the fit is measured again when the clock's own width changes, as when its font swaps in", () => {
  expect(hook()).toContain("for (const { ref } of targets) if (ref.current) ro.observe(ref.current);");
});

test("the news list ends before the weather column, or moves under it", () => {
  const code = saver();
  expect(code).toContain("ref={weatherColumnRef}");
  expect(code).toContain("const newsUnder = weatherBox !== null && weatherBox.w > 0 && newsBeside < 256;");
  expect(code).toMatch(/\.\.\.newsStyle, \.\.\.burnInStyle/);
});
