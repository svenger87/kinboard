import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The screensaver's bottom stack keeps an even rhythm (#282). Measured at
 * 1080x1920 with the large details, before this: the clock's row was 192px
 * tall for 128px digits (the colon had no line-height of its own, and an
 * arbitrary text size carries none), the lists were 16px apart, the clock 24px
 * below them, and the photo counter added a line between birthdays and clock.
 */

const saver = () => readFileSync("src/components/screensaver.tsx", "utf8");

test("every part of the clock sets its own line height, so the row is as tall as the digits", () => {
  const code = saver();
  const start = code.indexOf('data-festival-anchor="screensaver-clock"');
  const clock = code.slice(start, code.indexOf("{formattedDate}", start));
  const spans = clock.match(/<span className=\{`[^`]*`\}>/g) ?? [];
  expect(spans.length).toBe(3);
  for (const span of spans) expect(span, span).toContain("leading-none");
});

test("one gap between the sections: the lists, and the lists and the clock", () => {
  const code = saver();
  expect(code).toContain('const sectionGap = largeDetails ? "gap-10" : "gap-6";');
  expect(code).toContain("flex flex-col-reverse ${sectionGap} landscape:lg:contents");
  expect(code).toContain("flex flex-col ${sectionGap} screensaver-slide-right");
});

test("the photo counter is out of the stack, in the corner", () => {
  const code = saver();
  const counter = code.indexOf('data-testid="screensaver-photo-count"');
  expect(counter).toBeGreaterThan(code.indexOf("{/* end bottom cluster */}"));
  expect(code).not.toContain('<div className="flex justify-end pt-2">');
});
