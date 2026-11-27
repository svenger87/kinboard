import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * The join screen's header on a phone: the language pills never sit on top
 * of the logo or the heading.
 *
 * The bug this guards: the pills (EN/DE/FR/ZH) were `absolute top-4 right-4`
 * over a page whose content started 40px down. On a phone the welcome's first
 * line, a "Familien-Dashboard" pill, ran under them: at 375px the two boxes
 * overlapped by tens of pixels, and on the fresh-install screen the pills sat
 * on the centred icon. The pills are now a row of their own above the content,
 * so nothing can slide under them, at any width or text size.
 *
 * `/api/setup/status` and `/api/session/recognize` are routed, so both states
 * of the screen (an install with families, a fresh one) render against any
 * database. Routing needs `serviceWorkers: "block"` — the PWA worker answers
 * fetches before Playwright's routing sees them — and each route counts its
 * hits, so a route that never fired cannot be why this is green.
 *
 * The setup wizard's header (wordmark, the same pills, "Exit setup") is
 * checked from 320 to 390 too; it needs a session, so a device
 * `e2e-claude-join-header-<project>` in FAMILY_CODE's family, removed
 * afterwards.
 *
 * Runs in desktop and webkit (e2e.yml): the viewport is set per case.
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");
test.use({ serviceWorkers: "block" });
// A dev server compiles each route on first visit, behind a skeleton.
test.describe.configure({ timeout: 180_000 });

const DEVICE = "claude-join-header";

type Box = { x: number; y: number; width: number; height: number };

function intersection(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0.5 && h > 0.5 ? Math.round(w * h) : 0;
}

async function box(page: Page, selector: string): Promise<Box> {
  const loc = page.locator(selector).first();
  await expect(loc).toBeVisible();
  const b = await loc.boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  return b;
}

async function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/**
 * Text that ends past the right edge. `main` is overflow-hidden, so the page
 * never scrolls sideways and scrollWidth can't see it: at 320px the welcome's
 * column was 348px wide ("Willkommen" at 48px) and every line lost its end.
 */
async function clippedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("main *")]
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()))
      .filter((el) => el.getBoundingClientRect().right > vw + 1)
      .map((el) => `"${(el.textContent ?? "").trim().slice(0, 30)}" ends at ${Math.round(el.getBoundingClientRect().right)}`);
  });
}

/** /join in one state: "families" is the welcome, "fresh" an empty install. */
async function openJoin(page: Page, state: "families" | "fresh", locale: string) {
  const hits = { status: 0, recognize: 0 };
  const origin = test.info().project.use.baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: origin }]);
  await page.route("**/api/setup/status", (route) => {
    hits.status++;
    return route.fulfill({ json: { hasFamilies: state === "families" } });
  });
  await page.route("**/api/session/recognize", (route) => {
    hits.recognize++;
    return route.fulfill({ json: { devices: [] } });
  });
  await page.goto("/join", { waitUntil: "domcontentloaded" });
  if (state === "families") {
    // The welcome replaces the plain header once both checks are back.
    // A cold dev server shows its loading skeleton for a while: be patient.
    await expect(page.locator("main h1").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("main h1").first()).not.toHaveText("Kinboard", { timeout: 60_000 });
  } else {
    await expect(page.locator("main input").first()).toBeVisible({ timeout: 60_000 });
  }
  // Let framer-motion's entrance (0.6s, y: 20 → 0) finish before measuring.
  await page.waitForTimeout(900);
  expect(hits.status, "the /api/setup/status route never fired").toBeGreaterThan(0);
  return hits;
}

/**
 * Everything on the page the pills sit on: each visible piece of text, image
 * or icon in `main` outside the pills themselves whose box crosses theirs,
 * with the overlap in px². Generic on purpose — on main the thing underneath
 * was the eyebrow pill, which no longer exists; a check naming only the logo
 * would have nothing to measure there.
 */
async function underThePills(page: Page): Promise<string[]> {
  await expect(page.locator('main [role="group"]').first()).toBeVisible();
  return page.evaluate(() => {
    const group = document.querySelector('main [role="group"]')!;
    const g = group.getBoundingClientRect();
    const hits: string[] = [];
    for (const el of document.querySelectorAll("main *")) {
      if (group.contains(el)) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
      if (!hasText && !["IMG", "svg", "INPUT", "BUTTON"].includes(el.tagName)) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const w = Math.min(r.right, g.right) - Math.max(r.left, g.left);
      const h = Math.min(r.bottom, g.bottom) - Math.max(r.top, g.top);
      if (w > 0.5 && h > 0.5) {
        const label = (el.textContent ?? "").trim().slice(0, 30) || el.getAttribute("alt") || el.tagName;
        hits.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(w)}x${Math.round(h)}`);
      }
    }
    return hits;
  });
}

/** Overlap, in px², of the pills with the logo and with the heading. */
async function overlaps(page: Page) {
  const pills = await box(page, 'main [role="group"]');
  const heading = await box(page, "main h1");
  // Absent on a build without the logo: the test asserts it separately, so
  // the overlap itself is what a run on such a build reports.
  const logoLoc = page.locator('main [data-testid="kinboard-logo"]');
  const logo = (await logoLoc.count()) ? await box(page, 'main [data-testid="kinboard-logo"]') : null;
  return { logo: logo ? intersection(pills, logo) : 0, heading: intersection(pills, heading), under: await underThePills(page) };
}

const PHONES = [320, 360, 375, 390, 430].map((width) => ({ width, height: 800 }));
const OTHER = [
  { width: 844, height: 390 }, // a phone in landscape
  { width: 1080, height: 1920 }, // the kitchen's portrait wall screen
  { width: 1280, height: 900 }, // desktop
];

for (const state of ["families", "fresh"] as const) {
  for (const locale of ["de", "en", "fr", "zh"]) {
    test(`/join (${state}, ${locale}): the language pills overlap neither logo nor heading`, async ({ page }) => {
      await page.setViewportSize(PHONES[0]);
      await openJoin(page, state, locale);
      for (const size of [...PHONES, ...OTHER]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(100);
        const o = await overlaps(page);
        // Soft, so a failing run names every size that overlaps, not the first.
        expect.soft(o, `${size.width}x${size.height}`).toEqual({ logo: 0, heading: 0, under: [] });
        expect.soft(await sidewaysScroll(page), `${size.width}x${size.height} scrolls sideways`).toBeLessThanOrEqual(0);
        expect.soft(await clippedText(page), `${size.width}x${size.height}: text cut off at the right`).toEqual([]);
      }
      // The logo is Kinboard's, and says so to a screen reader. On the fresh
      // install's screen the mark sits over an h1 that already says it, so
      // there the mark is decorative and the heading carries the name.
      const logo = page.locator('main [data-testid="kinboard-logo"]');
      await expect(logo).toBeVisible();
      if (state === "families") await expect(logo).toHaveAccessibleName("Kinboard");
      else await expect(page.locator("main h1")).toHaveText("Kinboard");
    });
  }

  test(`/join (${state}): text at 200% still leaves the pills clear`, async ({ page }) => {
    // Large system text: every rem doubles, the pills grow wider and taller.
    await page.setViewportSize({ width: 375, height: 800 });
    await openJoin(page, state, "de");
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    for (const width of [375, 430]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(100);
      expect(await overlaps(page), `${width}px`).toEqual({ logo: 0, heading: 0, under: [] });
    }
  });

  test(`/join (${state}): page zoom 200% (a 375px phone at 2x) leaves the pills clear`, async ({ page }) => {
    // Browser zoom 200% on a 375px phone is a 188px-wide CSS viewport.
    await page.setViewportSize({ width: 188, height: 400 });
    await openJoin(page, state, "fr");
    expect(await overlaps(page)).toEqual({ logo: 0, heading: 0, under: [] });
  });
}

test.describe("setup wizard header", () => {
  // One device per project: desktop and webkit run side by side, and one
  // worker's cleanup must not sign the other's session out mid-test.
  const device = () => `${DEVICE}-${test.info().project.name}`;

  test.afterAll(() => {
    execFileSync(
      "docker",
      ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q"],
      { input: `DELETE FROM devices WHERE hardware_id = 'e2e-${device()}';`, encoding: "utf8" },
    );
  });

  for (const locale of ["de", "en", "fr"]) {
    test(`/setup (${locale}): wordmark, pills and "exit" don't overlap at 320–390px`, async ({ page }) => {
      await establishSession(page, process.env.FAMILY_CODE!, device());
      const origin = test.info().project.use.baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
      await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: origin }]);
      await page.setViewportSize({ width: 320, height: 700 });
      // /join re-navigates to itself ~2s after loading; in WebKit a goto
      // before that is "interrupted by another navigation" (CLAUDE.md, #378).
      // Let it settle, and try again once if it still collides.
      await page.waitForTimeout(2500);
      await page.goto("/setup/region", { waitUntil: "domcontentloaded" }).catch(async () => {
        await page.waitForTimeout(2500);
        await page.goto("/setup/region", { waitUntil: "domcontentloaded" });
      });
      await expect(page.locator('main header [role="group"]').first()).toBeVisible({ timeout: 60_000 });
      for (const width of [320, 360, 375, 390]) {
        await page.setViewportSize({ width, height: 700 });
        await page.waitForTimeout(100);
        const pills = await box(page, 'main header [role="group"]');
        const wordmark = await box(page, "main header a >> nth=0");
        const exit = await box(page, "main header a >> nth=1");
        expect(intersection(pills, wordmark), `${width}px: pills on the wordmark`).toBe(0);
        expect(intersection(pills, exit), `${width}px: pills on "exit"`).toBe(0);
        expect(intersection(wordmark, exit), `${width}px: wordmark on "exit"`).toBe(0);
        // The header only: the step's own button row is not this test's subject.
        const pastEdge = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          return [...document.querySelectorAll("main header *")]
            .filter((el) => el.getBoundingClientRect().right > vw + 0.5)
            .map((el) => (el.textContent ?? "").trim().slice(0, 30) || el.tagName);
        });
        expect(pastEdge, `${width}px: header runs off the right edge`).toEqual([]);
      }
    });
  }
});
