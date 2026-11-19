import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { postJoin } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";
import { gridFor } from "../src/lib/layouts/grid";
import { collides, validateItems } from "../src/lib/layouts/validate";
import type { LayoutItem } from "../src/lib/layouts/types";

/**
 * The screensaver editor at Settings → Layouts → one layout, driven with the
 * mouse and the keyboard on a 1080x1920 layout made from the built-in one:
 * moves and resizes land on whole steps (a quarter cell) and are saved, the minimum and the
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
/** The widget names the (English) editor shows. */
const EN_NAMES: Record<string, string> = JSON.parse(readFileSync(join(__dirname, "..", "messages", "en.json"), "utf8")).settings.layouts.editor.widgets;
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

/**
 * The editor, in a browser that is the family's device with the settings
 * unlocked. `session` is put in the tab's sessionStorage before the page
 * loads; with `canvas: false` the page is returned without waiting for the canvas.
 */
async function openEditor(
  browser: Browser,
  id = layoutId,
  { session = {}, canvas = true }: { session?: Record<string, string>; canvas?: boolean } = {},
): Promise<Page> {
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
  await page.addInitScript(({ familyId, session }) => {
    sessionStorage.setItem("kinboard_settings_unlock", JSON.stringify({ familyId, at: Date.now() }));
    for (const [k, v] of Object.entries(session)) sessionStorage.setItem(k, v);
    const hide = () => {
      const el = document.createElement("style");
      el.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(el);
    };
    if (document.head) hide();
    else document.addEventListener("DOMContentLoaded", hide);
  }, { familyId: famId, session });
  await page.goto(`/settings/layouts/${id}`, { waitUntil: "domcontentloaded" });
  if (!canvas) return page;
  await expect(page.getByTestId("editor-canvas")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-editor-item=clock]")).toBeVisible();
  return page;
}

/** The canvas scale and the screen pixels of one grid step. */
async function step(page: Page): Promise<number> {
  const scale = Number(await page.getByTestId("editor-canvas").getAttribute("data-scale"));
  expect(scale).toBeGreaterThan(0);
  return GRID.step * scale;
}

/** Where an item's box is drawn, in the screen's own (unscaled) pixels from the canvas's top left. */
async function drawnBox(page: Page, item: Locator) {
  const canvas = page.getByTestId("editor-canvas");
  const scale = Number(await canvas.getAttribute("data-scale"));
  const c = (await canvas.boundingBox())!;
  const b = (await item.locator("[data-editor-box]").boundingBox())!;
  return { left: (b.x - c.x) / scale, top: (b.y - c.y) / scale, width: b.width / scale, height: b.height / scale };
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

  const created = await api.post("/api/layouts", { data: { grid: 48, name: `${P}Küche`, ...SIZE, from: "builtin" } });
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

test("dragging the clock two steps right saves x+2", async ({ browser }) => {
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
  await dragBy(page, events.locator(".react-resizable-handle"), -40 * s, -40 * s);
  // The events' minimum: 4x3 cells, 16x12 steps.
  await expect.poll(async () => boxOf(events)).toEqual({ ...before, w: 16, h: 12 });
  await save(page);
  expect(savedItem("events")).toMatchObject({ x: before.x, y: before.y, w: 16, h: 12 });
  await page.context().close();
});

test("a widget dragged onto another is refused: nothing overlaps", async ({ browser }) => {
  const page = await openEditor(browser);
  const weather = page.locator("[data-editor-item=weatherNow]");
  const news = page.locator("[data-editor-item=news]");
  const start = await boxOf(weather);
  const n = (await news.boundingBox())!;
  const w = (await weather.boundingBox())!;
  // Straight across onto the news beside it: on a diagonal, every step on the
  // way would already sit on the forecast below, and nothing would move.
  await dragBy(page, weather, n.x + n.width / 2 - (w.x + w.width / 2), 0);
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

test("a drag of one step moves a box one step, drawn where the grid puts it", async ({ browser }) => {
  const page = await openEditor(browser);
  const date = page.locator("[data-editor-item=date]");
  const before = await boxOf(date);
  await dragBy(page, date, await step(page), 0);
  await expect.poll(async () => (await boxOf(date)).x).toBe(before.x + 1);
  const box = await boxOf(date);
  const drawn = await drawnBox(page, date);
  expect(Math.abs(drawn.left - (GRID.offsetX + box.x * GRID.step)), JSON.stringify(drawn)).toBeLessThanOrEqual(1);
  expect(Math.abs(drawn.top - (GRID.offsetY + box.y * GRID.step)), JSON.stringify(drawn)).toBeLessThanOrEqual(1);
  expect(Math.abs(drawn.width - (box.w * GRID.step - 24)), JSON.stringify(drawn)).toBeLessThanOrEqual(1);
  expect(Math.abs(drawn.height - (box.h * GRID.step - 24)), JSON.stringify(drawn)).toBeLessThanOrEqual(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => boxOf(date)).toEqual(before);
  await page.context().close();
});

test("the grid shows as dots, lines or not at all, remembered after a reload", async ({ browser }) => {
  const page = await openEditor(browser);
  const overlay = page.getByTestId("editor-grid-overlay");
  const select = page.getByTestId("editor-grid-display");
  await expect(overlay).toHaveAttribute("data-display", "dots");
  // A portrait 1080x1920 layout in this window has steps of about 7px: dots still show.
  await expect(overlay).toHaveAttribute("data-dots", "true");
  // Drawn once, as patterns: a handful of elements, not one per step or cell
  // (this grid has 48 x 88 steps).
  expect(GRID.rows * GRID.columns).toBeGreaterThan(1000);
  expect(await overlay.locator("*").count()).toBeLessThanOrEqual(10);
  for (const display of ["lines", "off"]) {
    await select.click();
    await page.getByTestId(`editor-grid-display-${display}`).click();
    await expect(overlay).toHaveAttribute("data-display", display);
  }
  await page.reload();
  await expect(page.getByTestId("editor-canvas")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("editor-grid-overlay")).toHaveAttribute("data-display", "off");
  await page.getByTestId("editor-grid-display").click();
  await page.getByTestId("editor-grid-display-dots").click();
  await expect(page.getByTestId("editor-grid-overlay")).toHaveAttribute("data-display", "dots");
  await page.context().close();
});

test("undo puts a moved widget back, redo moves it again; arrows move by a step", async ({ browser }) => {
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

/** The editor back on the built-in arrangement (one undoable change), whatever earlier tests left. */
async function resetToBuiltIn(page: Page) {
  await page.getByTestId("editor-reset").click();
  await page.getByTestId("editor-reset-confirm").click();
  await expect.poll(async () => boxOf(page.locator("[data-editor-item=date]"))).toEqual({ x: 0, y: 84, w: 24, h: 4 });
}

/** A screen point on the canvas, given in steps of the layout's grid. */
async function canvasPoint(page: Page, x: number, y: number) {
  const c = (await page.getByTestId("editor-canvas").boundingBox())!;
  const s = await step(page);
  const scale = s / GRID.step;
  return { x: c.x + (GRID.offsetX + x * GRID.step) * scale, y: c.y + (GRID.offsetY + y * GRID.step) * scale };
}

test("Shift+click selects a second box, a frame on empty canvas selects the boxes it touches, Escape clears", async ({ browser }) => {
  const page = await openEditor(browser);
  await resetToBuiltIn(page);
  const clock = page.locator("[data-editor-item=clock]");
  const date = page.locator("[data-editor-item=date]");
  const selected = page.locator("[data-editor-item][data-selected=true]");
  await clock.locator("[data-editor-box]").click();
  await expect(selected).toHaveCount(1);
  await date.locator("[data-editor-box]").click({ modifiers: ["Shift"] });
  await expect(clock).toHaveAttribute("data-selected", "true");
  await expect(date).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("inspector-selection")).toBeVisible();
  // Shift+click again takes it out.
  await date.locator("[data-editor-box]").click({ modifiers: ["Shift"] });
  await expect(date).toHaveAttribute("data-selected", "false");
  await expect(clock).toHaveAttribute("data-selected", "true");
  // A plain click picks just that box.
  await date.locator("[data-editor-box]").click();
  await expect(selected).toHaveCount(1);
  await expect(date).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("Escape");
  await expect(selected).toHaveCount(0);

  // A frame from the empty right half across the clock (rows 72-84) and the date (84-88), not the birthdays above.
  const from = await canvasPoint(page, 40, 86);
  const to = await canvasPoint(page, 10, 78);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await expect(page.getByTestId("editor-frame")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId("editor-frame")).toHaveCount(0);
  await expect(selected).toHaveCount(2);
  await expect(clock).toHaveAttribute("data-selected", "true");
  await expect(date).toHaveAttribute("data-selected", "true");
  // Nothing moved.
  expect(await boxOf(clock)).toEqual({ x: 0, y: 72, w: 24, h: 12 });
  // A click on empty canvas clears the selection.
  const empty = await canvasPoint(page, 40, 40);
  await page.mouse.click(empty.x, empty.y);
  await expect(selected).toHaveCount(0);
  await page.context().close();
});

test("arrows move every selected box, Shift by a cell; Alt resizes; Delete removes both and one undo restores them", async ({ browser }) => {
  const page = await openEditor(browser);
  await resetToBuiltIn(page);
  const clock = page.locator("[data-editor-item=clock]");
  const date = page.locator("[data-editor-item=date]");
  await clock.locator("[data-editor-box]").click();
  await date.locator("[data-editor-box]").click({ modifiers: ["Shift"] });
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await boxOf(clock)).x).toBe(1);
  await expect.poll(async () => (await boxOf(date)).x).toBe(1);
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => (await boxOf(clock)).x).toBe(5);
  await expect.poll(async () => (await boxOf(date)).x).toBe(5);
  // Down would take the date off the screen: refused for both, and said why.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("editor-refused")).toBeVisible();
  expect(await boxOf(clock)).toEqual({ x: 5, y: 72, w: 24, h: 12 });
  expect(await boxOf(date)).toEqual({ x: 5, y: 84, w: 24, h: 4 });
  // The next change that works clears the message.
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await boxOf(clock)).x).toBe(4);
  await expect(page.getByTestId("editor-refused")).toHaveCount(0);

  // Alt resizes the one selected box: right grows by a step, with Shift by a cell.
  await clock.locator("[data-editor-box]").click();
  await expect(page.locator("[data-editor-item][data-selected=true]")).toHaveCount(1);
  await page.keyboard.press("Alt+ArrowRight");
  await expect.poll(async () => boxOf(clock)).toEqual({ x: 4, y: 72, w: 25, h: 12 });
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await expect.poll(async () => boxOf(clock)).toEqual({ x: 4, y: 72, w: 29, h: 12 });
  await page.keyboard.press("Alt+ArrowLeft");
  await expect.poll(async () => boxOf(clock)).toEqual({ x: 4, y: 72, w: 28, h: 12 });

  // Delete removes both; one undo brings both back.
  await date.locator("[data-editor-box]").click({ modifiers: ["Shift"] });
  await page.keyboard.press("Delete");
  await expect(clock).toHaveCount(0);
  await expect(date).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(clock).toHaveCount(1);
  await expect(date).toHaveCount(1);
  expect(await boxOf(clock)).toEqual({ x: 4, y: 72, w: 28, h: 12 });
  expect(await boxOf(date)).toEqual({ x: 4, y: 84, w: 24, h: 4 });
  await page.context().close();
});

/** The saved arrangement replaced (as another editor would), returning a function that puts the old one back. */
async function seedLayout(items: LayoutItem[]): Promise<() => Promise<void>> {
  const stampNow = () => JSON.parse(psql(`SELECT json_build_object('updated_at', updated_at, 'screensaver', screensaver)::text FROM layouts WHERE id = '${layoutId}'`));
  const before = stampNow();
  const res = await api.patch(`/api/layouts/${layoutId}`, { data: { grid: 48, screensaver: items, updated_at: before.updated_at } });
  expect(res.status(), await res.text()).toBe(200);
  return async () => {
    const back = await api.patch(`/api/layouts/${layoutId}`, { data: { grid: 48, screensaver: before.screensaver, updated_at: stampNow().updated_at } });
    expect(back.status(), await back.text()).toBe(200);
  };
}

test("align top lines three boxes up in one change, one undo puts all three back; a refused align says why", async ({ browser }) => {
  // Boxes big enough on the scaled canvas that a click on their middle is not on the resize corner.
  const restore = await seedLayout([
    { id: "clock", widget: "clock", x: 0, y: 20, w: 16, h: 8, text: "M" },
    { id: "date", widget: "date", x: 18, y: 10, w: 12, h: 4, text: "M" },
    { id: "weatherNow", widget: "weatherNow", x: 32, y: 30, w: 16, h: 8, text: "M" },
  ]);
  try {
    const page = await openEditor(browser);
    const clock = page.locator("[data-editor-item=clock]");
    const date = page.locator("[data-editor-item=date]");
    const weather = page.locator("[data-editor-item=weatherNow]");
    // One box: no arrange section.
    await clock.locator("[data-editor-box]").click();
    await expect(page.getByTestId("inspector-arrange")).toHaveCount(0);
    await date.locator("[data-editor-box]").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("inspector-arrange")).toBeVisible();
    // Two boxes leave nothing to spread.
    await expect(page.getByTestId("distribute-x")).toBeDisabled();
    await weather.locator("[data-editor-box]").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("distribute-x")).toBeEnabled();
    await expect(page.getByTestId("arrange-top")).toHaveAttribute("aria-label", /.+/);

    await page.getByTestId("arrange-top").click();
    await expect.poll(async () => [await boxOf(clock), await boxOf(date), await boxOf(weather)]).toEqual([
      { x: 0, y: 10, w: 16, h: 8 },
      { x: 18, y: 10, w: 12, h: 4 },
      { x: 32, y: 10, w: 16, h: 8 },
    ]);
    // Left would put the date on the clock: refused, nothing moves.
    await page.getByTestId("arrange-left").click();
    await expect(page.getByTestId("editor-refused")).toHaveAttribute("data-reason", "overlap");
    expect((await boxOf(date)).x).toBe(18);
    await page.getByTestId("editor-undo").click();
    await expect.poll(async () => [await boxOf(clock), await boxOf(date), await boxOf(weather)]).toEqual([
      { x: 0, y: 20, w: 16, h: 8 },
      { x: 18, y: 10, w: 12, h: 4 },
      { x: 32, y: 30, w: 16, h: 8 },
    ]);
    await expect(page.getByTestId("editor-undo")).toBeDisabled();
    await page.context().close();
  } finally {
    await restore();
  }
});

test("Shift+dragging a selected box moves it and keeps the selection; undo clears the refusal line, which sits in a live status", async ({ browser }) => {
  const page = await openEditor(browser);
  await resetToBuiltIn(page);
  const clock = page.locator("[data-editor-item=clock]");
  const date = page.locator("[data-editor-item=date]");
  const status = page.getByTestId("editor-refused-status");
  // Mounted before anything is refused, so screen readers announce what comes into it.
  await expect(status).toHaveAttribute("role", "status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  // Empty, it is out of sight but still in the accessibility tree: never display none, or the text would arrive with the region and go unannounced.
  expect(await status.evaluate((el) => getComputedStyle(el).display)).not.toBe("none");
  expect(await status.evaluate((el) => el.childElementCount)).toBe(0);
  await clock.locator("[data-editor-box]").click();
  await date.locator("[data-editor-box]").click({ modifiers: ["Shift"] });
  await page.keyboard.down("Shift");
  await dragBy(page, date.locator("[data-editor-box]"), 2 * (await step(page)), 0);
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await boxOf(date)).x).toBe(2);
  await expect(date).toHaveAttribute("data-selected", "true");
  await expect(clock).toHaveAttribute("data-selected", "true");
  // Down takes the date off the screen: refused, said in the status.
  await page.keyboard.press("ArrowDown");
  await expect(status.getByTestId("editor-refused")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await boxOf(date)).x).toBe(0);
  await expect(page.getByTestId("editor-refused")).toHaveCount(0, { timeout: 1500 });
  await page.context().close();
});

test("a frame is dropped when the window loses focus; pressing the resize corner never starts one", async ({ browser }) => {
  const page = await openEditor(browser);
  await resetToBuiltIn(page);
  const clock = page.locator("[data-editor-item=clock]");
  const selected = page.locator("[data-editor-item][data-selected=true]");
  await clock.locator("[data-editor-box]").click();
  const from = await canvasPoint(page, 40, 86);
  const to = await canvasPoint(page, 10, 78);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await expect(page.getByTestId("editor-frame")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByTestId("editor-frame")).toHaveCount(0);
  await page.mouse.up();
  // The mouseup after the blur selects nothing new.
  await expect(selected).toHaveCount(1);
  await expect(clock).toHaveAttribute("data-selected", "true");

  // The clock's resize corner, pressed and dragged: a resize, never a frame.
  const handle = clock.locator(".react-resizable-handle");
  await expect(handle).toBeVisible();
  const h = (await handle.boundingBox())!;
  const s = await step(page);
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 2 * s, h.y + h.height / 2 - s, { steps: 10 });
  await expect(page.getByTestId("editor-frame")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByTestId("editor-frame")).toHaveCount(0);
  await expect(selected).toHaveCount(1);
  await expect(clock).toHaveAttribute("data-selected", "true");
  await expect.poll(async () => (await boxOf(clock)).w).toBe(26);
  await page.context().close();
});

test("typing 12 into X and Enter moves the box; 47 for a box 8 wide is refused, said under the fields, and the old x stays", async ({ browser }) => {
  const page = await openEditor(browser);
  await resetToBuiltIn(page);
  const clock = page.locator("[data-editor-item=clock]");
  const weather = page.locator("[data-editor-item=weatherNow]");
  const fx = page.getByTestId("inspector-x");
  // Several selected: no fields.
  await clock.locator("[data-editor-box]").click();
  await weather.locator("[data-editor-box]").click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("inspector-selection")).toBeVisible();
  await expect(fx).toHaveCount(0);

  await clock.locator("[data-editor-box]").click();
  await expect(fx).toHaveValue("0");
  await expect(page.getByTestId("inspector-y")).toHaveValue("72");
  await expect(page.getByTestId("inspector-w")).toHaveValue("24");
  await expect(page.getByTestId("inspector-h")).toHaveValue("12");
  // The minimum is still shown, in steps.
  await expect(page.getByTestId("inspector-min")).toContainText("16×8");
  await fx.fill("12");
  await fx.press("Enter");
  await expect.poll(async () => boxOf(clock)).toEqual({ x: 12, y: 72, w: 24, h: 12 });
  await expect(fx).toHaveValue("12");
  // The arrow keys in a field belong to the field: the box stays.
  await fx.press("ArrowLeft");
  await fx.press("ArrowRight");
  await fx.press("Shift+ArrowLeft");
  expect(await boxOf(clock)).toEqual({ x: 12, y: 72, w: 24, h: 12 });
  // A drag shows up in the fields.
  await dragBy(page, clock.locator("[data-editor-box]"), 2 * (await step(page)), 0);
  await expect.poll(async () => (await boxOf(clock)).x).toBe(14);
  await expect(fx).toHaveValue("14");

  // The weather made 8 wide (applied on leaving the field), then x 47 would leave the screen.
  await weather.locator("[data-editor-box]").click();
  const fw = page.getByTestId("inspector-w");
  await expect(fx).toHaveValue("28");
  await fw.fill("8");
  await fx.focus();
  await expect.poll(async () => boxOf(weather)).toEqual({ x: 28, y: 0, w: 8, h: 4 });
  await fx.fill("47");
  await fx.press("Enter");
  await expect(fx).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("inspector-box-error")).toHaveAttribute("data-reason", "out_of_bounds");
  await expect(page.getByTestId("inspector-box-error")).not.toBeEmpty();
  await expect(fx).toHaveValue("28");
  expect(await boxOf(weather)).toEqual({ x: 28, y: 0, w: 8, h: 4 });
  // Below the minimum, said for that field.
  await fw.fill("4");
  await fw.press("Enter");
  await expect(fw).toHaveAttribute("aria-invalid", "true");
  await expect(fx).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("inspector-box-error")).toHaveAttribute("data-reason", "below_minimum");
  await expect(fw).toHaveValue("8");
  // A value that fits clears the message.
  await fx.fill("40");
  await fx.press("Enter");
  await expect.poll(async () => boxOf(weather)).toEqual({ x: 40, y: 0, w: 8, h: 4 });
  await expect(page.getByTestId("inspector-box-error")).toHaveCount(0);
  await expect(fw).not.toHaveAttribute("aria-invalid", "true");
  // Each applied field is one change.
  await page.getByTestId("editor-undo").click();
  await expect.poll(async () => boxOf(weather)).toEqual({ x: 28, y: 0, w: 8, h: 4 });
  await expect(fx).toHaveValue("28");
  await page.getByTestId("editor-undo").click();
  await expect.poll(async () => boxOf(weather)).toEqual({ x: 28, y: 0, w: 20, h: 4 });
  await page.context().close();
});

test("the resize corner leaves a small box room to be grabbed: a 4x4 and a 16x8 box move when dragged by their centre", async ({ browser }) => {
  const restore = await seedLayout([
    { id: "clock", widget: "clock", x: 0, y: 20, w: 16, h: 8, text: "M" },
    { id: "photoCount", widget: "photoCount", x: 24, y: 40, w: 4, h: 4, text: "M" },
  ]);
  try {
    const page = await openEditor(browser);
    const s = await step(page);
    for (const [id, start] of [
      ["photoCount", { x: 24, y: 40, w: 4, h: 4 }],
      ["clock", { x: 0, y: 20, w: 16, h: 8 }],
    ] as const) {
      const item = page.locator(`[data-editor-item=${id}]`);
      const drawn = (await item.locator("[data-editor-box]").boundingBox())!;
      await item.locator("[data-editor-box]").click();
      const handle = (await item.locator(".react-resizable-handle").boundingBox())!;
      // A third of the shorter side, at most 22px; at least 6px but never 40% of the side, which would reach the middle.
      const side = Math.min(drawn.width, drawn.height);
      expect(handle.width).toBeLessThanOrEqual(Math.min(22, Math.max(6, side / 3), side * 0.4) + 0.5);
      expect(handle.width).toBeGreaterThanOrEqual(Math.min(6, side * 0.4) - 0.5);
      // What is under the box's middle is the box, not its corner.
      const under = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest("[data-editor-box]") && !document.elementFromPoint(x, y)?.closest(".react-resizable-handle"), { x: drawn.x + drawn.width / 2, y: drawn.y + drawn.height / 2 });
      expect(under).toBe(true);
      await dragBy(page, item.locator("[data-editor-box]"), 2 * s, 0);
      await expect.poll(async () => boxOf(item)).toEqual({ ...start, x: start.x + 2 });
    }
    // The small box's corner still resizes it.
    const small = page.locator("[data-editor-item=photoCount]");
    const h = (await small.locator(".react-resizable-handle").boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + 2 * s, h.y + h.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => boxOf(small)).toEqual({ x: 26, y: 40, w: 6, h: 4 });
    await page.context().close();
  } finally {
    await restore();
  }
});

test("a value widget's text size: S draws the clock smaller in its box, L and XL are off since M already fills it", async ({ browser }) => {
  const page = await openEditor(browser);
  const clock = page.locator("[data-editor-item=clock]");
  const digits = clock.locator(".clock-display").first();
  const px = () => digits.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await clock.click();
  await expect(page.getByTestId("inspector-fills-box")).toBeVisible();
  await expect(page.getByTestId("text-size-L")).toBeDisabled();
  await expect(page.getByTestId("text-size-XL")).toBeDisabled();
  await expect.poll(px).toBeGreaterThan(0);
  const full = await px();
  await page.getByTestId("text-size-S").click();
  await expect(clock).toHaveAttribute("data-text", "S");
  await expect.poll(async () => (await px()) / full).toBeLessThan(0.85);
  expect((await px()) / full).toBeGreaterThan(0.7);
  // A list widget keeps all four.
  await page.locator("[data-editor-item=news]").click();
  await expect(page.getByTestId("text-size-XL")).toBeEnabled();
  await expect(page.getByTestId("inspector-fills-box")).toHaveCount(0);
  await page.context().close();
});

test("a value widget sits at the edge it touches, and the inspector sets it otherwise", async ({ browser }) => {
  const page = await openEditor(browser);
  const clock = page.locator("[data-editor-item=clock]");
  // The built-in arrangement has the clock in the left column: left.
  await expect(clock.locator("[data-align]")).toHaveAttribute("data-align", "start");
  await clock.click();
  await expect(page.getByTestId("inspector-align-auto")).toBeVisible();
  await page.getByTestId("align-end").click();
  await expect(clock.locator("[data-align]")).toHaveAttribute("data-align", "end");
  await expect(page.getByTestId("inspector-align-auto")).toHaveCount(0);
  await save(page);
  expect(savedItem("clock")?.options).toMatchObject({ align: "end" });
  await page.getByTestId("align-auto").click();
  await expect(clock.locator("[data-align]")).toHaveAttribute("data-align", "start");
  await save(page);
  expect(savedItem("clock")?.options?.align).toBeUndefined();
  // A list has no alignment to set.
  await page.locator("[data-editor-item=events]").click();
  await expect(page.getByTestId("align-auto")).toHaveCount(0);
  await page.context().close();
});

test("next event says in the designer what it shows, when nothing is due within the hour", async ({ browser }) => {
  const page = await openEditor(browser);
  await page.getByTestId("palette-add-nextEvent").click();
  const box = page.locator("[data-editor-item=nextEvent]");
  await expect(box).toHaveCount(1);
  await expect(box.getByTestId("saver-widget-not-set-up")).toBeVisible();
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
  expect(box.w).toBeGreaterThanOrEqual(16);
  expect(box.h).toBeGreaterThanOrEqual(12);
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

test("a draft left by the editor from before the steps (counted in cells) is not restored", async ({ browser }) => {
  const res = await api.get("/api/layouts");
  expect(res.ok(), await res.text()).toBe(true);
  const layout = ((await res.json()) as { layouts: { id: string; updated_at: string; screensaver: LayoutItem[] }[] }).layouts.find((l) => l.id === layoutId)!;
  // What the 12-column editor kept: its key, the same stamp (087 keeps updated_at), positions in cells.
  const cells = layout.screensaver.map((i) => ({ ...i, x: Math.floor(i.x / 4), y: Math.floor(i.y / 4), w: Math.max(1, Math.floor(i.w / 4)), h: Math.max(1, Math.floor(i.h / 4)) }));
  const page = await openEditor(browser, layoutId, {
    session: { [`kinboard_layout_draft:${layoutId}`]: JSON.stringify({ items: cells, stamp: layout.updated_at }) },
  });
  await expect(page.getByTestId("layout-editor")).toHaveAttribute("data-dirty", "false");
  await expect(page.getByTestId("editor-draft-notice")).toHaveCount(0);
  const clock = layout.screensaver.find((i) => i.widget === "clock")!;
  expect(await boxOf(page.locator("[data-editor-item=clock]"))).toEqual({ x: clock.x, y: clock.y, w: clock.w, h: clock.h });
  await page.context().close();
});

test("a layout still on the 12-column grid is not edited: the page asks to reload", async ({ browser }) => {
  const created = await api.post("/api/layouts", { data: { grid: 48, name: `${P}Alt`, ...SIZE, from: "builtin" } });
  expect(created.status(), await created.text()).toBe(201);
  const oldId = (await created.json()).layout.id as string;
  psql(`UPDATE layouts SET grid = 12 WHERE id = '${oldId}'`);
  const page = await openEditor(browser, oldId, { canvas: false });
  const notice = page.getByTestId("editor-grid-changed");
  await expect(notice).toBeVisible({ timeout: 60_000 });
  await expect(notice).toContainText(/reload|neu laden|recharge/i);
  await expect(notice.getByTestId("editor-reload")).toBeVisible();
  await expect(page.getByTestId("editor-canvas")).toHaveCount(0);
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

test("a custom size previews like a preset; one the grid cannot hold says why", async ({ browser }) => {
  const page = await openEditor(browser);
  await page.getByTestId("screen-picker").click();
  await page.getByTestId("screen-picker-custom").click();
  const form = page.getByTestId("custom-size-form");
  await expect(form).toBeVisible();
  await form.getByTestId("custom-width").fill("500");
  await form.getByTestId("custom-height").fill("500");
  await expect(form.getByTestId("custom-size-error")).toBeVisible();
  await expect(form.getByTestId("custom-apply")).toBeDisabled();
  await form.getByTestId("custom-width").fill("1366");
  await form.getByTestId("custom-height").fill("768");
  await expect(form.getByTestId("custom-size-error")).toHaveCount(0);
  await form.getByTestId("custom-apply").click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-width", "1366");
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-height", "768");
  await expect(page.getByTestId("screen-picker")).toContainText("1366×768");
  // Remembered in this browser: offered again after a reload.
  await page.reload();
  await expect(page.getByTestId("editor-canvas")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("screen-picker").click();
  await expect(page.getByRole("option", { name: /1366×768/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.context().close();
});

test("a copy for a 1920x1080 preview is a new valid layout, opened with what it left out", async ({ browser }) => {
  const page = await openEditor(browser);
  await page.getByTestId("screen-picker").click();
  await page.getByRole("option", { name: /1920×1080/ }).first().click();
  await page.getByTestId("editor-copy").click();
  const dialog = page.getByTestId("copy-dialog");
  await expect(dialog.getByTestId("copy-name")).toHaveValue(`${P}Küche 1920×1080`);
  await dialog.getByTestId("copy-name").fill(`${P}Wohnzimmer`);
  await dialog.getByTestId("copy-create").click();
  await page.waitForURL((url) => url.pathname.startsWith("/settings/layouts/") && !url.pathname.endsWith(layoutId), { timeout: 30_000 });
  const copyId = page.url().split("/").pop()!;
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-width", "1920", { timeout: 30_000 });
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-height", "1080");
  const row = JSON.parse(psql(`SELECT json_build_object('name', name, 'width', width, 'height', height, 'screensaver', screensaver)::text FROM layouts WHERE id = '${copyId}'`));
  expect(row).toMatchObject({ name: `${P}Wohnzimmer`, width: 1920, height: 1080 });
  expect(validateItems(row.screensaver, 1920, 1080).ok).toBe(true);
  const kept = new Set((row.screensaver as LayoutItem[]).map((i) => i.widget));
  // Free cells are used before anything is dropped: the clock and the date stay.
  expect(kept.has("clock") && kept.has("date"), [...kept].join(",")).toBe(true);
  await expect(page.locator("[data-editor-item=clock]")).toBeVisible();
  await expect(page.locator("[data-editor-item=date]")).toBeVisible();
  const lost = saved().filter((i) => !kept.has(i.widget));
  if (lost.length > 0) {
    const notice = page.getByTestId("editor-copy-dropped");
    await expect(notice).toBeVisible();
    for (const i of lost) await expect(notice).toContainText(EN_NAMES[i.widget]);
  }
  // Shown once: gone after a reload.
  await page.reload();
  await expect(page.getByTestId("editor-canvas")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("editor-copy-dropped")).toHaveCount(0);
  await page.context().close();
});

test("a copy's note on what it left out is shown once: leaving and reopening the copy shows none", async ({ browser }) => {
  // A fresh built-in portrait: copied to 1920x1080 it always leaves the birthdays out.
  const created = await api.post("/api/layouts", { data: { grid: 48, name: `${P}Flur`, ...SIZE, from: "builtin" } });
  expect(created.status(), await created.text()).toBe(201);
  const sourceId = (await created.json()).layout.id as string;
  const page = await openEditor(browser, sourceId);
  await page.getByTestId("screen-picker").click();
  await page.getByRole("option", { name: /1920×1080/ }).first().click();
  await page.getByTestId("editor-copy").click();
  await page.getByTestId("copy-dialog").getByTestId("copy-name").fill(`${P}Flur quer`);
  await page.getByTestId("copy-dialog").getByTestId("copy-create").click();
  await page.waitForURL((url) => url.pathname.startsWith("/settings/layouts/") && !url.pathname.endsWith(sourceId), { timeout: 30_000 });
  const copyId = page.url().split("/").pop()!;
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-width", "1920", { timeout: 30_000 });
  const notice = page.getByTestId("editor-copy-dropped");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(EN_NAMES.birthdays);
  // The editor page is mounted a second time shortly after a client-side
  // navigation; the note has to outlast that.
  await page.waitForTimeout(1500);
  await expect(notice).toBeVisible();

  // Away and back without a reload: Settings, Settings → Layouts, the copy's Edit.
  await page.locator("main a[title]").first().click();
  await page.waitForURL((url) => url.pathname === "/settings", { timeout: 30_000 });
  await page.locator('a[href="/settings/layouts"]').first().click();
  await page.waitForURL((url) => url.pathname === "/settings/layouts", { timeout: 30_000 });
  await page.locator(`a[href="/settings/layouts/${copyId}"]`).first().click();
  await page.waitForURL((url) => url.pathname.endsWith(copyId), { timeout: 30_000 });
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-width", "1920", { timeout: 30_000 });
  await expect(page.locator("[data-editor-item=clock]")).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await expect(notice).toHaveCount(0);
    await page.waitForTimeout(500);
  }
  await page.context().close();
});

test("a grid_changed reload whose leave prompt is cancelled leaves the editor and its draft as they were", async ({ browser }) => {
  const page = await openEditor(browser);
  // The server answers as one on a newer grid would.
  await page.route(`**/api/layouts/${layoutId}`, (route) =>
    route.request().method() === "PATCH" ? route.fulfill({ status: 409, json: { error: "grid_changed" } }) : route.fallback(),
  );
  const date = page.locator("[data-editor-item=date]");
  const before = await boxOf(date);
  await date.click();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await boxOf(date)).x).toBe(before.x + 1);
  await page.getByTestId("editor-save").click();
  const stale = page.getByTestId("editor-stale");
  await expect(stale).toBeVisible({ timeout: 15_000 });
  let prompted = false;
  page.once("dialog", (dialog) => {
    prompted = dialog.type() === "beforeunload";
    void dialog.dismiss();
  });
  await page.getByTestId("editor-reload").click();
  await expect.poll(() => prompted).toBe(true);
  // Still this page, still usable, the changes still kept for the tab.
  await expect(page.getByTestId("editor-reload")).toBeEnabled();
  await expect(page.getByTestId("layout-editor")).toHaveAttribute("data-dirty", "true");
  expect(await page.evaluate((id) => sessionStorage.getItem(`kinboard_layout_draft:48:${id}`), layoutId)).not.toBeNull();
  await date.click();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await boxOf(date)).x).toBe(before.x + 2);
  await page.context().close();
});

test("saving over someone else's change shows the reload message", async ({ browser }) => {
  const page = await openEditor(browser);
  // Another editor saves first, with the stamp both loaded.
  const current = JSON.parse(psql(`SELECT json_build_object('updated_at', updated_at, 'screensaver', screensaver)::text FROM layouts WHERE id = '${layoutId}'`));
  const theirs = (current.screensaver as LayoutItem[]).map((i) => (i.widget === "weatherNow" ? { ...i, text: "XL" } : i));
  const other = await api.patch(`/api/layouts/${layoutId}`, { data: { grid: 48, screensaver: theirs, updated_at: current.updated_at } });
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
