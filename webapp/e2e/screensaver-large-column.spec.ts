import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The large details on a portrait screen follow a family's mockup (#282): one
 * column, the clock and the date as wide as the cards, 60px between the
 * blocks and to the edges, measured to the letters. Measured at 1080x1920,
 * 800x1280 and 600x900: left edge, lists, card to clock and date to bottom all
 * 60px, the digits ending within 1px of the cards' edge. Landscape keeps the
 * layout it had (corners on a large screen; a clock this size pushed the
 * events off the top of a 900x600 one).
 */

const saver = () => readFileSync("src/components/screensaver.tsx", "utf8");

test("the column is the large details on a portrait screen, and nothing else", () => {
  const code = saver();
  expect(code).toContain('const portrait = useMediaQuery("(orientation: portrait)");');
  expect(code).toContain("const column = largeDetails && portrait;");
});

test("60px apart and from the edges", () => {
  const code = saver();
  expect(code).toContain('style={column ? { left: 28, right: 28, bottom: "calc(60px + var(--idle-creature-floor, 0px))", rowGap: 60 } : undefined}');
  expect(code).toContain('...(column ? { width: "100%", rowGap: 60 } : {})');
  // The clock and the lists share the column's width.
  expect(code).toContain('...(column ? { width: "100%", maxWidth: "36rem" } : {})');
});

test("the clock and the date are fitted to the column, the date capped, the time held to the screen's height", () => {
  const code = saver();
  expect(code).toContain("[{ ref: clockDigitsRef, max: () => window.innerHeight * 0.18 }, { ref: clockDateRef, max: (w) => w / 9 }],");
  expect(code).toContain("style={column ? { fontSize: fitted?.[0] ?? 128 } : undefined}");
  // Trimmed to the letters, so a gap is measured from the ink.
  expect(code).toContain('const TRIM = "[text-box:trim-both_cap_alphabetic]";');
  const hook = readFileSync("src/hooks/use-fit-to-width.ts", "utf8");
  expect(hook).toContain("const fit = Math.floor((PROBE * width) / natural);");
  expect(hook).toContain('window.addEventListener("resize", measure);');
});
