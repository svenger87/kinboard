import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { postJoin } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";
import { gridFor } from "../src/lib/layouts/grid";
import { collides, validateItems } from "../src/lib/layouts/validate";
import type { LayoutItem } from "../src/lib/layouts/types";

/**
 * The screensaver editor at Settings → Layouts → one layout, driven with the
 * mouse and the keyboard on a 1080x1920 layout made from the built-in one:
 * moves and resizes land on whole cells and are saved, the minimum and the
 * other widgets hold, undo works, a save over someone else's change is
 * refused with the reload message, and the canvas shows the family's real
 * events. In a family of its own, removed afterwards. Needs the stack
 * (FAMILY_CODE) and a dev server (PLAYWRIGHT_BASE_URL).
 */

test.skip(!process.env.FAMILY_CODE || !process.env.PLAYWRIGHT_BASE_URL, "needs FAMILY_CODE, PLAYWRIGHT_BASE_URL and a running stack");
test.describe.configure({ mode: "serial" });

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const P = "claude-layouteditor-";
const SIZE = { width: 1080, height: 1920 };
const GRID = gridFor(SIZE.width, SIZE.height)!;
const PIN = "4711";
const EVENT_TITLES = [`${P}Elternabend`, `${P}Schwimmkurs`];

let famId = "";
let code = "";
let layoutId = "";
let api: APIRequestContext;
let familyJson: Record<string, unknown>;
let deviceJson: Record<string, unknown>;

function purge(ids: string[]) {
  for (const id of ids.filter(Boolean)) {
    const fam = sqlText(id);
    psql(`SET kinboard.hard_delete = 'on'; DELETE FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE family_id = ${fam})`);
    psql(`DELETE FROM calendars WHERE family_id = ${fam}`);
    psql(`DELETE FROM devices WHERE family_id = ${fam}`);
    psql(`DELETE FROM layouts WHERE family_id = ${fam}`);
    psql(`DELETE FROM settings WHERE family_id = ${fam}`);
    psql(`DELETE FROM integration_secrets WHERE family_id = ${fam}`);
    psql(`DELETE FROM families WHERE id = ${fam}`);
  }
}

const saved = (): LayoutItem[] => JSON.parse(psql(`SELECT screensaver::text FROM layouts WHERE id = '${layoutId}'`));
const savedItem = (widget: string) => saved().find((i) => i.widget === widget);

/** The editor, in a browser that is the family's device with the settings unlocked. */
async function openEditor(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
    reducedMotion: "reduce",
    storageState: await api.storageState(),
  });
  await ctx.addCookies([
    {
      name: "family-calendar-storage",
      value: encodeURIComponent(JSON.stringify({ state: { family: familyJson, device: deviceJson }, version: 0 })),
      url: BASE,
    },
  ]);
  const page = await ctx.newPage();
  await page.addInitScript((familyId) => {
    sessionStorage.setItem("kinboard_settings_unlock", JSON.stringify({ familyId, at: Date.now() }));
    const hide = () => {
      const el = document.createElement("style");
      el.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(el);
    };
    if (document.head) hide();
    else document.addEventListener("DOMContentLoaded", hide);
  }, famId);
  await page.goto(`/settings/layouts/${layoutId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("editor-canvas")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-editor-item=clock]")).toBeVisible();
  return page;
}

/** The canvas scale and the screen pixels of one grid step. */
async function step(page: Page): Promise<number> {
  const scale = Number(await page.getByTestId("editor-canvas").getAttribute("data-scale"));
  expect(scale).toBeGreaterThan(0);
  return (GRID.cell + 24) * scale;
}

const boxOf = async (item: Locator) => {
  const [x, y, w, h] = ((await item.getAttribute("data-box")) ?? "").split(",").map(Number);
  return { x, y, w, h };
};

async function dragBy(page: Page, from: Locator, dx: number, dy: number) {
  const b = (await from.boundingBox())!;
  const sx = b.x + b.width / 2;
  const sy = b.y + b.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx, sy + dy, { steps: 15 });
  await page.mouse.up();
}

async function save(page: Page) {
  const button = page.getByTestId("editor-save");
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByTestId("layout-editor")).toHaveAttribute("data-dirty", "false", { timeout: 15_000 });
}

test.beforeAll(async () => {
  test.setTimeout(90_000);
  purge(psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`).split(","));
  code = `CE${randomBytes(4).toString("hex").toUpperCase()}`;
  famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);
  // No screensaver over the editor while the test is idle.
  psql(`INSERT INTO settings (family_id, key, value) VALUES ('${famId}', 'screensaver', '{"screensaverTimeout":0}'::jsonb)`);
  const calendarId = psqlRow(`INSERT INTO calendars (family_id, name) VALUES ('${famId}', '${P}calendar') RETURNING id`);
  const start = new Date(Date.now() + 2 * 3600_000);
  for (const [n, title] of EVENT_TITLES.entries()) {
    const s = new Date(start.getTime() + n * 86_400_000);
    const e = new Date(s.getTime() + 3600_000);
    psql(`INSERT INTO events (calendar_id, title, start_at, end_at) VALUES ('${calendarId}', ${sqlText(title)}, '${s.toISOString()}', '${e.toISOString()}')`);
  }

  api = await pwRequest.newContext({ baseURL: BASE });
  const res = await postJoin(api, { joinCode: code, hardwareId: `${P}desk-${Date.now()}`, deviceName: `${P}desk` });
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { family: Record<string, unknown>; device: { id: string } & Record<string, unknown> };
  familyJson = body.family;
  deviceJson = body.device;
  // A wall screen that reported its size: the picker offers it by name.
  const wallApi = await pwRequest.newContext({ baseURL: BASE });
  const wall = await postJoin(wallApi, { joinCode: code, hardwareId: `${P}wall-${Date.now()}`, deviceName: `${P}wall` });
  expect(wall.ok(), await wall.text()).toBe(true);
  const wallId = ((await wall.json()) as { device: { id: string } }).device.id;
  await wallApi.dispose();
  psql(`UPDATE devices SET screen = '{"viewportWidth":1080,"viewportHeight":1920,"screenWidth":1620,"screenHeight":2880,"pixelRatio":1.5}'::jsonb WHERE id = '${wallId}'`);

  const setPin = await api.post("/api/pin", { data: { family_id: famId, action: "set", pin: PIN } });
  expect(setPin.ok(), await setPin.text()).toBe(true);
  const unlock = await api.post("/api/pin", { data: { family_id: famId, action: "verify", pin: PIN } });
  expect(unlock.ok(), await unlock.text()).toBe(true);

  const created = await api.post("/api/layouts", { data: { name: `${P}Küche`, ...SIZE, from: "builtin" } });
  expect(created.status(), await created.text()).toBe(201);
  layoutId = (await created.json()).layout.id;
});

test.afterAll(async () => {
  purge([famId]);
  await api?.dispose();
  expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM layouts WHERE name LIKE '${P}%'`)).toBe("0");
});

test("the canvas shows the real widgets with the family's events", async ({ browser }) => {
  const page = await openEditor(browser);
  const events = page.locator("[data-editor-item=events]");
  await expect(events).toContainText(EVENT_TITLES[0], { timeout: 30_000 });
  await expect(page.getByTestId("screen-picker")).toBeVisible();
  await page.getByTestId("screen-picker").click();
  await expect(page.getByRole("option", { name: `${P}wall — 1080×1920` })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.context().close();
});

test("dragging the clock two columns right saves x+2", async ({ browser }) => {
  const page = await openEditor(browser);
  const before = savedItem("clock")!;
  const clock = page.locator("[data-editor-item=clock]");
  await dragBy(page, clock, 2 * (await step(page)), 0);
  await expect.poll(async () => (await boxOf(clock)).x).toBe(before.x + 2);
  await save(page);
  expect(savedItem("clock")).toMatchObject({ x: before.x + 2, y: before.y, w: before.w, h: before.h });
  await page.context().close();
});

test("resizing the events below their minimum stops at the minimum", async ({ browser }) => {
  const page = await openEditor(browser);
  const events = page.locator("[data-editor-item=events]");
  const before = await boxOf(events);
  const s = await step(page);
  await dragBy(page, events.locator(".react-resizable-handle"), -6 * s, -6 * s);
  await expect.poll(async () => boxOf(events)).toEqual({ ...before, w: 4, h: 3 });
  await save(page);
  expect(savedItem("events")).toMatchObject({ x: before.x, y: before.y, w: 4, h: 3 });
  await page.context().close();
});

test("a widget dragged onto another is refused: nothing overlaps", async ({ browser }) => {
  const page = await openEditor(browser);
  const weather = page.locator("[data-editor-item=weatherNow]");
  const news = page.locator("[data-editor-item=news]");
  const start = await boxOf(weather);
  const n = (await news.boundingBox())!;
  const w = (await weather.boundingBox())!;
  await dragBy(page, weather, n.x + n.width / 2 - (w.x + w.width / 2), n.y + n.height / 2 - (w.y + w.height / 2));
  const boxes = await page.locator("[data-editor-item]").evaluateAll((els) =>
    els.map((el) => {
      const [x, y, w, h] = (el.getAttribute("data-box") ?? "").split(",").map(Number);
      return { id: el.getAttribute("data-editor-item")!, x, y, w, h };
    }),
  );
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      expect(collides(boxes[a], boxes[b]), `${boxes[a].id} overlaps ${boxes[b].id}`).toBe(false);
    }
  }
  expect(collides(boxes.find((b) => b.id === "weatherNow")!, boxes.find((b) => b.id === "news")!)).toBe(false);
  // It did move: toward the news, as far as the free cells allowed.
  const end = await boxOf(weather);
  expect(end, "the weather did not move at all").not.toEqual(start);
  expect(end.x).toBeLessThan(start.x);
  await save(page);
  const result = validateItems(saved(), SIZE.width, SIZE.height);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  await page.context().close();
});

test("undo puts a moved widget back, redo moves it again; arrows move by a cell", async ({ browser }) => {
  const page = await openEditor(browser);
  const date = page.locator("[data-editor-item=date]");
  const before = await boxOf(date);
  await dragBy(page, date, 2 * (await step(page)), 0);
  await expect.poll(async () => (await boxOf(date)).x).toBe(before.x + 2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => boxOf(date)).toEqual(before);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await boxOf(date)).x).toBe(before.x + 2);
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await boxOf(date)).x).toBe(before.x + 3);
  await page.getByTestId("editor-undo").click();
  await page.getByTestId("editor-undo").click();
  await expect.poll(async () => boxOf(date)).toEqual(before);
  await page.context().close();
});

test("removing a widget returns it to the palette, adding places it on free cells", async ({ browser }) => {
  const page = await openEditor(browser);
  await page.locator("[data-editor-item=news]").click();
  await expect(page.getByTestId("inspector")).toContainText(/News|Nachrichten|Actualités/);
  await page.getByTestId("text-size-L").click();
  await expect(page.locator("[data-editor-item=news]")).toHaveAttribute("data-text", "L");
  await page.keyboard.press("Delete");
  await expect(page.locator("[data-editor-item=news]")).toHaveCount(0);
  await page.getByTestId("palette-add-news").click();
  const news = page.locator("[data-editor-item=news]");
  await expect(news).toHaveCount(1);
  const box = await boxOf(news);
  expect(box.w).toBeGreaterThanOrEqual(4);
  expect(box.h).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId("palette-add-news")).toHaveCount(0);
  await save(page);
  expect(savedItem("news")).toMatchObject(box);
  await page.context().close();
});

test("unsaved changes survive the settings locking again", async ({ browser }) => {
  const page = await openEditor(browser);
  const date = page.locator("[data-editor-item=date]");
  const before = await boxOf(date);
  await date.click();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await boxOf(date)).x).toBe(before.x + 1);
  // What a 403 pin_required does (relockSettings): drop the unlock, tell PinGuard.
  await page.evaluate(() => {
    sessionStorage.removeItem("kinboard_settings_unlock");
    window.dispatchEvent(new Event("kinboard:settings-relock"));
  });
  await expect(page.getByTestId("editor-canvas")).toHaveCount(0);
  await page.locator("input").first().waitFor();
  await page.locator("input").first().focus();
  await page.keyboard.type(PIN);
  await expect(page.getByTestId("editor-canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("editor-draft-notice")).toBeVisible();
  await expect.poll(async () => (await boxOf(page.locator("[data-editor-item=date]"))).x).toBe(before.x + 1);
  await save(page);
  expect(savedItem("date")).toMatchObject({ ...before, x: before.x + 1 });
  await expect(page.getByTestId("editor-draft-notice")).toHaveCount(0);
  await page.context().close();
});

test("a landscape preview adapts the layout without changing it", async ({ browser }) => {
  const page = await openEditor(browser);
  await page.getByTestId("screen-picker").click();
  await page.getByRole("option", { name: /1920×1080/ }).first().click();
  await expect(page.getByTestId("preview-readonly")).toBeVisible();
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-width", "1920");
  expect(psql(`SELECT width || 'x' || height FROM layouts WHERE id = '${layoutId}'`)).toBe("1080x1920");
  await page.context().close();
});

test("saving over someone else's change shows the reload message", async ({ browser }) => {
  const page = await openEditor(browser);
  // Another editor saves first, with the stamp both loaded.
  const current = JSON.parse(psql(`SELECT json_build_object('updated_at', updated_at, 'screensaver', screensaver)::text FROM layouts WHERE id = '${layoutId}'`));
  const theirs = (current.screensaver as LayoutItem[]).map((i) => (i.widget === "weatherNow" ? { ...i, text: "XL" } : i));
  const other = await api.patch(`/api/layouts/${layoutId}`, { data: { screensaver: theirs, updated_at: current.updated_at } });
  expect(other.status(), await other.text()).toBe(200);

  await page.locator("[data-editor-item=date]").click();
  await page.keyboard.press("ArrowRight");
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-stale")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("editor-stale")).toContainText(/reload|neu laden|recharge/i);
  await page.getByTestId("editor-reload").click();
  await expect(page.getByTestId("editor-stale")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("[data-editor-item=weatherNow]")).toHaveAttribute("data-text", "XL");
  await page.context().close();
});
