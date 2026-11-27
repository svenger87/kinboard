import { test, expect, type Browser, type BrowserContext, type ConsoleMessage, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { joinFamilyViaUI } from "./helpers";

/**
 * The browser half of scripts/rigs/test-migration-aio.sh: what a household
 * sees while it moves Kinboard from a compose install to the all-in-one image
 * (RFC-024 §4.4). It needs a throwaway stack, so it is skipped unless the rig
 * sets KBMIG_PHASE and KBMIG_BASE_URL (the fast suite never does):
 *
 *   onboard   an empty install: a new family through /join and every first-run
 *             step (the PIN where the version has that step), a todo, a
 *             shopping item and a note typed in, a photo uploaded, a second
 *             device joined with the code, and a change on one screen arriving
 *             on the other. The two devices' cookies go to KBMIG_STATE_DIR, so
 *             the verify phase can open the moved install as those devices.
// Service workers stay on, as in a real browser: nothing here routes a request.
 *   verify    after the move (or a restart): the two devices opened with their
 *             old cookies (signed in, or back on /join: written to
 *             sessions-<browser>.json, and required by KBMIG_EXPECT_SESSIONS=kept),
 *             what was typed in still there, the join code letting a new
 *             device in, a live change between two devices, the PIN.
 *   smoke     every page of the app, with zero console errors.
 *
 * Device names are claude-mig-*, so the rig can find and remove them.
 */

const PHASE = process.env.KBMIG_PHASE ?? "";
const BASE = process.env.KBMIG_BASE_URL ?? "";
const STATE = process.env.KBMIG_STATE_DIR ?? "";
const LABEL = process.env.KBMIG_LABEL ?? "mig";
// Empty for a copy of a real household, whose PIN this rig does not know.
const PIN = process.env.KBMIG_PIN ?? "2468";

test.skip(!PHASE || !BASE || !STATE, "needs KBMIG_PHASE, KBMIG_BASE_URL and KBMIG_STATE_DIR (scripts/rigs/test-migration-aio.sh)");
test.use({ baseURL: BASE || undefined, locale: "en-US", timezoneId: "Europe/Berlin" });
test.describe.configure({ mode: "serial" });

// todo, item and note: what the onboarding typed in (absent for a household's copy).
type Family = { id: string; code: string; name: string; todo?: string; item?: string; note?: string; itemOffline?: boolean };

const familyFile = () => join(STATE, `family-${LABEL}.json`);
const deviceFile = (n: number, browserName: string) => join(STATE, `device-${LABEL}-${browserName}-${n}.json`);

/* -------------------------------------------------------------- console */

// Kept short on purpose: every entry is a message decided to be harmless.
const IGNORED = [/Download the React DevTools/, /\[HMR\]/, /\[Fast Refresh\]/];
// WebKit reports a request of the page's own origin that a navigation
// cancels (a route prefetch, `?_rsc=`, or a slow widget's /api call) as
// "… due to access control checks", a CORS-like wording for an abort. Counted
// apart (abortedPrefetches in the smoke's numbers), never hidden: the same
// message for another origin, and every other error, still fails.
const BASE_HOST = BASE ? new URL(BASE).host : "";
const ABORTED_PREFETCH = { test: (t: string) => !!BASE_HOST && t.includes(`/${BASE_HOST}/`) && / due to access control checks\.?$/.test(t.trim()) };
let abortedPrefetches = 0;
// Chromium cancels the requests in flight when the host's network
// interfaces change (a Docker network created or removed on the same host):
// net::ERR_NETWORK_CHANGED. The machine's doing, not the app's; counted apart.
const NETWORK_CHANGED = /net::ERR_NETWORK_CHANGED/;
let networkChanged = 0;
// A household's copy runs with every outbound connection blocked
// (KBMIG_EGRESS_BLOCKED=1): the routes that relay its integrations (Home
// Assistant, Immich, weather…) then answer 5xx. Counted apart, only then.
const EGRESS_BLOCKED = process.env.KBMIG_EGRESS_BLOCKED === "1";
const UPSTREAM = /status of 5\d\d .*\/api\/(homeassistant|immich|weather|news|stonks|tesla|energy|cameras|media|bring|google|caldav|ics|photos|holidays|unsplash|calendars?)\b/;
let upstreamBlocked = 0;
// A picture or file the household's data points at on someone else's site,
// gone there (a 404 from that site): the data's, not the app's. Counted apart.
let externalResource = 0;
// The all-in-one image has no go2rtc inside; a camera that streams through it
// reports "WebRTC error" until GO2RTC_URL points at one (KBMIG_NO_GO2RTC=1).
const NO_GO2RTC = process.env.KBMIG_NO_GO2RTC === "1";
let webrtcWithoutGo2rtc = 0;
/** A console message reduced to its kind: no ids, no query, no quoted text. */
function redact(text: string): string {
  return text
    .replace(/https?:\/\/([^/\s)]+)/g, (_m, host: string) => (host === BASE_HOST ? "[this install]" : "[another site]"))
    .replace(/\/[^/\s)?]+\.(jpe?g|png|webp|gif|avif|svg|heic)\b/gi, "/<file>")
    .replace(/\?[^\s)]*/g, "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/(["'“„])[^"'”“]*["'”]/g, "<text>")
    .slice(0, 160);
}
type Entry = { page: string; text: string };
function captureErrors(page: Page, out: Entry[] = []): Entry[] {
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() !== "error" || IGNORED.some((p) => p.test(m.text()))) return;
    const loc = m.location();
    if (ABORTED_PREFETCH.test(m.text())) { abortedPrefetches++; return; }
    if (NETWORK_CHANGED.test(m.text())) { networkChanged++; return; }
    if (EGRESS_BLOCKED && UPSTREAM.test(`${m.text()} ${loc.url ?? ""}`)) { upstreamBlocked++; return; }
    if (/^Failed to load resource/.test(m.text()) && loc.url && BASE_HOST && new URL(loc.url).host !== BASE_HOST) { externalResource++; return; }
    if (NO_GO2RTC && /^WebRTC error/.test(m.text())) { webrtcWithoutGo2rtc++; return; }
    out.push({ page: new URL(page.url()).pathname, text: `${m.text()}${loc.url ? ` (${loc.url})` : ""}` });
  });
  page.on("pageerror", (e) => {
    if (ABORTED_PREFETCH.test(e.message)) abortedPrefetches++;
    else out.push({ page: new URL(page.url()).pathname, text: `pageerror: ${e.message}` });
  });
  return out;
}

/* ---------------------------------------------------------------- steps */

/**
 * Letters only: the shopping list reads "…8l" at the end of an item as
 * 8 litres (and the item's text then no longer matches).
 */
const letters = (s: string) => s.replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)]);

async function newContext(browser: Browser, storageState?: string): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: BASE,
    locale: "en-US",
    timezoneId: "Europe/Berlin",
    // KBMIG_BLOCK_SW=1: without Kinboard's service worker, to tell its doing from the app's.
    ...(process.env.KBMIG_BLOCK_SW === "1" ? { serviceWorkers: "block" as const } : {}),
    ...(storageState ? { storageState } : {}),
  });
}

/** The app re-navigates to the same URL about 2 s after a load (#378); WebKit collides with the next goto. */
async function settle(page: Page) {
  await page.waitForTimeout(2500);
}

/**
 * To a page and staying there. WebKit's late replace-navigation (#378) can
 * take the page back to where it came from after the goto returned, so the
 * path is checked once things settled, and the goto made again if needed.
 */
async function go(page: Page, path: string) {
  const here = () => new URL(page.url()).pathname === path;
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(path, { waitUntil: "domcontentloaded" }).catch((err: Error) => {
      if (!/interrupted by another navigation/.test(err.message)) throw err;
    });
    await settle(page);
    // Seen in WebKit on the production build: the replace for the page loaded
    // before arrives up to ~4 s later and takes it back there. Stay a while.
    let stayed = here();
    for (let i = 0; stayed && i < 8; i++) {
      await page.waitForTimeout(500);
      stayed = here();
    }
    if (stayed) return;
  }
}

/** Every first-run step to Home, whichever version's wizard this is. */
async function walkWizard(page: Page) {
  for (let i = 0; i < 20; i++) {
    await page.waitForLoadState("domcontentloaded");
    const path = new URL(page.url()).pathname;
    if (path === "/") return;
    if (!path.startsWith("/setup")) {
      await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/setup"), { timeout: 60_000 });
      continue;
    }
    if (path === "/setup" ) {
      await page.waitForURL((u) => u.pathname !== "/setup", { timeout: 60_000 });
      continue;
    }
    if (path === "/setup/done") {
      await page.getByRole("link", { name: /go to dashboard/i }).click();
      await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
      return;
    }
    if (path === "/setup/pin") {
      // At a person's pace: a digit every 150 ms, after the step has settled.
      await expect(page.getByTestId("setup-pin-prompt")).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1000);
      await page.locator("#setup-pin-0").click();
      await page.keyboard.type(PIN, { delay: 150 });
      await expect(page.getByTestId("setup-pin-prompt")).toHaveText(/again/i, { timeout: 15_000 });
      await page.waitForTimeout(500);
      await page.locator("#setup-pin-0").click();
      await page.keyboard.type(PIN, { delay: 150 });
      await expect(page.getByTestId("setup-pin-saved")).toBeVisible({ timeout: 15_000 });
    }
    if (path === "/setup/people") {
      const name = page.locator('input[placeholder="Name"]').first();
      if (await name.isVisible().catch(() => false)) await name.fill("Alex");
    }
    if (path === "/setup/push") {
      const contact = page.locator("#instance-push-contact");
      if (await contact.isVisible().catch(() => false)) await contact.fill("claude-mig@example.org");
    }
    const skip = page.getByTestId("wizard-skip").or(page.getByRole("button", { name: /^skip for now$/i }));
    const next = page.getByTestId("wizard-continue").or(page.getByRole("button", { name: /^continue$/i }));
    // Steps that can be skipped are; the others (address, push, region, PIN) continue.
    const target = (await skip.first().isVisible().catch(() => false)) ? skip.first() : next.first();
    await expect(target).toBeEnabled({ timeout: 30_000 });
    await target.click();
    await page.waitForURL((u) => u.pathname !== path, { timeout: 60_000 });
  }
  throw new Error(`the first-run steps never reached Home (at ${page.url()})`);
}

async function familyOf(context: BrowserContext): Promise<{ id: string; code: string; name: string }> {
  const raw = (await context.cookies()).find((c) => c.name === "family-calendar-storage")?.value;
  if (!raw) throw new Error("no family-calendar-storage cookie: not signed in");
  const fam = JSON.parse(decodeURIComponent(raw)).state.family;
  return { id: fam.id, code: fam.join_code, name: fam.name };
}

/**
 * The app shows an item at once and saves it a moment later (about 120 ms in
 * WebKit); a navigation in between cancels the save. Wait for the save, as a
 * person's next tap would.
 */
function saved(page: Page, table: string) {
  return page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith(`/${table}`) && r.status() < 300, { timeout: 30_000 });
}

async function quickAddTodo(page: Page, title: string) {
  await go(page, "/todos");
  const box = page.getByRole("textbox", { name: /quick add task/i });
  await expect(box).toBeVisible({ timeout: 30_000 });
  await box.fill(title);
  const done = saved(page, "todos");
  await box.press("Enter");
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 });
  await done;
}

async function signedIn(page: Page): Promise<boolean> {
  await go(page, "/todos");
  await page.waitForTimeout(3000);
  return !new URL(page.url()).pathname.startsWith("/join");
}

/* ---------------------------------------------------------------- tests */

test("onboard: a new family on an empty install, as a household does it", async ({ browser, browserName }) => {
  test.skip(PHASE !== "onboard");
  test.setTimeout(600_000);
  mkdirSync(STATE, { recursive: true });
  const c1 = await newContext(browser);
  const p1 = await c1.newPage();
  const errors = captureErrors(p1);

  await p1.goto("/join", { waitUntil: "domcontentloaded" });
  await expect(p1.locator("#create-family-name")).toBeVisible({ timeout: 90_000 });
  await p1.locator("#create-family-name").fill(`claude-mig-${LABEL}`);
  await p1.locator("#create-device-name").fill(`claude-mig-${LABEL}-${browserName}-1`);
  await p1.getByRole("button", { name: /^create family$/i }).click();
  await p1.waitForURL((u) => !u.pathname.startsWith("/join"), { timeout: 60_000 });
  await walkWizard(p1);
  await settle(p1);
  const fam = await familyOf(c1);

  // A PIN where the first-run steps had none (before 1.18): Settings' own call.
  const pinState = await p1.request.get(`/api/pin?family_id=${fam.id}`).then((r) => r.json()).catch(() => ({}));
  if (!pinState?.hasPin && !pinState?.has_pin && !pinState?.set) {
    const r = await p1.request.post("/api/pin", { data: { family_id: fam.id, action: "set", pin: PIN } });
    expect(r.status(), `setting the PIN: ${await r.text()}`).toBeLessThan(300);
  }

  // Typed in, as a person would.
  const stamp = letters(Date.now().toString(36));
  const todo = `Müll rausbringen ${stamp}`;
  await quickAddTodo(p1, todo);

  // One word: the list reads a trailing token as an amount or a note ("…8l", "…g").
  const item = `Hafermilch${stamp}`;
  await go(p1, "/shopping");
  const shop = p1.getByPlaceholder(/e\.g\. 2kg potatoes/i);
  await expect(shop).toBeVisible({ timeout: 30_000 });
  await shop.fill(item);
  const itemSaved = saved(p1, "shopping_items").then(() => true, () => false);
  const shopRequests: string[] = [];
  const onReq = (r: { method(): string; url(): string }) => { if (r.method() !== "GET") shopRequests.push(`${r.method()} ${new URL(r.url()).pathname}`); };
  p1.on("request", onReq);
  const onLine = await p1.evaluate(() => navigator.onLine);
  await shop.press("Enter");
  await expect(p1.getByText(item).first()).toBeVisible({ timeout: 20_000 });
  const itemWasSaved = await itemSaved;
  p1.off("request", onReq);
  // WebKit on a Linux test host can report navigator.onLine false (it has
  // no network monitor there to ask). The list then does what it does
  // offline: keeps the item on the device, queued until the browser says it
  // is online again, which here it never does. That is the offline queue
  // working, not the move; recorded as itemOffline, and the item is not
  // looked for after the move. With the browser online, it must be saved.
  if (onLine) expect(itemWasSaved, `the shopping item reached the server (requests after Enter: ${shopRequests.join(", ") || "none"})`).toBe(true);
  const itemOffline = !onLine;

  const note = `WLAN-Passwort hängt am Kühlschrank ${stamp}`;
  await go(p1, "/notes");
  await p1.getByRole("button", { name: /^new note$/i }).first().click();
  const noteBox = p1.getByRole("textbox", { name: /^new note$/i });
  await expect(noteBox).toBeVisible({ timeout: 30_000 });
  await noteBox.fill(note);
  const noteSaved = saved(p1, "notes");
  await p1.getByRole("button", { name: /^save$/i }).first().click();
  await noteSaved;
  await expect(p1.getByText(note).first()).toBeVisible({ timeout: 20_000 });

  // A photo, through the photo library's own upload field.
  await go(p1, "/photos");
  const png = readFileSync(join(__dirname, "../public/icons/icon-512.png"));
  const input = p1.locator('input[type="file"]').first();
  if ((await input.count()) > 0) {
    const uploaded = p1.waitForResponse((r) => r.url().includes("/api/photos/upload"), { timeout: 30_000 });
    await input.setInputFiles({ name: `claude-mig-${stamp}.png`, mimeType: "image/png", buffer: png });
    const res = await uploaded;
    expect(res.status(), `photo upload: ${await res.text().catch(() => "")}`).toBeLessThan(300);
  } else {
    const res = await p1.request.post("/api/photos/upload", {
      multipart: { family_id: fam.id, photo: { name: `claude-mig-${stamp}.png`, mimeType: "image/png", buffer: png } },
    });
    expect(res.status(), `photo upload (no field on /photos): ${await res.text()}`).toBeLessThan(300);
  }

  // A second device joins with the code, and sees a change made on the first.
  const c2 = await newContext(browser);
  const p2 = await c2.newPage();
  await joinFamilyViaUI(p2, fam.code, `claude-mig-${LABEL}-${browserName}-2`);
  await go(p2, "/todos");
  await expect(p2.getByText(todo).first()).toBeVisible({ timeout: 30_000 });
  const live = `Live ${stamp}`;
  await quickAddTodo(p1, live);
  await expect(p2.getByText(live).first(), "a todo added on device 1 arrives on device 2 without a reload").toBeVisible({ timeout: 30_000 });

  await c1.storageState({ path: deviceFile(1, browserName) });
  await c2.storageState({ path: deviceFile(2, browserName) });
  writeFileSync(familyFile(), JSON.stringify({ ...fam, todo, item: itemOffline ? undefined : item, note, itemOffline } satisfies Family, null, 1));
  expect(errors.map((e) => `${e.page}: ${e.text}`), "console errors while onboarding").toEqual([]);
  await c1.close();
  await c2.close();
});

test("verify: the household after the move", async ({ browser, browserName }) => {
  test.skip(PHASE !== "verify");
  test.setTimeout(600_000);
  const fam: Family = JSON.parse(readFileSync(familyFile(), "utf8"));
  const from = process.env.KBMIG_DEVICES_FROM ?? browserName;

  // 1. The screens that were signed in before the move, opened with their old cookies.
  const sessions: Record<string, boolean> = {};
  const contexts: BrowserContext[] = [];
  for (const n of [1, 2]) {
    const file = join(STATE, `device-${LABEL}-${from}-${n}.json`);
    if (!existsSync(file)) continue;
    const c = await newContext(browser, file);
    contexts.push(c);
    sessions[`device${n}`] = await signedIn(await c.newPage());
  }
  writeFileSync(join(STATE, `sessions-${LABEL}-${browserName}.json`), JSON.stringify(sessions));
  if (process.env.KBMIG_EXPECT_SESSIONS === "kept") {
    expect(sessions, "devices signed in before the move are still signed in").toEqual({ device1: true, device2: true });
  }

  // 2. A new device with the family's code, and what was typed in before the move.
  const c3 = await newContext(browser);
  const p3 = await c3.newPage();
  const errors = captureErrors(p3);
  await joinFamilyViaUI(p3, fam.code, `claude-mig-${LABEL}-${browserName}-after`);
  expect((await familyOf(c3)).id, "the join code leads to the same family").toBe(fam.id);
  // Each in a page of its own: WebKit, sent from /todos to /shopping by two
  // quick gotos, sometimes kept showing the tasks under the /shopping URL (a
  // harness race: the same navigation at a person's pace, or from a fresh
  // page, shows the list every time).
  for (const [path, text] of [["/todos", fam.todo], ["/shopping", fam.item], ["/notes", fam.note]] as const) {
    if (!text) continue;
    const pg = await c3.newPage();
    captureErrors(pg, errors);
    await go(pg, path);
    await expect(pg.getByText(text).first(), `${path} after the move`).toBeVisible({ timeout: 30_000 });
    await pg.close();
  }

  // 3. The PIN still opens Settings.
  if (PIN) {
    const pin = await p3.request.post("/api/pin", { data: { family_id: fam.id, action: "verify", pin: PIN } });
    expect(await pin.json(), "the PIN set before the move").toMatchObject({ valid: true });
  }

  // 4. Live updates between two devices on the moved install.
  const c4 = await newContext(browser);
  const p4 = await c4.newPage();
  await joinFamilyViaUI(p4, fam.code, `claude-mig-${LABEL}-${browserName}-after-2`);
  await go(p4, "/todos");
  const live = `After the move ${letters(Date.now().toString(36))}`;
  await quickAddTodo(p3, live);
  await expect(p4.getByText(live).first(), "a change on one device arrives on the other").toBeVisible({ timeout: 30_000 });

  expect(errors.map((e) => `${e.page}: ${e.text}`), "console errors").toEqual([]);
  for (const c of [...contexts, c3, c4]) await c.close();
});

// Every page a household can open. Not /join and /setup (their own phases), not /dev.
const PAGES = [
  "/", "/birthdays", "/calendar", "/cameras", "/einkaufen", "/energy", "/home-automation", "/meals", "/media", "/news",
  "/notes", "/photos", "/pocket-money", "/recipes", "/recipes/new", "/recipes/search", "/rewards", "/schedule",
  "/shopping", "/stonks", "/tesla", "/todos", "/vehicles",
  "/settings", "/settings/bring", "/settings/caldav", "/settings/calendar", "/settings/cameras", "/settings/catalogue",
  "/settings/creatures", "/settings/devices", "/settings/energy", "/settings/festival-gallery", "/settings/google",
  "/settings/hints", "/settings/holidays", "/settings/homeassistant", "/settings/homeassistant/dashboards",
  "/settings/homeassistant/energy", "/settings/homeassistant/rooms", "/settings/ics", "/settings/integrations",
  "/settings/language", "/settings/layouts", "/settings/local-calendars", "/settings/media-players",
  "/settings/navigation", "/settings/news", "/settings/notifications", "/settings/people", "/settings/photos",
  "/settings/plugins", "/settings/pocket-money", "/settings/recycle-bin", "/settings/schedule",
  "/settings/screensaver", "/settings/stonks", "/settings/task-log", "/settings/tesla", "/settings/theme",
  "/settings/vehicles", "/settings/vehicles/new", "/settings/weather", "/settings/widgets",
];

test("smoke: every page, no console errors", async ({ browser, browserName }) => {
  test.skip(PHASE !== "smoke");
  test.setTimeout(900_000);
  const code = process.env.KBMIG_FAMILY_CODE || (JSON.parse(readFileSync(familyFile(), "utf8")) as Family).code;
  const c = await newContext(browser);
  const page = await c.newPage();
  const errors = captureErrors(page);
  await joinFamilyViaUI(page, code, `claude-mig-${LABEL}-${browserName}-smoke`);
  // The settings pages sit behind the PIN; unlock once, as a parent would.
  const fam = await familyOf(c);
  if (PIN) await page.request.post("/api/pin", { data: { family_id: fam.id, action: "verify", pin: PIN } });
  const bad: string[] = [];
  for (const path of PAGES) {
    const res = await page.goto(path, { waitUntil: "domcontentloaded" }).catch((err: Error) => {
      if (/interrupted by another navigation/.test(err.message)) return null;
      throw err;
    });
    if (res && res.status() >= 400) bad.push(`${path}: HTTP ${res.status()}`);
    await page.waitForTimeout(browserName === "webkit" ? 3000 : 2000);
    if (new URL(page.url()).pathname.startsWith("/join")) bad.push(`${path}: signed out (sent to /join)`);
  }
  writeFileSync(
    join(STATE, `smoke-${LABEL}-${browserName}.json`),
    JSON.stringify({
      pages: PAGES.length, errors: errors.length, bad: bad.length, abortedPrefetches, networkChanged, upstreamBlocked, externalResource, webrtcWithoutGo2rtc,
      // What kind, never what: the page, the request's path with ids and query taken out, and the status.
      kinds: [...new Set(errors.map((e) => `${e.page}: ${redact(e.text)}`))].sort(),
    }),
  );
  const found = [...bad, ...errors.map((e) => `${e.page}: ${e.text}`)];
  expect(found, `${PAGES.length} pages`).toEqual([]);
  await c.close();
});
