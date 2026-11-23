import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { postJoin } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";
import { boxRect, gridFor } from "../src/lib/layouts/grid";
import type { HomeLayoutItem, LayoutItem } from "../src/lib/layouts/types";

/**
 * Home with a designed layout (RFC-022 step 5). The layout is written with
 * SQL, as the routes do not take `home` yet; in a family of its own, removed
 * afterwards.
 *
 * Until every Home widget has a component in a box, a designed Home is shut
 * (§7.4). The specs that need one open it with the dev server's test mode
 * (HOME_LAYOUT_TEST_KEY), which a production build ignores, so they skip
 * against one; the specs that hold today's Home unchanged run everywhere.
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE and a running stack");
test.describe.configure({ mode: "serial" });

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
/** Per Playwright project, so the desktop and WebKit runs, side by side, keep to their own family. */
let P = "claude-rfc022-s5-";
const TEST_KEY = "kinboard.test.home-layouts";
/** A landscape panel: at 1024px and over the bar is 72px, so the grid gets 1280x728 (24 rows). */
const SIZE = { width: 1280, height: 800 };
const NAV = 72;
const PHONE = { width: 390, height: 844 };
const ITEMS: HomeLayoutItem[] = [
  { id: "clock", widget: "clock", x: 0, y: 0, w: 24, h: 8, text: "L" },
  { id: "weather", widget: "weather", x: 24, y: 0, w: 24, h: 8, text: "M" },
  { id: "tasks", widget: "tasks", x: 0, y: 8, w: 24, h: 16, text: "M" },
  { id: "shopping", widget: "shopping", x: 24, y: 8, w: 24, h: 16, text: "M" },
];

let famId = "";
let code = "";
let layoutId = "";
let emptyLayoutId = "";
let familyJson: Record<string, unknown>;
const apis: APIRequestContext[] = [];
const devices: Record<string, Record<string, unknown>> = {};

function purge(ids: string[]) {
  for (const id of ids.filter(Boolean)) {
    psql(`DELETE FROM devices WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM layouts WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM settings WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM families WHERE id = ${sqlText(id)}`);
  }
}

/** A device of the family, with its own request context (its session). */
async function join(name: string, kiosk: boolean) {
  const api = await pwRequest.newContext({ baseURL: BASE });
  apis.push(api);
  const res = await postJoin(api, { joinCode: code, hardwareId: `${P}${name}-${Date.now()}`, deviceName: `${P}${name}` });
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { family: Record<string, unknown>; device: { id: string } & Record<string, unknown> };
  psql(`UPDATE devices SET is_kiosk = ${kiosk} WHERE id = '${body.device.id}'`);
  familyJson = body.family;
  devices[name] = { ...body.device, is_kiosk: kiosk, api };
  return body.device;
}

/** A page that is this device, at this size, with the gate's test mode on or off. */
async function open(browser: Browser, name: string, opts: { testMode: boolean; size?: { width: number; height: number }; path?: string }) {
  const { api, ...device } = devices[name] as Record<string, unknown> & { api: APIRequestContext };
  const ctx: BrowserContext = await browser.newContext({
    viewport: opts.size ?? SIZE,
    serviceWorkers: "block",
    reducedMotion: "reduce",
    storageState: await api.storageState(),
  });
  await ctx.addCookies([
    {
      name: "family-calendar-storage",
      value: encodeURIComponent(JSON.stringify({ state: { family: familyJson, device }, version: 0 })),
      url: BASE,
    },
  ]);
  const page = await ctx.newPage();
  await page.addInitScript(
    ([key, on]) => {
      try {
        if (on) localStorage.setItem(key as string, "1");
        else localStorage.removeItem(key as string);
      } catch {}
      const hide = () => {
        const el = document.createElement("style");
        el.textContent = "nextjs-portal{display:none!important}";
        document.head.appendChild(el);
      };
      if (document.head) hide();
      else document.addEventListener("DOMContentLoaded", hide);
    },
    [TEST_KEY, opts.testMode] as const,
  );
  await page.goto(opts.path ?? "/", { waitUntil: "domcontentloaded" });
  return { ctx, page };
}

/** In the test mode, past hydration and the layout queries: whatever Home shows now is the decision. */
async function decided(page: Page) {
  await expect(page.locator("html[data-home-layouts=on]")).toHaveCount(1, { timeout: 45_000 });
  await expect(page.getByTestId("home-layout-wait")).toHaveCount(0, { timeout: 45_000 });
  await page.waitForTimeout(1500);
}

/** Today's Home is up: its clock block, and no designed one. */
async function expectBuiltIn(page: Page) {
  await expect(page.locator('main [data-festival-anchor="clock"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("designed-home")).toHaveCount(0);
  await expect(page.getByTestId("home-layout-wait")).toHaveCount(0);
}

/** The top of every box in the designed grid, in page pixels. */
const boxTops = (page: Page): Promise<Record<string, number>> =>
  page.$$eval("[data-testid=designed-home-grid] [data-layout-id]", (els) =>
    Object.fromEntries(els.map((e) => [e.getAttribute("data-layout-id"), Math.round(e.getBoundingClientRect().top)])),
  );

let devServer = false;

test.beforeAll(async ({}, info) => {
  test.setTimeout(120_000);
  P = `claude-rfc022-s5-${info.project.name}-`;
  purge(psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`).split(","));
  code = `S5${randomBytes(4).toString("hex").toUpperCase()}`;
  famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);
  // No screensaver while a spec looks at Home.
  psql(`INSERT INTO settings (family_id, key, value) VALUES ('${famId}', 'screensaver', '{"screensaverTimeout":60}'::jsonb)`);
  const home = sqlText(JSON.stringify(ITEMS));
  layoutId = psqlRow(
    `INSERT INTO layouts (family_id, name, width, height, grid, home) VALUES ('${famId}', '${P}home', ${SIZE.width}, ${SIZE.height}, 48, ${home}::jsonb) RETURNING id`,
  );
  emptyLayoutId = psqlRow(
    `INSERT INTO layouts (family_id, name, width, height, grid) VALUES ('${famId}', '${P}empty', ${SIZE.width}, ${SIZE.height}, 48) RETURNING id`,
  );
  // kiosk: the layout as its own. laptop: no layout of its own, but the family default is
  // set for its orientation, which counts only on a kiosk (§3.6). bare: a kiosk with a
  // layout whose Home is empty.
  const kiosk = await join("kiosk", true);
  await join("laptop", false);
  const bare = await join("bare", true);
  psql(`UPDATE devices SET layout_id = '${layoutId}' WHERE id = '${kiosk.id}'`);
  psql(`UPDATE devices SET layout_id = '${emptyLayoutId}' WHERE id = '${bare.id}'`);
  psql(
    `INSERT INTO settings (family_id, key, value) VALUES ('${famId}', 'layout_defaults', '{"portrait":null,"landscape":"${layoutId}"}'::jsonb)`,
  );
  // A production build answers its /dev pages 404: the test mode does not exist there.
  const probe = await apis[0].get("/dev/layout-boxes");
  devServer = probe.ok();
});

test.afterAll(async () => {
  purge([famId]);
  for (const api of apis) await api.dispose();
  expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM layouts WHERE name LIKE '${P}%'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM devices WHERE hardware_id LIKE '${P}%'`)).toBe("0");
});

test("with the gate shut, a kiosk with a designed Home still gets today's Home", async ({ browser }) => {
  const { ctx, page } = await open(browser, "kiosk", { testMode: false });
  // The server's HTML is always today's Home: only once the client has
  // decided (hydrated) does "still today's Home" say anything.
  await expect(page.locator("html[data-home-layouts=off]")).toHaveCount(1, { timeout: 45_000 });
  await expectBuiltIn(page);
  // And stays there, past the time a layout would have taken to load.
  await page.waitForTimeout(5000);
  await expectBuiltIn(page);
  await ctx.close();
});

test.describe("in the gate's test mode", () => {
  test.beforeEach(() => test.skip(!devServer, "the gate's test mode exists only on a dev server"));

  test("a kiosk draws its layout: every box where the grid puts it, above the bar, nothing scrolls", async ({ browser }) => {
    const { ctx, page } = await open(browser, "kiosk", { testMode: true });
    await expect(page.getByTestId("designed-home")).toBeVisible({ timeout: 45_000 });
    // Today's Home is not drawn alongside, and the compact switch's clock block is gone.
    await expect(page.locator('main [data-festival-anchor="clock"]')).toHaveCount(0);

    // No component in a box yet: the test mode's placeholder stands in, one per item.
    for (const item of ITEMS) {
      await expect(page.locator(`[data-layout-id=${item.id}] [data-home-widget-missing=${item.widget}]`)).toBeVisible();
    }

    const grid = gridFor(SIZE.width, SIZE.height - NAV)!;
    expect(grid.rows, "the grid is the screen less the bar").toBe(24);
    const boxes = await page.$$eval("[data-testid=designed-home-grid] [data-layout-id]", (els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { id: e.getAttribute("data-layout-id"), left: r.left, top: r.top, width: r.width, height: r.height };
      }),
    );
    expect(boxes).toHaveLength(ITEMS.length);
    for (const b of boxes) {
      const want = boxRect(ITEMS.find((i) => i.id === b.id)! as unknown as LayoutItem, grid);
      expect(Math.abs(b.left - Math.round(want.left)), `${b.id} left`).toBeLessThanOrEqual(1);
      expect(Math.abs(b.top - Math.round(want.top)), `${b.id} top`).toBeLessThanOrEqual(1);
      expect(Math.abs(b.width - Math.round(want.width)), `${b.id} width`).toBeLessThanOrEqual(1);
      expect(Math.abs(b.height - Math.round(want.height)), `${b.id} height`).toBeLessThanOrEqual(1);
    }

    // The lowest box ends above the navigation bar.
    const navTop = await page.evaluate(() => {
      const navs = [...document.querySelectorAll("nav")].filter((n) => getComputedStyle(n).position === "fixed" && n.getBoundingClientRect().height > 0);
      return Math.min(...navs.map((n) => n.getBoundingClientRect().top));
    });
    // The bar's own top sits a pixel into --nav-spacing (its border), as on today's Home.
    expect(Math.abs(navTop - (SIZE.height - NAV))).toBeLessThanOrEqual(1);
    const lowest = Math.max(...boxes.map((b) => b.top + b.height));
    expect(lowest).toBeLessThanOrEqual(navTop);

    // A designed Home never scrolls (§7.1).
    const scroll = await page.evaluate(() => {
      window.scrollTo(0, 10_000);
      const el = document.scrollingElement!;
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollY: window.scrollY };
    });
    expect(scroll.scrollHeight, "page height").toBeLessThanOrEqual(scroll.clientHeight);
    expect(scroll.scrollY).toBe(0);
    await ctx.close();
  });

  test("the notices slide in over the top and the grid does not move", async ({ browser }) => {
    test.setTimeout(120_000);
    /** Home up and settled: the app navigates to the same URL once ~2s after a load. */
    const settled = async (page: Page) => {
      await expect(page.getByTestId("designed-home")).toBeVisible({ timeout: 45_000 });
      await page.waitForTimeout(3000);
      await expect(page.getByTestId("designed-home")).toBeVisible({ timeout: 45_000 });
    };
    const checklist = (page: Page) => page.getByTestId("home-notices-strip").getByText("Finish setting up Kinboard");

    // Setup finished: no checklist. (Another notice may still be up, a slow
    // dev server reads as "server unreachable"; the grid must not care.)
    const quiet = await open(browser, "kiosk", { testMode: true });
    await settled(quiet.page);
    await expect(checklist(quiet.page)).toHaveCount(0);
    const before = await boxTops(quiet.page);
    test.info().annotations.push({ type: "strip before", description: (await quiet.page.getByTestId("home-notices-strip").innerText()) || "(empty)" });
    await quiet.ctx.close();

    // The getting-started checklist comes back while setup is not finished.
    psql(`UPDATE families SET setup_completed = false WHERE id = '${famId}'`);
    try {
      const busy = await open(browser, "kiosk", { testMode: true });
      await settled(busy.page);
      const strip = busy.page.getByTestId("home-notices-strip");
      await expect(checklist(busy.page)).toBeVisible({ timeout: 20_000 });
      await expect(strip).toHaveAttribute("data-shown", "true");
      // Slid all the way in (motion is reduced here, so at once), over the top boxes.
      await expect.poll(async () => (await strip.boundingBox())?.y).toBe(0);
      const s = (await strip.boundingBox())!;
      expect(s.height).toBeGreaterThan(20);
      const after = await boxTops(busy.page);
      expect(after, "every box where it was").toEqual(before);
      expect(s.y + s.height, "the strip lies over the top row").toBeGreaterThan(Math.min(...Object.values(after)));
      const scroll = await busy.page.evaluate(() => document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight);
      expect(scroll, "still nothing to scroll").toBeLessThanOrEqual(0);
      await busy.ctx.close();
    } finally {
      psql(`UPDATE families SET setup_completed = true WHERE id = '${famId}'`);
    }
  });

  test("a quiet Home has an empty strip: nothing over the grid, nothing to tap", async ({ browser }) => {
    const { ctx, page } = await open(browser, "kiosk", { testMode: true });
    await expect(page.getByTestId("designed-home")).toBeVisible({ timeout: 45_000 });
    const strip = page.getByTestId("home-notices-strip");
    // Whatever is up, the strip is exactly as tall as its notices: 0 when it has none.
    await expect
      .poll(async () => {
        const text = (await strip.innerText()).trim();
        const h = (await strip.boundingBox())?.height ?? 0;
        return text === "" ? h === 0 : h > 0;
      }, { timeout: 20_000 })
      .toBe(true);
    await ctx.close();
  });

  test("a phone-wide screen keeps the responsive Home, even with a layout of its own", async ({ browser }) => {
    const { ctx, page } = await open(browser, "kiosk", { testMode: true, size: PHONE });
    await decided(page);
    await expectBuiltIn(page);
    await ctx.close();
  });

  test("a laptop is not given the family default; it keeps today's Home", async ({ browser }) => {
    const { ctx, page } = await open(browser, "laptop", { testMode: true });
    await decided(page);
    await expectBuiltIn(page);
    await ctx.close();
  });

  test("a layout whose Home is empty means today's Home", async ({ browser }) => {
    const { ctx, page } = await open(browser, "bare", { testMode: true });
    await decided(page);
    await expectBuiltIn(page);
    await ctx.close();
  });

  test("Settings → Widgets hides the compact switch on a screen with a designed Home only", async ({ browser }) => {
    const kiosk = await open(browser, "kiosk", { testMode: true, path: "/settings/widgets" });
    await expect(kiosk.page.locator("#compact-home")).toHaveCount(0, { timeout: 45_000 });
    // The rest of the page is there.
    await expect(kiosk.page.locator("[role=switch]").first()).toBeVisible({ timeout: 45_000 });
    await expect(kiosk.page.locator("#compact-home")).toHaveCount(0);
    await kiosk.ctx.close();

    const laptop = await open(browser, "laptop", { testMode: true, path: "/settings/widgets" });
    await expect(laptop.page.locator("html[data-home-layouts=on]")).toHaveCount(1, { timeout: 45_000 });
    await laptop.page.waitForTimeout(1500);
    await expect(laptop.page.locator("#compact-home")).toBeVisible({ timeout: 45_000 });
    await laptop.ctx.close();
  });
});
