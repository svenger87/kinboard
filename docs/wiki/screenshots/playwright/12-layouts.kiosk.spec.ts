import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { getDemoJoinCode, killAnimations, setTheme, snap, waitForReady, SCREENSHOT_THEME } from "./helpers";

/**
 * Layouts (wiki page Layouts.md): the editor, Settings → Layouts, a screen's
 * layout picker in Settings → Devices, a designed screensaver on a 1080×1920
 * wall screen, and the same layout copied for 1920×1080.
 *
 * Self-contained: it joins the family as two wall screens ("Küche", portrait,
 * and "Flur", landscape) and a laptop, makes the layouts "Küche hochkant" and
 * "Flur quer" through the API, assigns them and sets them as the defaults,
 * adds three events for the coming days, and removes all of it afterwards.
 * Weather and news are stubbed in the browser. The UI is German whatever the
 * family's language.
 *
 * Runs against either stack:
 *
 *   the toolchain's anonymised demo stack (README.md):
 *     npm run capture -- 12-layouts --project=kiosk-portrait
 *     SCREENSHOT_THEME=light npm run capture -- 12-layouts --project=kiosk-portrait-light
 *
 *   any local stack with a demo family, e.g. the dev stack's DEMO01 (no real data):
 *     BASE_URL=http://localhost:3000 KINBOARD_JOIN_CODE=DEMO01 KINBOARD_DB_CONTAINER=kbfresh-db \
 *       KINBOARD_DB_USER=supabase_admin npm run capture -- 12-layouts --project=kiosk-portrait
 *
 * Environment:
 *   BASE_URL                the app (playwright.config.ts; default http://localhost:3201)
 *   KINBOARD_JOIN_CODE      the family's join code (default: read from the demo database)
 *   KINBOARD_DB_CONTAINER   the database container (default kinboard-demo-db)
 *   KINBOARD_DB_USER        its superuser (default postgres)
 *   KINBOARD_SETTINGS_PIN   the family's settings PIN, if it has one
 *
 * The database is used only for what a parent does by hand on the screen
 * itself (marking it a kiosk), the screensaver's timeout for the shot, and the
 * events; everything about layouts goes through the API like the app.
 */

// A dev server compiles each route on its first visit; the editor alone can take a minute.
test.describe.configure({ mode: "serial", timeout: 180_000 });

const BASE = process.env.BASE_URL || "http://localhost:3201";
const CODE = process.env.KINBOARD_JOIN_CODE || getDemoJoinCode();
const DB = process.env.KINBOARD_DB_CONTAINER || "kinboard-demo-db";
const DB_USER = process.env.KINBOARD_DB_USER || "postgres";
const PIN = process.env.KINBOARD_SETTINGS_PIN || "";
/** Joined screens carry this hardware id prefix, so a failed run can be cleaned up by the next. */
const HW = "wiki-layouts-";
const DESK = { width: 1440, height: 900 };
const PORTRAIT = { width: 1080, height: 1920 };

const psql = (sql: string) =>
  execFileSync("docker", ["exec", "-i", DB, "psql", "-U", DB_USER, "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
  }).trim();
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

interface Joined {
  api: APIRequestContext;
  family: Record<string, unknown>;
  device: { id: string } & Record<string, unknown>;
}

let familyId = "";
let laptop: Joined;
let kitchen: Joined;
let hall: Joined;
const layoutIds: string[] = [];
let kitchenLayout = "";
let savedSaver = "";
/** null until read; "" when the family had no defaults. */
let savedDefaults: string | null = null;
let ringing = "";
const eventIds: string[] = [];

async function join(name: string): Promise<Joined> {
  // A session of its own, not the bootstrap's storageState.json (which the
  // project would otherwise load, and which a local stack does not have).
  const api = await pwRequest.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  const res = await api.post("/api/session/join", { data: { joinCode: CODE, deviceName: name, hardwareId: `${HW}${name}` } });
  expect(res.ok(), await res.text()).toBe(true);
  const body = await res.json();
  if (PIN) {
    const unlock = await api.post("/api/pin", { data: { family_id: body.family.id, action: "verify", pin: PIN } });
    expect(unlock.ok(), "KINBOARD_SETTINGS_PIN was not accepted").toBe(true);
  }
  return { api, family: body.family, device: body.device };
}

/** Removes what this spec adds; safe to run when nothing is there. Every step runs, and the first failure is thrown last. */
function cleanUp() {
  if (!familyId) return;
  const errors: unknown[] = [];
  const step = (sql: string) => {
    try { psql(sql); } catch (e) { errors.push(e); }
  };
  step(`BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM devices WHERE hardware_id LIKE '${HW}%' AND family_id = ${q(familyId)};
    COMMIT;`);
  if (eventIds.length) {
    step(`BEGIN; SET LOCAL session_replication_role = replica;
      DELETE FROM events WHERE id IN (${eventIds.map(q).join(",")});
      COMMIT;`);
  }
  step(`DELETE FROM layouts WHERE family_id = ${q(familyId)} AND name IN ('Küche hochkant', 'Flur quer', 'Küche quer')`);
  // The defaults as they were before this spec set them (none: no row).
  if (savedDefaults !== null) {
    step(savedDefaults
      ? `UPDATE settings SET value = ${q(savedDefaults)}::jsonb WHERE family_id = ${q(familyId)} AND key = 'layout_defaults'`
      : `DELETE FROM settings WHERE family_id = ${q(familyId)} AND key = 'layout_defaults'`);
  }
  if (errors.length) throw errors[0];
}

/** A browser that is one of the joined devices: its session plus the client's stored state, German UI. */
async function open(browser: Browser, who: Joined, path: string, viewport: { width: number; height: number }, kiosk = false): Promise<Page> {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    serviceWorkers: "block",
    reducedMotion: "reduce",
    locale: "de-DE",
    storageState: await who.api.storageState(),
  });
  await ctx.addCookies([
    {
      name: "family-calendar-storage",
      value: encodeURIComponent(JSON.stringify({ state: { family: who.family, device: { ...who.device, is_kiosk: kiosk } }, version: 0 })),
      url: BASE,
    },
    { name: "NEXT_LOCALE", value: "de", url: BASE },
  ]);
  const page = await ctx.newPage();
  await stub(page);
  await setTheme(page, kiosk ? "dark" : SCREENSHOT_THEME);
  await killAnimations(page);
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kinboard_settings_unlock", "unlocked"); } catch { /* ignore */ }
    // The dev server's indicator is not part of the app.
    const hide = () => {
      const el = document.createElement("style");
      el.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(el);
    };
    if (document.head) hide();
    else document.addEventListener("DOMContentLoaded", hide);
  });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  return page;
}

/** Believable weather and news, so the widgets show what a family's would. */
async function stub(page: Page) {
  const now = Date.now();
  const slot = 3 * 3600e3;
  const hourly = Array.from({ length: 8 }, (_, i) => {
    const at = Math.floor(now / slot) * slot + (i + 1) * slot;
    const d = new Date(at);
    const cond = ["Clouds", "Rain", "Clouds", "Clear", "Clear", "Clouds", "Rain", "Clouds"][i];
    return {
      time: `${String(d.getHours()).padStart(2, "0")}:00`, temp: [6, 7, 5, 3, 2, 4, 6, 7][i], condition: cond, conditionMain: cond,
      conditionIcon: cond === "Rain" ? "10d" : cond === "Clear" ? "01d" : "03d", precipProbability: [10, 70, 30, 0, 0, 10, 60, 20][i], windSpeed: 12, at,
    };
  });
  await page.route(/\/api\/weather\/forecast/, (r) =>
    r.fulfill({ json: { location: "Hamburg", coords: { lat: 53.55, lon: 10 }, timezone: 3600, daily: [], hourly, units: "metric" } }));
  await page.route(/\/api\/weather(\?|$)/, (r) =>
    r.fulfill({ json: { temp: 6, feelsLike: 3, condition: "Bewölkt", conditionMain: "Clouds", conditionIcon: "03d", humidity: 80, windSpeed: 14, location: "Hamburg", high: 8, low: 2, visibility: 9000, sunrise: "07:48", sunset: "16:12", timezone: 3600 } }));
  const news = [
    ["Neue Radwege in der Innenstadt sollen bis zum Frühjahr fertig sein", "Lokal"],
    ["Stadtbibliothek verlängert Öffnungszeiten am Samstag", "Kultur"],
    ["Weihnachtsmarkt öffnet eine Woche früher", "Lokal"],
    ["Wetterdienst erwartet ein mildes Wochenende", "Wetter"],
    ["Schwimmbad im Stadtpark öffnet nach der Sanierung wieder", "Lokal"],
  ].map(([title, category], i) => ({
    title, link: `https://example.org/news/${i}`, pubDate: new Date(now - (i + 1) * 40 * 60e3).toUTCString(),
    description: title, category, source: "demo", sourceName: "Stadtanzeiger",
  }));
  await page.route(/\/api\/news\?/, (r) => r.fulfill({ json: { news } }));
  await page.route(/\/api\/homeassistant\//, (r) => r.fulfill({ json: { entities: [] } }));
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  familyId = psql(`SELECT id FROM families WHERE join_code = ${q(CODE)}`);
  expect(familyId, `no family with join code ${CODE}`).not.toBe("");
  cleanUp();
  savedDefaults = psql(`SELECT value::text FROM settings WHERE family_id = ${q(familyId)} AND key = 'layout_defaults'`);

  laptop = await join("Laptop");
  kitchen = await join("Küche");
  hall = await join("Flur");
  psql(`UPDATE devices SET is_kiosk = true WHERE id IN (${q(kitchen.device.id)}, ${q(hall.device.id)})`);
  // Each wall screen reports its size, as it does on its check-in.
  for (const [who, w, h] of [[kitchen, 1080, 1920], [hall, 1920, 1080]] as const) {
    const res = await who.api.post("/api/screen", { data: { viewportWidth: w, viewportHeight: h, screenWidth: w, screenHeight: h, pixelRatio: 1 } });
    expect(res.ok(), await res.text()).toBe(true);
  }

  const create = async (name: string, width: number, height: number) => {
    const res = await laptop.api.post("/api/layouts", { data: { name, width, height, from: "builtin" } });
    expect(res.status(), await res.text()).toBe(201);
    const id = (await res.json()).layout.id as string;
    layoutIds.push(id);
    return id;
  };
  kitchenLayout = await create("Küche hochkant", 1080, 1920);
  const hallLayout = await create("Flur quer", 1920, 1080);
  // The built-in arrangement, made a family's own: the clock larger and the
  // date beside it, the events wider.
  const kitchenRow = await (await laptop.api.get("/api/layouts")).json();
  const k = kitchenRow.layouts.find((l: { id: string }) => l.id === kitchenLayout);
  const items = (k.screensaver as Array<{ widget: string; text: string }>).map((i) =>
    i.widget === "clock" || i.widget === "events" ? { ...i, text: "L" } : i);
  const patched = await laptop.api.patch(`/api/layouts/${kitchenLayout}`, { data: { screensaver: items, updated_at: k.updated_at } });
  expect(patched.status(), await patched.text()).toBe(200);

  for (const [who, id] of [[kitchen, kitchenLayout], [hall, hallLayout]] as const) {
    const res = await laptop.api.put(`/api/devices/${who.device.id}/layout`, { data: { layout_id: id } });
    expect(res.status(), await res.text()).toBe(200);
  }
  const defaults = await laptop.api.put("/api/layouts/defaults", { data: { portrait: kitchenLayout, landscape: hallLayout } });
  expect(defaults.status(), await defaults.text()).toBe(200);

  // Events of the coming days, so the lists have something to show.
  const calendar = psql(`SELECT id FROM calendars WHERE family_id = ${q(familyId)} ORDER BY created_at LIMIT 1`);
  if (calendar) {
    const out = psql(`INSERT INTO events (calendar_id, title, start_at, end_at) VALUES
      (${q(calendar)}, 'Fußballtraining', date_trunc('day', now()) + interval '1 day 16 hours', date_trunc('day', now()) + interval '1 day 17 hours 30 minutes'),
      (${q(calendar)}, 'Zahnarzt Kontrolle', date_trunc('day', now()) + interval '2 days 9 hours', date_trunc('day', now()) + interval '2 days 10 hours'),
      (${q(calendar)}, 'Elternabend Klasse 3b', date_trunc('day', now()) + interval '3 days 19 hours', date_trunc('day', now()) + interval '3 days 21 hours'),
      (${q(calendar)}, 'Schwimmkurs', date_trunc('day', now()) + interval '5 days 15 hours', date_trunc('day', now()) + interval '5 days 16 hours')
      RETURNING id`);
    eventIds.push(...out.split("\n").filter((l) => /^[0-9a-f-]{36}$/.test(l)));
  }

  // The screensaver within two seconds; a timer that has run out keeps it
  // away, so those are dismissed for the shot and put back afterwards.
  savedSaver = psql(`SELECT value::text FROM settings WHERE family_id = ${q(familyId)} AND key = 'screensaver'`);
  ringing = psql(`SELECT string_agg(id::text, ',') FROM timers WHERE family_id = ${q(familyId)} AND dismissed_at IS NULL AND paused_at IS NULL
    AND started_at + (duration_seconds + COALESCE(paused_seconds, 0)) * interval '1 second' < now() + interval '1 hour'`);
});

test.afterAll(async () => {
  for (const id of layoutIds) await laptop?.api.delete(`/api/layouts/${id}`).catch(() => {});
  if (ringing) psql(`UPDATE timers SET dismissed_at = NULL WHERE id IN (${ringing.split(",").map(q).join(",")})`);
  cleanUp();
  for (const who of [laptop, kitchen, hall]) await who?.api.dispose();
});

test("editor → layouts-editor.png", async ({ browser }) => {
  const page = await open(browser, laptop, `/settings/layouts/${kitchenLayout}`, DESK);
  await expect(page.getByTestId("editor-canvas")).toBeVisible({ timeout: 60_000 });
  await waitForReady(page);
  await page.locator("[data-editor-item=events]").click();
  await expect(page.getByTestId("inspector")).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  await snap(page, "layouts-editor");
  await page.context().close();
});

test("Settings → Layouts → settings-layouts.png", async ({ browser }) => {
  const page = await open(browser, laptop, "/settings/layouts", DESK);
  await expect(page.getByTestId("layouts-list")).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });
  await waitForReady(page);
  await snap(page, "settings-layouts");
  await page.context().close();
});

test("Settings → Devices → settings-devices-layout.png", async ({ browser }) => {
  const page = await open(browser, laptop, "/settings/devices", DESK);
  const row = page.locator(`[data-device-id="${kitchen.device.id}"]`);
  await expect(row.getByTestId("device-layout")).toBeVisible({ timeout: 60_000 });
  await waitForReady(page);
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  const pad = 16;
  await page.screenshot({
    path: snapPath("settings-devices-layout"),
    clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad },
  });
  await page.context().close();
});

test("designed screensaver → screensaver-designed.png", async ({ browser }) => {
  psql(`INSERT INTO settings (family_id, key, value) VALUES (${q(familyId)}, 'screensaver', ${q(JSON.stringify({ ...(savedSaver ? JSON.parse(savedSaver) : {}), screensaverTimeout: 2, showNews: true, showForecast: true, weatherEffects: false }))}::jsonb)
    ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value`);
  if (ringing) psql(`UPDATE timers SET dismissed_at = now() WHERE id IN (${ringing.split(",").map(q).join(",")})`);
  try {
    const page = await open(browser, kitchen, "/", PORTRAIT, true);
    await page.waitForSelector("[data-layout-item=clock]", { timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(3000);
    await snap(page, "screensaver-designed");
    await page.context().close();
  } finally {
    if (savedSaver) psql(`UPDATE settings SET value = ${q(savedSaver)}::jsonb WHERE family_id = ${q(familyId)} AND key = 'screensaver'`);
    else psql(`DELETE FROM settings WHERE family_id = ${q(familyId)} AND key = 'screensaver'`);
  }
});

test("a copy for 1920×1080 → layouts-copy-landscape.png", async ({ browser }) => {
  const page = await open(browser, laptop, `/settings/layouts/${kitchenLayout}`, DESK);
  await expect(page.getByTestId("editor-canvas")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("screen-picker").click();
  await page.getByRole("option", { name: /Full HD quer – 1920×1080/ }).click();
  await expect(page.getByTestId("preview-readonly")).toBeVisible();
  await page.getByTestId("editor-copy").click();
  await page.getByTestId("copy-name").fill("Küche quer");
  await page.getByTestId("copy-create").click();
  await page.waitForURL((u) => /\/settings\/layouts\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.endsWith(kitchenLayout), { timeout: 30_000 });
  layoutIds.push(page.url().split("/").pop()!);
  await expect(page.getByTestId("editor-canvas")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-width", "1920");
  // The copy names what it left out (the birthdays, for the built-in portrait).
  await expect(page.getByTestId("editor-copy-dropped")).toBeVisible({ timeout: 30_000 });
  await waitForReady(page);
  await page.waitForTimeout(1500);
  await snap(page, "layouts-copy-landscape");
  await page.context().close();
});

/** Where snap() would put an image of this name, for a clipped shot. */
function snapPath(name: string): string {
  const themed = SCREENSHOT_THEME === "light" ? `${name}-light` : name;
  return new URL(`../../images/${themed}.png`, import.meta.url).pathname;
}
