import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { postJoin } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";
import { builtInHome } from "../src/lib/layouts/built-in";
import { homeArea } from "../src/lib/layouts/home-area";
import { validateItems } from "../src/lib/layouts/validate";
import type { HomeLayoutItem, LayoutItem } from "../src/lib/layouts/types";

/**
 * The editor's Home tab (RFC-022 step 6), on a 1080x1920 layout made from
 * the built-in one: the Home | Screensaver switch, Home starting from today's
 * Home while the layout has none, a labelled tile for each Home widget that
 * cannot be drawn in a box yet, the palette offering a child's widget once
 * per child, undo kept per face, a save that sends only the face changed,
 * and Settings -> Widgets naming the screens that use a designed Home. In a
 * family of its own, removed afterwards. Needs the stack (FAMILY_CODE) and a
 * dev server (PLAYWRIGHT_BASE_URL).
 */

test.skip(!process.env.FAMILY_CODE || !process.env.PLAYWRIGHT_BASE_URL, "needs FAMILY_CODE, PLAYWRIGHT_BASE_URL and a running stack");
test.describe.configure({ mode: "serial" });

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const P = "claude-rfc022-s6-ui-";
const SIZE = { width: 1080, height: 1920 };
const AREA = homeArea(SIZE.width, SIZE.height);
const PIN = "4711";

let famId = "";
let layoutId = "";
let mia = "";
let leo = "";
let wallId = "";
let api: APIRequestContext;
let familyJson: Record<string, unknown>;
let deviceJson: Record<string, unknown>;

function purge(ids: string[]) {
  for (const id of ids.filter(Boolean)) {
    const fam = sqlText(id);
    psql(`DELETE FROM devices WHERE family_id = ${fam}`);
    psql(`DELETE FROM layouts WHERE family_id = ${fam}`);
    psql(`DELETE FROM settings WHERE family_id = ${fam}`);
    psql(`SET kinboard.hard_delete = 'on'; DELETE FROM people WHERE family_id = ${fam}`);
    psql(`DELETE FROM integration_secrets WHERE family_id = ${fam}`);
    psql(`DELETE FROM families WHERE id = ${fam}`);
  }
}

const savedHome = (): HomeLayoutItem[] => JSON.parse(psql(`SELECT home::text FROM layouts WHERE id = '${layoutId}'`));
const savedSaver = (): LayoutItem[] => JSON.parse(psql(`SELECT screensaver::text FROM layouts WHERE id = '${layoutId}'`));

/** A page that is the family's desk device with the settings unlocked. */
async function openPage(browser: Browser, path: string): Promise<Page> {
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
  await page.addInitScript(({ familyId }) => {
    sessionStorage.setItem("kinboard_settings_unlock", JSON.stringify({ familyId, at: Date.now() }));
    const hide = () => {
      const el = document.createElement("style");
      el.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(el);
    };
    if (document.head) hide();
    else document.addEventListener("DOMContentLoaded", hide);
  }, { familyId: famId });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  return page;
}

async function openEditor(browser: Browser): Promise<Page> {
  const page = await openPage(browser, `/settings/layouts/${layoutId}`);
  await expect(page.getByTestId("editor-canvas")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-editor-item=clock]")).toBeVisible();
  return page;
}

async function toHome(page: Page) {
  await page.getByTestId("editor-surface-home").click();
  await expect(page.getByTestId("layout-editor")).toHaveAttribute("data-surface", "home");
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-surface", "home");
}

test.beforeAll(async () => {
  test.setTimeout(90_000);
  purge(psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`).split(","));
  const code = `CU${randomBytes(4).toString("hex").toUpperCase()}`;
  famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);
  psql(`INSERT INTO settings (family_id, key, value) VALUES ('${famId}', 'screensaver', '{"screensaverTimeout":0}'::jsonb)`);
  mia = psqlRow(`INSERT INTO people (family_id, name, color, is_child) VALUES ('${famId}', 'Mia', '#ff8800', true) RETURNING id`);
  leo = psqlRow(`INSERT INTO people (family_id, name, color, is_child) VALUES ('${famId}', 'Leo', '#0088ff', true) RETURNING id`);
  psqlRow(`INSERT INTO people (family_id, name, color, is_child) VALUES ('${famId}', 'Anna', '#22aa44', false) RETURNING id`);

  api = await pwRequest.newContext({ baseURL: BASE });
  const res = await postJoin(api, { joinCode: code, hardwareId: `${P}desk-${Date.now()}`, deviceName: `${P}desk` });
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { family: Record<string, unknown>; device: { id: string } & Record<string, unknown> };
  familyJson = body.family;
  deviceJson = body.device;
  const wallApi = await pwRequest.newContext({ baseURL: BASE });
  const wall = await postJoin(wallApi, { joinCode: code, hardwareId: `${P}wall-${Date.now()}`, deviceName: `${P}wall` });
  expect(wall.ok(), await wall.text()).toBe(true);
  wallId = ((await wall.json()) as { device: { id: string } }).device.id;
  await wallApi.dispose();

  expect((await api.post("/api/pin", { data: { family_id: famId, action: "set", pin: PIN } })).ok()).toBe(true);
  expect((await api.post("/api/pin", { data: { family_id: famId, action: "verify", pin: PIN } })).ok()).toBe(true);
  const created = await api.post("/api/layouts", { data: { grid: 48, name: `${P}Küche`, ...SIZE, from: "builtin" } });
  expect(created.status(), await created.text()).toBe(201);
  layoutId = (await created.json()).layout.id;
  // The wall screen uses this layout (a kiosk on its own layout, size reported).
  psql(`UPDATE devices SET is_kiosk = true, layout_id = '${layoutId}', screen = '{"viewportWidth":1080,"viewportHeight":1920,"screenWidth":1080,"screenHeight":1920,"pixelRatio":1}'::jsonb WHERE id = '${wallId}'`);
});

test.afterAll(async () => {
  purge([famId]);
  await api?.dispose();
  expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
});

test("the switch shows Home, starting from today's Home with a labelled tile per widget not drawn in a box yet", async ({ browser }) => {
  const page = await openEditor(browser);
  // The screensaver is the face shown first, as before.
  await expect(page.getByTestId("layout-editor")).toHaveAttribute("data-surface", "screensaver");
  await expect(page.getByTestId("editor-preview-screensaver")).toBeVisible();
  const saverIds = await page.locator("[data-editor-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-item-id")));

  await toHome(page);
  await expect(page.getByTestId("editor-home-builtin")).toBeVisible();
  await expect(page.getByTestId("editor-preview-screensaver")).toHaveCount(0);
  const expected = builtInHome(AREA.width, AREA.height);
  await expect(page.locator("[data-editor-item]")).toHaveCount(expected.length);
  for (const i of expected) {
    await expect(page.locator(`[data-item-id="${i.id}"]`), i.id).toHaveAttribute("data-box", `${i.x},${i.y},${i.w},${i.h}`);
  }
  // A widget with no component in a box yet draws as a tile named after it;
  // one with a component draws itself. Either way each box shows something.
  const tiles = page.locator("[data-testid=home-placeholder]");
  for (const i of expected) {
    const tile = page.locator(`[data-item-id="${i.id}"] [data-testid=home-placeholder]`);
    if ((await tile.count()) > 0) await expect(tile).toHaveAttribute("data-widget", i.widget);
    else await expect(page.locator(`[data-item-id="${i.id}"] [data-editor-box] > div`), i.id).not.toBeEmpty();
  }
  if ((await tiles.count()) > 0) await expect(tiles.first()).not.toHaveText("");
  const week = page.locator(`[data-item-id="weekOverview"] [data-testid=home-placeholder]`);
  if ((await week.count()) > 0) await expect(week).toContainText("Week overview");
  // Opening Home changes nothing.
  await expect(page.getByTestId("layout-editor")).toHaveAttribute("data-dirty", "false");
  // For a review: LAYOUTS_SHOT_DIR=<dir> keeps a picture of the Home tab.
  if (process.env.LAYOUTS_SHOT_DIR) await page.screenshot({ path: `${process.env.LAYOUTS_SHOT_DIR}/editor-home-tab.png` });

  await page.getByTestId("editor-surface-screensaver").click();
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-surface", "screensaver");
  expect(await page.locator("[data-editor-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-item-id")))).toEqual(saverIds);
  await page.context().close();
});

test("the palette offers a child's widget once per child; one added carries the child and is saved as Home only", async ({ browser }) => {
  const saverBefore = savedSaver();
  const page = await openEditor(browser);
  await toHome(page);
  // Children only: the parent gets no schedule of her own.
  for (const w of ["schedule", "pocketMoney"]) {
    await expect(page.getByTestId(`palette-add-${w}:${mia}`)).toContainText("Mia");
    await expect(page.getByTestId(`palette-add-${w}:${leo}`)).toContainText("Leo");
  }
  await expect(page.locator(`[data-testid^="palette-add-schedule:"]`)).toHaveCount(2);
  // Make room: the built-in Home fills the screen. The week overview goes.
  await page.locator(`[data-item-id="weekOverview"] [data-editor-box]`).click();
  await page.keyboard.press("Delete");
  await expect(page.locator(`[data-item-id="weekOverview"]`)).toHaveCount(0);

  await page.getByTestId(`palette-add-schedule:${mia}`).click();
  const added = page.locator(`[data-item-id="schedule:${mia}"]`);
  await expect(added).toBeVisible();
  await expect(added).toHaveAttribute("aria-label", /Mia/);
  await expect(page.getByTestId("inspector-title")).toContainText("Mia");
  await expect(page.getByTestId(`palette-add-schedule:${mia}`)).toHaveCount(0);
  await expect(page.getByTestId(`palette-add-schedule:${leo}`)).toBeVisible();

  const save = page.getByTestId("editor-save");
  await save.click();
  await expect(page.getByTestId("layout-editor")).toHaveAttribute("data-dirty", "false", { timeout: 15_000 });
  const home = savedHome();
  expect(home.find((i) => i.id === `schedule:${mia}`)?.options).toEqual({ personId: mia });
  expect(home.some((i) => i.widget === "weekOverview")).toBe(false);
  expect(validateItems(home, AREA.width, AREA.height, "home").ok).toBe(true);
  expect(savedSaver()).toEqual(saverBefore);
  // Saved, Home is the layout's own: the built-in note is gone.
  await expect(page.getByTestId("editor-home-builtin")).toHaveCount(0);
  await page.context().close();
});

test("undo is kept per face: a Home change is not undone from the screensaver", async ({ browser }) => {
  const page = await openEditor(browser);
  await toHome(page);
  const undo = page.getByTestId("editor-undo");
  await expect(undo).toBeDisabled();
  await page.locator(`[data-item-id="schedule:${mia}"] [data-editor-box]`).click();
  await page.keyboard.press("Delete");
  await expect(undo).toBeEnabled();
  await page.getByTestId("editor-surface-screensaver").click();
  await expect(undo).toBeDisabled();
  await expect(page.getByTestId("layout-editor")).toHaveAttribute("data-dirty", "true");
  await page.keyboard.press("Control+z");
  await toHome(page);
  await expect(page.locator(`[data-item-id="schedule:${mia}"]`)).toHaveCount(0);
  await undo.click();
  await expect(page.locator(`[data-item-id="schedule:${mia}"]`)).toBeVisible();
  await expect(page.getByTestId("layout-editor")).toHaveAttribute("data-dirty", "false");
  await page.context().close();
});

test("Settings -> Widgets names the screens that use a designed Home", async ({ browser }) => {
  const page = await openPage(browser, "/settings/widgets");
  const note = page.getByTestId("home-layout-note");
  await expect(note).toContainText(`${P}wall`, { timeout: 60_000 });
  await expect(note).toContainText(`${P}Küche`);
  await expect(note.getByRole("link")).toHaveAttribute("href", "/settings/layouts");
  // With Home back on the built-in, the screen follows these settings again and is not named.
  psql(`UPDATE layouts SET home = '[]'::jsonb WHERE id = '${layoutId}'`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("compact-home").or(page.locator("#compact-home"))).toBeVisible({ timeout: 60_000 });
  await expect(note).toHaveCount(0);
  await page.context().close();
});
