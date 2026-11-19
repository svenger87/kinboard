import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { postJoin } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";
import { gridFor } from "../src/lib/layouts/grid";
import { rescaleItems } from "../src/lib/layouts/rescale";
import type { LayoutItem } from "../src/lib/layouts/types";

/**
 * Settings → Layouts and where layouts are assigned: a new layout made for a
 * wall screen's size from the built-in arrangement, assigned in Settings →
 * Devices, made the portrait default, duplicated, and deleted again (the
 * confirmation names the screen that falls back, and the device and the
 * default end up on the built-in screensaver). The default pickers only
 * offer layouts of their orientation, Settings → Devices warns about a
 * screen of another shape and lists what does not fit on it, and Settings →
 * Screensaver points to the layout while one is in use. In a family of its
 * own, removed afterwards. Needs the stack (FAMILY_CODE) and a dev server
 * (PLAYWRIGHT_BASE_URL).
 */

test.skip(!process.env.FAMILY_CODE || !process.env.PLAYWRIGHT_BASE_URL, "needs FAMILY_CODE, PLAYWRIGHT_BASE_URL and a running stack");
test.describe.configure({ mode: "serial" });

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const P = "claude-layoutsettings-";
const PIN = "4711";
const NAME = "Küche hochkant";
const COPY = "Küche hochkant (copy)";
const LANDSCAPE = "Flur quer";
/** The widget names the (English) settings show. */
const EN_NAMES: Record<string, string> = JSON.parse(readFileSync(join(__dirname, "..", "messages", "en.json"), "utf8")).settings.layouts.editor.widgets;

let famId = "";
let code = "";
let api: APIRequestContext;
let familyJson: Record<string, unknown>;
let deviceJson: Record<string, unknown>;
/** The wall screen the layout is made for (1080×1920, a kiosk), and a tablet of another shape. */
let kitchenId = "";
let tabletId = "";
let layoutId = "";

function purge(ids: string[]) {
  for (const id of ids.filter(Boolean)) {
    const fam = sqlText(id);
    psql(`DELETE FROM devices WHERE family_id = ${fam}`);
    psql(`DELETE FROM layouts WHERE family_id = ${fam}`);
    psql(`DELETE FROM settings WHERE family_id = ${fam}`);
    psql(`DELETE FROM integration_secrets WHERE family_id = ${fam}`);
    psql(`DELETE FROM families WHERE id = ${fam}`);
  }
}

const screenJson = (w: number, h: number, ratio = 1) =>
  `'${JSON.stringify({ viewportWidth: w, viewportHeight: h, screenWidth: Math.round(w * ratio), screenHeight: Math.round(h * ratio), pixelRatio: ratio })}'::jsonb`;

async function join_(name: string): Promise<string> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const res = await postJoin(ctx, { joinCode: code, hardwareId: `${P}${name}-${Date.now()}`, deviceName: name });
  expect(res.ok(), await res.text()).toBe(true);
  const id = ((await res.json()) as { device: { id: string } }).device.id;
  await ctx.dispose();
  return id;
}

/** A settings page, in a browser that is the family's (non-kiosk) desk device with the settings unlocked. */
async function open(browser: Browser, path: string, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const ctx = await browser.newContext({
    viewport,
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
  await page.goto(path, { waitUntil: "domcontentloaded" });
  return page;
}

const row = (page: Page, name: string) => page.getByTestId("layout-row").filter({ has: page.getByTestId("layout-name").getByText(name, { exact: true }) });
const deviceRow = (page: Page, id: string) => page.locator(`[data-device-id="${id}"]`);
const defaults = () => JSON.parse(psql(`SELECT value::text FROM settings WHERE family_id = '${famId}' AND key = 'layout_defaults'`) || "{}");

async function openLayouts(browser: Browser, viewport?: { width: number; height: number }) {
  const page = await open(browser, "/settings/layouts", viewport);
  await expect(page.getByTestId("layouts-list")).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });
  return page;
}

test.beforeAll(async () => {
  test.setTimeout(90_000);
  purge(psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`).split(","));
  code = `CS${randomBytes(4).toString("hex").toUpperCase()}`;
  famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);
  // No screensaver over the settings while the test is idle.
  psql(`INSERT INTO settings (family_id, key, value) VALUES ('${famId}', 'screensaver', '{"screensaverTimeout":0}'::jsonb)`);

  api = await pwRequest.newContext({ baseURL: BASE });
  const res = await postJoin(api, { joinCode: code, hardwareId: `${P}desk-${Date.now()}`, deviceName: `${P}desk` });
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { family: Record<string, unknown>; device: { id: string } & Record<string, unknown> };
  familyJson = body.family;
  deviceJson = body.device;

  kitchenId = await join_("Küche");
  psql(`UPDATE devices SET is_kiosk = true, screen = ${screenJson(1080, 1920, 1.5)} WHERE id = '${kitchenId}'`);
  tabletId = await join_("Tablet");
  psql(`UPDATE devices SET screen = ${screenJson(1280, 800)} WHERE id = '${tabletId}'`);

  const setPin = await api.post("/api/pin", { data: { family_id: famId, action: "set", pin: PIN } });
  expect(setPin.ok(), await setPin.text()).toBe(true);
  const unlock = await api.post("/api/pin", { data: { family_id: famId, action: "verify", pin: PIN } });
  expect(unlock.ok(), await unlock.text()).toBe(true);
});

test.afterAll(async () => {
  purge([famId]);
  await api?.dispose();
  expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
});

test("without any layout, Settings → Devices looks as before: no layout picker, no note", async ({ browser }) => {
  const page = await open(browser, "/settings/devices");
  const kitchen = deviceRow(page, kitchenId);
  await expect(kitchen).toBeVisible({ timeout: 60_000 });
  // Give the layouts query time to answer: the picker would appear with it.
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("device-layout")).toHaveCount(0);
  await expect(page.getByTestId("device-layout-no-defaults")).toHaveCount(0);
  await page.context().close();
});

test("a new layout for the kitchen screen starts from the built-in one and opens the editor", async ({ browser }) => {
  const page = await openLayouts(browser);
  await expect(page.getByTestId("layouts-empty")).toBeVisible();
  await page.getByTestId("layouts-new").click();
  const dialog = page.getByTestId("new-layout-dialog");
  await expect(dialog).toBeVisible();
  // The starting choice is the wall screen that reported its size, not this (desk) browser, which reports its own too.
  await expect(dialog.getByTestId("screen-picker")).toContainText("Küche — 1080×1920");
  await dialog.getByTestId("new-layout-name").fill(NAME);
  // Drawn for the kitchen's size, it offers to go straight onto the kitchen; this run leaves that to Settings → Devices.
  const useOn = dialog.getByTestId("new-layout-use");
  await expect(useOn).toBeChecked();
  await expect(dialog).toContainText(/Küche/);
  await dialog.locator("label[for=new-layout-use]").last().click();
  await expect(useOn).not.toBeChecked();
  await dialog.getByTestId("new-layout-create").click();
  await expect(page).toHaveURL(/\/settings\/layouts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId("editor-canvas")).toBeVisible({ timeout: 60_000 });
  // No screen shows it, so the editor says so and offers the kitchen.
  await expect(page.getByTestId("editor-unused")).toBeVisible();
  await expect(page.getByTestId("editor-unused-assign")).toBeVisible();

  layoutId = psql(`SELECT id FROM layouts WHERE family_id = '${famId}' AND name = ${sqlText(NAME)}`);
  expect(layoutId).toMatch(/^[0-9a-f-]{36}$/);
  expect(psql(`SELECT width || 'x' || height FROM layouts WHERE id = '${layoutId}'`)).toBe("1080x1920");
  expect(Number(psql(`SELECT jsonb_array_length(screensaver) FROM layouts WHERE id = '${layoutId}'`))).toBeGreaterThan(0);

  await page.goto("/settings/layouts", { waitUntil: "domcontentloaded" });
  const r = row(page, NAME);
  await expect(r).toBeVisible({ timeout: 30_000 });
  await expect(r.getByTestId("layout-shape")).toHaveText("1080×1920 · portrait");
  await expect(r).toHaveAttribute("data-device-count", "0");
  await r.getByTestId("layout-edit").click();
  await expect(page).toHaveURL(new RegExp(`/settings/layouts/${layoutId}$`));
  await page.context().close();
});

test("assigned to the kitchen in Settings → Devices, the layout counts one screen and the screensaver page points to it", async ({ browser }) => {
  const page = await open(browser, "/settings/devices");
  const kitchen = deviceRow(page, kitchenId);
  await expect(kitchen.getByTestId("device-layout")).toBeVisible({ timeout: 60_000 });
  await expect(kitchen.getByTestId("device-layout")).toContainText("Built-in");
  // No default is set yet, so there is nothing to say about defaults on the desk.
  await expect(deviceRow(page, String(deviceJson.id)).getByTestId("device-layout")).toBeVisible();
  await expect(deviceRow(page, String(deviceJson.id)).getByTestId("device-layout-no-defaults")).toHaveCount(0);
  await kitchen.getByTestId("device-layout").click();
  await page.getByRole("option", { name: NAME, exact: true }).click();
  await expect.poll(() => psql(`SELECT layout_id FROM devices WHERE id = '${kitchenId}'`)).toBe(layoutId);
  await expect(kitchen.getByTestId("device-layout")).toContainText(NAME);
  // Same shape as the layout: nothing to warn about.
  await expect(kitchen.getByTestId("device-layout-aspect")).toHaveCount(0);
  await expect(kitchen.getByTestId("device-layout-dropped")).toHaveCount(0);

  await page.goto("/settings/layouts", { waitUntil: "domcontentloaded" });
  const r = row(page, NAME);
  await expect(r).toHaveAttribute("data-device-count", "1", { timeout: 30_000 });
  await expect(r.getByTestId("layout-devices")).toContainText("Küche");

  await page.goto("/settings/screensaver", { waitUntil: "domcontentloaded" });
  const note = page.getByTestId("screensaver-layout-note");
  await expect(note).toBeVisible({ timeout: 30_000 });
  await expect(note).toContainText("Küche");
  await expect(note).toContainText(NAME);
  await expect(note.getByRole("link")).toHaveAttribute("href", "/settings/layouts");
  await page.context().close();
});

test("the default pickers only offer layouts of their orientation; the portrait default gets a badge", async ({ browser }) => {
  const created = await api.post("/api/layouts", { data: { grid: 48, name: LANDSCAPE, width: 1920, height: 1080, from: "builtin" } });
  expect(created.status(), await created.text()).toBe(201);
  const page = await openLayouts(browser);
  await expect(row(page, LANDSCAPE)).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("default-portrait").click();
  await expect(page.getByRole("option")).toHaveText(["Built-in", NAME]);
  await page.getByRole("option", { name: NAME, exact: true }).click();
  await expect.poll(() => defaults().portrait).toBe(layoutId);
  await expect(row(page, NAME).getByTestId("layout-badge-portrait")).toHaveText("Portrait default");
  await expect(row(page, LANDSCAPE).getByTestId("layout-badge-portrait")).toHaveCount(0);

  await page.getByTestId("default-landscape").click();
  await expect(page.getByRole("option")).toHaveText(["Built-in", LANDSCAPE]);
  await page.keyboard.press("Escape");
  expect(defaults().landscape ?? null).toBeNull();

  // With a default set, the desk (no wall screen) says the defaults do not reach it.
  await page.goto("/settings/devices", { waitUntil: "domcontentloaded" });
  await expect(deviceRow(page, String(deviceJson.id)).getByTestId("device-layout-no-defaults")).toBeVisible({ timeout: 60_000 });
  await page.context().close();
});

test("a default pointing at a layout that is gone shows as Built-in and does not block the other default", async ({ browser }) => {
  const gone = "00000000-0000-4000-8000-000000000000";
  psql(`UPDATE settings SET value = jsonb_set(value, '{landscape}', '"${gone}"') WHERE family_id = '${famId}' AND key = 'layout_defaults'`);
  expect(defaults().landscape).toBe(gone);
  const page = await openLayouts(browser);
  await expect(page.getByTestId("default-landscape")).toContainText("Built-in", { timeout: 30_000 });
  // Changing the other slot used to send the stale id along and fail with bad_default.
  await page.getByTestId("default-portrait").click();
  await page.getByRole("option", { name: "Built-in", exact: true }).click();
  await expect.poll(() => defaults().portrait ?? null).toBeNull();
  expect(defaults().landscape ?? null).toBeNull();
  await page.getByTestId("default-portrait").click();
  await page.getByRole("option", { name: NAME, exact: true }).click();
  await expect.poll(() => defaults().portrait).toBe(layoutId);
  await expect(row(page, NAME).getByTestId("layout-badge-portrait")).toHaveText("Portrait default");
  await page.context().close();
});

test("duplicate makes a copy with the same arrangement and size", async ({ browser }) => {
  const page = await openLayouts(browser);
  await row(page, NAME).getByTestId("layout-duplicate").click();
  const dialog = page.getByTestId("duplicate-dialog");
  await expect(dialog.getByTestId("duplicate-name")).toHaveValue(COPY);
  await dialog.getByTestId("duplicate-create").click();
  const copy = row(page, COPY);
  await expect(copy).toBeVisible({ timeout: 30_000 });
  await expect(copy.getByTestId("layout-shape")).toHaveText("1080×1920 · portrait");
  await expect(copy).toHaveAttribute("data-device-count", "0");
  // A copy is not the default.
  await expect(copy.getByTestId("layout-badge-portrait")).toHaveCount(0);
  const [a, b] = [NAME, COPY].map((n) => psql(`SELECT screensaver::text FROM layouts WHERE family_id = '${famId}' AND name = ${sqlText(n)}`));
  expect(JSON.parse(b)).toEqual(JSON.parse(a));
  await page.context().close();
});

const enList = (names: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(names);

/** The widgets of the layout that an 800×900 screen has no room for, by their English names. */
function droppedAt800x900(): string[] {
  const items = JSON.parse(psql(`SELECT screensaver::text FROM layouts WHERE id = '${layoutId}'`)) as LayoutItem[];
  const { dropped } = rescaleItems(items, gridFor(1080, 1920)!, gridFor(800, 900)!);
  expect(dropped.length, "the 800×900 screen should lose a widget, or this test checks nothing").toBeGreaterThan(0);
  return dropped.map((id) => EN_NAMES[items.find((i) => i.id === id)!.widget]);
}

test("Settings → Devices describes the layout a screen actually draws: none when its own is for the other orientation, else warns about the shape and lists what does not fit", async ({ browser }) => {
  // The tablet (no kiosk) reports 1280×800, landscape: its own portrait layout is not drawn there.
  psql(`UPDATE devices SET layout_id = '${layoutId}' WHERE id = '${tabletId}'`);
  const page = await open(browser, "/settings/devices");
  const tablet = deviceRow(page, tabletId);
  await expect(tablet.getByTestId("device-layout-other-orientation")).toHaveText(
    `“${NAME}” is for portrait screens; while this screen is turned this way it shows the built-in screensaver.`,
    { timeout: 60_000 },
  );
  await expect(tablet.getByTestId("device-layout-aspect")).toHaveCount(0);
  await expect(tablet.getByTestId("device-layout-dropped")).toHaveCount(0);
  await expect(tablet.getByTestId("device-layout-default")).toHaveCount(0);

  // A portrait 800×900 screen draws it, rescaled to fewer rows.
  psql(`UPDATE devices SET screen = ${screenJson(800, 900)} WHERE id = '${tabletId}'`);
  const names = droppedAt800x900();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(tablet.getByTestId("device-layout-aspect")).toHaveText("Made for 1080×1920 — this screen is 800×900", { timeout: 60_000 });
  await expect(tablet.getByTestId("device-layout-dropped")).toHaveText(`Not shown on this screen: ${enList(names)}`);
  await expect(tablet.getByTestId("device-layout-other-orientation")).toHaveCount(0);
  await expect(tablet.getByTestId("device-layout-default")).toHaveCount(0);

  psql(`UPDATE devices SET layout_id = NULL, screen = ${screenJson(1280, 800)} WHERE id = '${tabletId}'`);
  await page.context().close();
});

test("a wall screen on the portrait default of another shape gets the warning, and the layout list counts it", async ({ browser }) => {
  // A kiosk with no layout of its own, 800×900 portrait: it draws the portrait default (the kitchen layout).
  psql(`UPDATE devices SET is_kiosk = true, layout_id = NULL, screen = ${screenJson(800, 900)} WHERE id = '${tabletId}'`);
  const names = droppedAt800x900();
  const page = await open(browser, "/settings/devices");
  const tablet = deviceRow(page, tabletId);
  await expect(tablet.getByTestId("device-layout")).toContainText("Built-in", { timeout: 60_000 });
  await expect(tablet.getByTestId("device-layout-default")).toHaveText(`Uses the default layout “${NAME}”`);
  await expect(tablet.getByTestId("device-layout-aspect")).toHaveText("Made for 1080×1920 — this screen is 800×900");
  await expect(tablet.getByTestId("device-layout-dropped")).toHaveText(`Not shown on this screen: ${enList(names)}`);
  await expect(tablet.getByTestId("device-layout-no-defaults")).toHaveCount(0);

  await page.goto("/settings/layouts", { waitUntil: "domcontentloaded" });
  const r = row(page, NAME);
  await expect(r).toHaveAttribute("data-device-count", "2", { timeout: 30_000 });
  await expect(r.getByTestId("layout-devices")).toHaveText("Assigned to Küche · Default on Tablet");
  await expect(row(page, COPY).getByTestId("layout-devices")).toHaveText("Not shown on any screen");
  await page.context().close();
  // The tablet stays a kiosk on the default for the delete below.
});

test("deleting the layout names the screens that fall back; the devices and the default go back to built-in", async ({ browser }) => {
  const page = await openLayouts(browser);
  await row(page, NAME).getByTestId("layout-delete").click();
  const dialog = page.getByTestId("delete-dialog");
  await expect(dialog).toBeVisible();
  // Both the screen it is assigned to and the one showing it as the default go back to built-in.
  await expect(dialog.getByTestId("delete-devices")).toHaveText("Küche and Tablet will show the built-in screensaver again.");
  await expect(dialog.getByTestId("delete-default")).toContainText("portrait default");
  await dialog.getByTestId("delete-confirm").click();
  await expect(row(page, NAME)).toHaveCount(0, { timeout: 30_000 });
  await expect(row(page, COPY)).toBeVisible();
  expect(psql(`SELECT count(*) FROM layouts WHERE id = '${layoutId}'`)).toBe("0");
  expect(defaults().portrait).toBeNull();
  await expect(page.getByTestId("default-portrait")).toContainText("Built-in");

  await page.goto("/settings/devices", { waitUntil: "domcontentloaded" });
  await expect(deviceRow(page, kitchenId).getByTestId("device-layout")).toContainText("Built-in", { timeout: 60_000 });
  expect(psql(`SELECT coalesce(layout_id::text, 'null') FROM devices WHERE id = '${kitchenId}'`)).toBe("null");

  await page.goto("/settings/screensaver", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#screensaver-news")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("screensaver-layout-note")).toHaveCount(0);
  await page.context().close();
});
