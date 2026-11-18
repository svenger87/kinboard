import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The join page's welcome on a landscape screen. Measured at 1280x720 (a
 * 1920x1080 screen at Windows 150%) and 1280x800 (a tablet): the two columns
 * ran edge to edge, 64px from each side, the card was 500px wide with its
 * buttons stretched to 420px bars, and the 72px heading filled a third of a
 * 720px-tall screen. Now the block is 1024px at most and centred, the card at
 * most 24rem, and a short landscape screen gets a 60px heading.
 */

const join = () => readFileSync("src/app/join/page.tsx", "utf8");

test("the welcome is at most 1024px wide, centred, with the card at most 24rem", () => {
  expect(join()).toContain("lg:mx-auto lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]");
});

test("a short landscape screen gets the smaller heading; portrait keeps the large one", () => {
  expect(join()).toContain("lg:text-7xl [@media(orientation:landscape)_and_(max-height:800px)]:text-6xl");
});
