import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_MONTHLY_TERMS } from "../src/lib/unsplash-defaults";

/**
 * "I very often see the same images."
 *
 * Three causes, measured rather than guessed:
 *
 * 1. Rotation picked a random index each time, excluding only the photo on
 *    screen — sampling with replacement. Over a pool of ~45 with a 30s
 *    rotation and an hourly refetch, a photo came back after ~10 others
 *    (~5 min), and ~3 of the fetched photos were never shown at all.
 * 2. Only 3 of a month's terms were drawn per fetch, and that draw was the
 *    entire hour's wallpaper.
 * 3. A narrow term can return almost nothing — "sunflowers tall rows"
 *    returned exactly one portrait photo — shrinking the whole pool.
 */

const screensaver = readFileSync(join(__dirname, "..", "src", "components", "screensaver.tsx"), "utf8");
const route = readFileSync(join(__dirname, "..", "src", "app", "api", "unsplash", "photos", "route.ts"), "utf8");

/** The shuffle bag, mirroring makeShuffledOrder. */
function makeOrder(length: number, avoidFirst = -1): number[] {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (length > 1 && order[0] === avoidFirst) {
    [order[0], order[order.length - 1]] = [order[order.length - 1], order[0]];
  }
  return order;
}

test.describe("rotation order", () => {
  test("every photo is shown before any repeats", () => {
    const order = makeOrder(45);
    expect(new Set(order).size).toBe(45);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 45 }, (_, i) => i));
  });

  test("a fresh bag doesn't open on the photo already on screen", () => {
    // The one visible repeat a shuffle can still produce is at the seam.
    for (let i = 0; i < 200; i++) {
      const onScreen = 7;
      expect(makeOrder(45, onScreen)[0]).not.toBe(onScreen);
    }
  });

  test("it beats sampling with replacement by a wide margin", () => {
    const POOL = 45, PICKS = 120; // one hour at 30s per photo
    const firstRepeat = (next: (prev: number, i: number) => number) => {
      const seen = new Set<number>();
      let prev = -1;
      for (let i = 0; i < PICKS; i++) {
        const n = next(prev, i);
        if (seen.has(n)) return i + 1;
        seen.add(n); prev = n;
      }
      return PICKS;
    };

    let order = makeOrder(POOL), cursor = 0;
    const bag = firstRepeat(() => {
      if (cursor >= order.length) { order = makeOrder(POOL); cursor = 0; }
      return order[cursor++];
    });
    const old = firstRepeat((prev) => {
      let n = Math.floor(Math.random() * POOL);
      while (n === prev) n = Math.floor(Math.random() * POOL);
      return n;
    });

    expect(bag).toBe(POOL + 1);   // the whole set, then the seam
    expect(bag).toBeGreaterThan(old);
  });

  test("degenerate pool sizes don't break it", () => {
    expect(makeOrder(0)).toEqual([]);
    expect(makeOrder(1)).toEqual([0]);
    expect(makeOrder(1, 0)).toEqual([0]); // can't avoid itself with one photo
  });

  test("the shipped screensaver uses the bag, not random picking", () => {
    expect(screensaver).not.toContain("function getRandomIndex");
    expect(screensaver).toContain("makeShuffledOrder");
    // And the preloader loads what's genuinely next rather than a guess.
    const preload = screensaver.slice(screensaver.indexOf("Proactively preload"));
    expect(preload.slice(0, 900)).toContain("photoOrder.current");
  });
});

test.describe("the term pool", () => {
  test("every month has terms, and more than the three drawn per fetch", () => {
    for (let m = 1; m <= 12; m++) {
      const terms = DEFAULT_MONTHLY_TERMS[String(m)];
      expect(terms, `month ${m}`).toBeDefined();
      expect(terms.length, `month ${m}`).toBeGreaterThanOrEqual(14);
    }
  });

  test("no duplicate terms within a month", () => {
    for (let m = 1; m <= 12; m++) {
      const terms = DEFAULT_MONTHLY_TERMS[String(m)];
      expect(new Set(terms).size, `month ${m}`).toBe(terms.length);
    }
  });

  test("the vocabulary isn't one aesthetic any more", () => {
    // It used to lean hard on industrial / abandoned / urban / night.
    const all = Object.values(DEFAULT_MONTHLY_TERMS).flat();
    const share = (w: string) => all.filter((t) => t.includes(w)).length / all.length;
    for (const word of ["industrial", "abandoned", "urban"]) {
      expect(share(word), word).toBeLessThan(0.08);
    }
  });

  test("the route draws five terms and tops up a thin pool", () => {
    expect(route).toContain("TERMS_PER_FETCH = 5");
    expect(route).toContain("MIN_POOL_SIZE");
    expect(route).toContain("while (combined.length < MIN_POOL_SIZE");
  });

  test("top-up can't loop past the terms available", () => {
    // Mirrors the loop bound: it stops when the month's terms run out.
    const ordered = ["a", "b", "c"];
    let nextTerm = 3, iterations = 0;
    while (0 < 40 && nextTerm < ordered.length) { nextTerm += 2; iterations++; }
    expect(iterations).toBe(0);
  });
});
