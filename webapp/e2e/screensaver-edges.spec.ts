import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * #282: the screensaver's blocks sat at different distances from the screen's
 * edges. Measured at 1080x1920: the news 0px from the top and 16px from the
 * left, the weather 48px from the top and 64px from the right, the clock and
 * the cards 64px and 80px from the left. Two causes: portrait offsets of 16px
 * against landscape's 48px, and `safe-area-inset`, which adds 16px of side
 * padding to whatever carries it and sets the top padding to the notch (0 on
 * a wall screen), so it overrode the news list's own padding.
 *
 * Now every block is 48px from the edges it sits against, in both
 * orientations, and the time on a portrait screen is exactly as wide as the
 * event and birthday cards above it.
 */

const saver = () => readFileSync("src/components/screensaver.tsx", "utf8");

test("news, weather, clock and cards sit 48px from the edges, with no safe-area padding on top", () => {
  const code = saver();
  expect(code).toContain("absolute top-12 left-12 w-[min(25rem,55vw)]");
  expect(code).toContain('"absolute top-12 right-12 flex flex-col items-end gap-3"');
  expect(code).toContain("absolute inset-x-12 bottom-[calc(3rem+var(--idle-creature-floor,0px))] flex flex-col-reverse");
  expect(code).toContain("landscape:lg:left-12 screensaver-slide-up");
  expect(code).toContain("landscape:lg:right-12 flex flex-col ${sectionGap} screensaver-slide-right");
  // Only the photo counter and the touch hint, small text in a corner, keep it.
  expect(code.match(/safe-area-inset screensaver-fade-in/g)?.length).toBe(2);
  expect(code.match(/safe-area-inset/g)?.length).toBe(3);
});

test("on a portrait screen the time is fitted to the cards' width, not the screen's", () => {
  const code = saver();
  expect(code).toContain("useFitToWidth(eventsBlockRef, [{ ref: clockDigitsRef }], portrait,");
  expect(code).toMatch(/ref=\{clockDigitsRef\}\s+className="flex w-fit items-baseline"/);
  // The cards keep their own width: nothing stretches them to the screen.
  expect(code).not.toContain('width: "100%", rowGap');
});
