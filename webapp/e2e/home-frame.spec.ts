import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";
import { builtInHome } from "../src/lib/layouts/built-in";
import { homeArea } from "../src/lib/layouts/home-area";

/**
 * One frame and one type scale for every Home widget in a box
 * (components/layouts/home-widgets/frame.tsx). The groups of widgets were
 * built side by side, each with a card of its own (titles at 1em, 0.9em and
 * 0.85em, icons and padding to match), so two boxes at the same text size
 * did not look alike, and set-up prompts and empty states had sizes of
 * their own besides.
 */

const DIR = join(__dirname, "../src/components/layouts/home-widgets");
/** A font size set in a class: text-[0.8em], text-[14px], text-sm, text-2xl … (colours like text-primary are not sizes). */
const OWN_SIZE = /\btext-(?:\[(?:length:)?[\d.]+(?:em|px|rem)\]|xs|sm|base|lg|[2-9]?xl)(?![\w-])/g;

test("no Home widget sets a font size of its own: only frame.tsx's roles", () => {
  const found: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))) {
    if (file === "frame.tsx") continue;
    readFileSync(join(DIR, file), "utf8")
      .split("\n")
      .forEach((line, n) => {
        for (const m of line.match(OWN_SIZE) ?? []) found.push(`${file}:${n + 1} ${m}`);
      });
  }
  expect(found).toEqual([]);
});

test("the old per-group frames are gone", () => {
  const src = readdirSync(DIR).map((f) => readFileSync(join(DIR, f), "utf8")).join("\n");
  for (const name of ["HomeCardFrame", "HomeListFrame", "BoxCard", "BoxHeader", "SetUpBox", "boxPadding"]) {
    expect(src.includes(name), name).toBe(false);
  }
});

/**
 * Drawn: a 1080x1920 kiosk Home saved under the old step minimums (14
 * boxes, text S, M and L), the shape of a real kitchen's, and the built-in
 * Home redrawn as a layout on seven screens of every shape. On each: every
 * box's title at the same text size has the same computed font size, every
 * title icon, its badge and its inset from the box's edge (the card's
 * padding) the same; and no text on screen is smaller than the meta role at
 * its box's text size (a line too big for its box is left out, never shrunk
 * below that). Needs a dev server (PLAYWRIGHT_BASE_URL) and a throwaway
 * family's join code (HOME_LISTS_CODE).
 */
const CODE = process.env.HOME_LISTS_CODE;
const BASE = process.env.PLAYWRIGHT_BASE_URL;
const SAVED = readFileSync(join(__dirname, "fixtures/home-portrait-step-minimums.json"), "utf8");
const SCREENS: [number, number][] = [[1080, 1920], [720, 1280], [800, 1280], [1024, 768], [1280, 800], [1920, 1080], [2560, 1080]];
const CASES: { name: string; width: number; height: number; home: () => string }[] = [
  { name: "saved-1080x1920", width: 1080, height: 1920, home: () => SAVED },
  ...SCREENS.map(([width, height]) => ({
    name: `built-in-${width}x${height}`,
    width,
    height,
    home: () => {
      const a = homeArea(width, height);
      return JSON.stringify(builtInHome(a.width, a.height));
    },
  })),
];

// At file level, not inside the test: the `browser` fixture launches a
// browser before a test body runs, so a skip in the body still fails on a
// runner without one (CI's stack-free Specs job).
test.skip(!BASE || !CODE, "needs PLAYWRIGHT_BASE_URL and HOME_LISTS_CODE");

for (const c of CASES) {
  test(`${c.name}: one type scale, one frame, no text below the meta size`, async ({ browser, browserName }) => {
    test.setTimeout(240_000);
    const fam = psqlRow(`SELECT id FROM families WHERE join_code = ${sqlText(CODE!)}`);
    const hw = `claude-rfc022-pf-frame-${browserName}-${Date.now()}`;
    const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, serviceWorkers: "block", reducedMotion: "reduce" });
    const joined = await (await ctx.request.post(`${BASE}/api/session/join`, { data: { joinCode: CODE, deviceName: hw, hardwareId: hw } })).json();
    const layout = psqlRow(
      `INSERT INTO layouts (family_id, name, width, height, grid, home) VALUES ('${fam}', '${hw}', ${c.width}, ${c.height}, 48, ${sqlText(c.home())}::jsonb) RETURNING id`,
    );
    try {
      psql(`UPDATE devices SET is_kiosk = true, layout_id = '${layout}' WHERE id = '${joined.device.id}'`);
      const device = { ...joined.device, is_kiosk: true, layout_id: layout };
      await ctx.addCookies([
        { name: "family-calendar-storage", value: encodeURIComponent(JSON.stringify({ state: { family: joined.family, device }, version: 0 })), url: BASE! },
        { name: "NEXT_LOCALE", value: "de", url: BASE! },
      ]);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("designed-home")).toBeVisible({ timeout: 120_000 });
      await page.waitForTimeout(8000);
      const boxes = await page.$$eval("[data-testid=designed-home-grid] [data-layout-id]", (els) =>
        els.map((box) => {
          const size = (el: Element | null | undefined) => (el ? Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10 : null);
          // A card's title: its title row's display text, or a set-up prompt's first line.
          const title = box.querySelector(".font-display.font-semibold") ?? box.querySelector("[data-testid=box-set-up] .flex-col > span:first-child");
          const icon = title?.closest("header, a, button, div")?.querySelector("svg") ?? null;
          const badge = icon?.parentElement ?? null;
          const r = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
          const round = (n: number | undefined) => (n === undefined ? null : Math.round(n * 10) / 10);
          // Every text on screen in this box, with its computed size.
          const small: string[] = [];
          const boxPx = parseFloat(getComputedStyle(box).fontSize);
          const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const el = n.parentElement;
            if (!el || !(n.textContent ?? "").trim() || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
            // An avatar's initial is part of a picture (role="img", named by its label), not a line of text.
            if (el.closest("[role=img]")) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const px = parseFloat(getComputedStyle(el).fontSize);
            if (px < boxPx * 0.72 - 0.5) small.push(`"${(n.textContent ?? "").trim().slice(0, 20)}" ${px.toFixed(1)}px`);
          }
          return {
            id: box.getAttribute("data-layout-id"),
            box: size(box),
            title: size(title),
            icon: round(r(icon)?.width),
            // The icon's badge (icon and its padding) and how far it sits in from the box's edge (the card's padding).
            badge: round(r(badge)?.width),
            inset: round(r(badge) && r(box) ? r(badge)!.left - r(box)!.left : undefined),
            small,
          };
        }),
      );
      const cards = boxes.filter((b) => b.title !== null);
      console.log(browserName, c.name, JSON.stringify(cards.map(({ small: _s, ...rest }) => rest)));
      expect(cards.length).toBeGreaterThanOrEqual(3);
      const byBox = new Map<number, typeof cards>();
      for (const card of cards) byBox.set(card.box!, [...(byBox.get(card.box!) ?? []), card]);
      const odd: string[] = [];
      for (const [px, group] of byBox) {
        for (const key of ["title", "icon", "badge", "inset"] as const) {
          // Within a pixel: boxes are drawn at whole pixels.
          const vals = group.map((g) => g[key] ?? -99);
          if (Math.max(...vals) - Math.min(...vals) > 1) odd.push(`text ${px}px: ${key} ${group.map((g) => `${g.id} ${g[key]}`).join(", ")}`);
        }
      }
      for (const b of boxes) for (const t of b.small) odd.push(`${b.id} (text ${b.box}px): ${t} is below the meta size`);
      expect(odd).toEqual([]);
    } finally {
      psql(`DELETE FROM devices WHERE id = '${joined.device.id}'`);
      psql(`DELETE FROM layouts WHERE id = '${layout}'`);
      await ctx.close();
    }
  });
}
