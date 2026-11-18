import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { postJoin } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";
import { boxRect, gridFor } from "../src/lib/layouts/grid";
import type { LayoutItem } from "../src/lib/layouts/types";

/**
 * A kiosk with an assigned layout draws it instead of the built-in blocks;
 * unassigning brings the blocks back without a reload; a kiosk with no layout
 * and no default keeps the built-in screensaver throughout. In a family of its
 * own, removed afterwards. FAMILY_CODE says there is a stack (e2e.yml sets it).
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE and a running stack");
test.describe.configure({ mode: "serial" });

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const P = "claude-saverlayout-";
const SIZE = { width: 1080, height: 1920 };
const ITEMS: LayoutItem[] = [
  { id: "clock", widget: "clock", x: 0, y: 17, w: 6, h: 3, text: "M" },
  { id: "events", widget: "events", x: 0, y: 11, w: 6, h: 5, text: "M" },
];

let famId = "";
let code = "";
let layoutId = "";
let apiA: APIRequestContext;
let deviceA: Record<string, unknown>;
let deviceB: Record<string, unknown>;
let familyJson: Record<string, unknown>;
let apiB: APIRequestContext;

function purge(ids: string[]) {
  for (const id of ids.filter(Boolean)) {
    psql(`DELETE FROM devices WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM layouts WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM settings WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM integration_secrets WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM families WHERE id = ${sqlText(id)}`);
  }
}

async function join(api: APIRequestContext, name: string) {
  const res = await postJoin(api, { joinCode: code, hardwareId: `${P}${name}-${Date.now()}`, deviceName: `${P}${name}` });
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { family: Record<string, unknown>; device: { id: string } & Record<string, unknown> };
  psql(`UPDATE devices SET is_kiosk = true WHERE id = '${body.device.id}'`);
  familyJson = body.family;
  return body.device;
}

/** A browser context that is this device: its session cookies plus the stored client state. */
async function screenFor(browser: Browser, api: APIRequestContext, device: Record<string, unknown>) {
  const ctx: BrowserContext = await browser.newContext({
    viewport: SIZE,
    serviceWorkers: "block",
    reducedMotion: "reduce",
    storageState: await api.storageState(),
  });
  await ctx.addCookies([
    {
      name: "family-calendar-storage",
      value: encodeURIComponent(JSON.stringify({ state: { family: familyJson, device: { ...device, is_kiosk: true } }, version: 0 })),
      url: BASE,
    },
  ]);
  return ctx;
}

const open = async (ctx: BrowserContext): Promise<Page> => {
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const hide = () => {
      const el = document.createElement("style");
      el.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(el);
    };
    if (document.head) hide();
    else document.addEventListener("DOMContentLoaded", hide);
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  return page;
};

test.beforeAll(async () => {
  test.setTimeout(90_000);
  purge(psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`).split(","));
  code = `CS${randomBytes(4).toString("hex").toUpperCase()}`;
  famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);
  psql(`INSERT INTO settings (family_id, key, value) VALUES ('${famId}', 'screensaver', '{"screensaverTimeout":2,"showNews":true,"showForecast":false,"weatherEffects":false}'::jsonb)`);

  apiA = await pwRequest.newContext({ baseURL: BASE });
  apiB = await pwRequest.newContext({ baseURL: BASE });
  deviceA = await join(apiA, "a");
  deviceB = await join(apiB, "b");
  const setPin = await apiA.post("/api/pin", { data: { family_id: famId, action: "set", pin: "4711" } });
  expect(setPin.ok(), await setPin.text()).toBe(true);

  const created = await apiA.post("/api/layouts", { data: { name: `${P}one`, ...SIZE, from: "builtin" } });
  expect(created.status(), await created.text()).toBe(201);
  const { layout } = await created.json();
  layoutId = layout.id;
  const patched = await apiA.patch(`/api/layouts/${layoutId}`, { data: { screensaver: ITEMS, updated_at: layout.updated_at } });
  expect(patched.status(), await patched.text()).toBe(200);
  const assigned = await apiA.put(`/api/devices/${deviceA.id}/layout`, { data: { layout_id: layoutId } });
  expect(assigned.status(), await assigned.text()).toBe(200);
});

test.afterAll(async () => {
  purge([famId]);
  await apiA?.dispose();
  await apiB?.dispose();
  expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM layouts WHERE name LIKE '${P}%'`)).toBe("0");
});

test("an assigned layout is drawn at its boxes, then unassigning restores the built-in blocks live", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await screenFor(browser, apiA, deviceA);
  const page = await open(ctx);
  await page.waitForSelector("[data-layout-item=clock]", { timeout: 45_000 });
  await expect(page.locator("[data-saver-block]")).toHaveCount(0);

  const grid = gridFor(SIZE.width, SIZE.height)!;
  for (const item of ITEMS) {
    const want = boxRect(item, grid);
    const got = await page.locator(`[data-layout-item=${item.widget}]`).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
    for (const k of ["left", "top", "width", "height"] as const) {
      expect(Math.abs(got[k] - want[k]), `${item.widget}.${k}: got ${got[k]}, want ${want[k]}`).toBeLessThanOrEqual(1);
    }
  }

  // The unlock lasts for the session; the route fires the change feed.
  const unlock = await apiA.post("/api/pin", { data: { family_id: famId, action: "verify", pin: "4711" } });
  expect(unlock.ok(), await unlock.text()).toBe(true);
  const un = await apiA.put(`/api/devices/${deviceA.id}/layout`, { data: { layout_id: null } });
  expect(un.status(), await un.text()).toBe(200);
  await page.waitForSelector("[data-saver-block=clock]", { timeout: 15_000 });
  await expect(page.locator("[data-layout-item]")).toHaveCount(0);
  await ctx.close();
});

test("a kiosk with no layout and no default keeps the built-in blocks", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await screenFor(browser, apiB, deviceB);
  const page = await open(ctx);
  await page.waitForSelector("[data-saver-block=clock]", { timeout: 45_000 });
  for (let i = 0; i < 6; i++) {
    await expect(page.locator("[data-layout-item]")).toHaveCount(0);
    await expect(page.locator("[data-saver-block=clock]")).toHaveCount(1);
    await page.waitForTimeout(500);
  }
  await ctx.close();
});
