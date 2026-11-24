#!/usr/bin/env node
/**
 * Screen matrix: Home and the screensaver on every screen Kinboard is hung
 * on, in every language, screenshotted and measured.
 *
 * Why: a layout measured at one size can be wrong at another. #468 looked
 * right at 1080x1920 and was far too big on a wall screen running Windows at
 * 150%. This runs the whole list every time, with the same demo data, and
 * checks what can be measured instead of leaving it to the eye:
 *
 *   edges     each screensaver block's distance from the screen edges it
 *             sits against (expected: EDGE px)
 *   overlap   two blocks covering each other
 *   overflow  the page wider (or the screensaver taller) than the screen
 *   offscreen a block reaching past the screen
 *   clipped   text cut off without an ellipsis (an ellipsis is deliberate)
 *   clock     on portrait, the time not as wide as the cards above it
 *
 * Known findings (understood, not regressions of a change): the phone screen
 * (390x844) screensaver is overfull, news + weather + events + clock do not
 * fit; this predates the matrix. Its rows report overlap/overflow until the
 * phone layout is designed. Landscape at 1280x720 (1920x1080 at 150%): weather
 * and events overlap 12px on the normal screensaver and 152px with large
 * details, events 36px from the top edge; tablet landscape 1280x800 with large
 * details: weather and events overlap 84px. Fix pending in a follow-up PR.
 * Layout shots: at a widget's minimum box, portrait lists show fewer than two
 * entries ("list" findings; minimums are in cells, and portrait cells are
 * small next to the text: 60px at 1080 wide, 30px at 720, for 20px and 13px
 * text), and the clock's content is 2-5px taller than its box (the display
 * font's line box; the digits are not cut).
 *
 * The saver-layout view (opt-in) shows designed screensavers instead: it
 * creates fixture layouts through the API (behind the settings PIN when the
 * family has one, --pin), assigns them to the matrix device and removes them
 * afterwards. On every screen the built-in arrangement redrawn as a layout for
 * the screen's orientation ("saver-layout"); on portrait screens also one
 * layout with every screensaver widget at its minimum size
 * ("saver-layout-min"). It checks, beyond the list above:
 *
 *   edges     no box closer than EDGE px to a screen edge; the outermost boxes
 *             sit at the grid's offsets (48px, or more where rows leave room)
 *   offgrid   a box not on the screen's grid
 *   overflow  a widget's content larger than its box
 *   list      a list whose last entry is cut off, or entries missing without
 *             a "+n" line
 *   layout    a screen at least 600px wide (with 6 rows) that shows the
 *             built-in screensaver, or a narrower one that shows the layout
 *
 * The home-layout view (opt-in, RFC-022) does the same for Home: on every
 * screen a layout whose Home is builtInHome(w, h) (lib/layouts/built-in.ts)
 * for that screen's grid area (the screen less the navigation bar, measured
 * on the built-in Home first), created through the API and assigned to the
 * matrix device, which is not a kiosk: an assigned layout applies to any
 * screen at least 600px wide. Narrower screens get a layout too and must keep
 * the built-in Home. Its checks are the saver-layout ones measured against the
 * grid area instead of the whole screen, plus:
 *
 *   overflow  the page taller than the screen (a designed Home never scrolls)
 *   touch     a tap target inside a box smaller than 48px either way
 *   layout    the designed Home missing on a screen that holds a grid, or
 *             shown on one under 600px wide
 *
 * The views home, saver and saver-large never assign a layout, so their shots
 * are the built-in Home and screensavers whatever this view does.
 *
 * Output: one PNG per shot, report.json, and index.html, a contact sheet
 * with every shot and its findings side by side.
 *
 * Needs a running stack and dev server (or a build), and the family's join
 * code (DEMO01 is the demo family with rich data). It joins as its own device,
 * seeds events and birthdays prefixed "matrix-", stubs news and weather, and
 * removes all of it afterwards. Timers that have run out are dismissed for the
 * run (not paused) and un-dismissed afterwards, and the family's screensaver
 * settings are put back as they were.
 *
 * Point it only at a demo or test family: the family's real screens see these
 * changes while it runs (its layout defaults are cleared for the run, so the
 * built-in shots are built-in). The saved state goes to <out>/restore-state.json; on
 * Ctrl-C or kill the script restores it before exiting, and if a run died
 * harder the next run restores from that file first.
 *
 *   node scripts/screen-matrix.mjs --base http://localhost:3157 --code DEMO01
 *   node scripts/screen-matrix.mjs --only portrait-1080 --locales de --views saver-large
 *   node scripts/screen-matrix.mjs --code DEMO01 --views saver,saver-large,saver-layout
 *   node scripts/screen-matrix.mjs --code DEMO01 --views home,home-layout
 *
 * Options:
 *   --base URL        the app (default http://localhost:3157)
 *   --code CODE       family join code (required)
 *   --out DIR         output (default e2e/screen-matrix)
 *   --only a,b        screen ids to run (default all)
 *   --locales a,b     de,en,fr by default
 *   --views a,b       home,saver,saver-large by default; saver-layout and home-layout on request
 *   --pin PIN         the family's settings PIN, if it has one (or $KINBOARD_SETTINGS_PIN)
 *   --db CONTAINER    database container (default $KINBOARD_DB_CONTAINER or kbfresh-db)
 *   --strict          exit 1 when any shot has a finding
 */
import { chromium, request as pwRequest } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The app's own TypeScript, for the built-in Home (home-layout view): jiti is
// already installed (eslint and tailwind load their configs with it).
import createJiti from "jiti";

// ---------------------------------------------------------------- options

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const list = (name, fallback) => (opt(name, null)?.split(",").filter(Boolean) ?? fallback);

const BASE = opt("base", "http://localhost:3157");
const CODE = opt("code", null);
const OUT = resolve(opt("out", "e2e/screen-matrix"));
const DB = opt("db", process.env.KINBOARD_DB_CONTAINER || "kbfresh-db");
const STRICT = args.includes("--strict");
const PIN = opt("pin", process.env.KINBOARD_SETTINGS_PIN || null);
if (!CODE) {
  console.error("--code <family join code> is required");
  process.exit(2);
}

/** The edge distance every screensaver block keeps (#282). */
const EDGE = 48;
const TOLERANCE = 2;

/**
 * Every screen in the list. width/height are the page's CSS pixels, scale the
 * browser's: a 1080x1920 panel at Windows 150% draws pages at 720x1280.
 */
const SCREENS = [
  { id: "portrait-1080", label: "Portrait 1080×1920", width: 1080, height: 1920, scale: 1 },
  { id: "portrait-1080-150", label: "Portrait 1080×1920 @150%", width: 720, height: 1280, scale: 1.5 },
  { id: "landscape-1080", label: "Landscape 1920×1080", width: 1920, height: 1080, scale: 1 },
  { id: "landscape-1080-150", label: "Landscape 1920×1080 @150%", width: 1280, height: 720, scale: 1.5 },
  { id: "tablet-landscape", label: "Tablet landscape 1280×800", width: 1280, height: 800, scale: 1 },
  { id: "tablet-portrait", label: "Tablet portrait 800×1280", width: 800, height: 1280, scale: 1 },
  { id: "phone", label: "Phone 390×844", width: 390, height: 844, scale: 3 },
  { id: "desktop-1440", label: "Desktop 2560×1440", width: 2560, height: 1440, scale: 1 },
];
const VIEWS = ["home", "saver", "saver-large"];
const ALL_VIEWS = [...VIEWS, "saver-layout", "home-layout"];
const LOCALES = ["de", "en", "fr"];

const screens = SCREENS.filter((s) => list("only", null)?.includes(s.id) ?? true);
const locales = list("locales", LOCALES);
const views = list("views", VIEWS);
for (const v of views) {
  if (!ALL_VIEWS.includes(v)) {
    console.error(`unknown view ${v}; one of ${ALL_VIEWS.join(", ")}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------- database

const psql = (sql) =>
  execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "supabase_admin", "-tA", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
  }).trim();
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

const family = psql(`SELECT id FROM families WHERE join_code = ${q(CODE)}`);
if (!family) {
  console.error(`no family with join code ${CODE}`);
  process.exit(2);
}

function putSaver(value, fam = family) {
  psql(`INSERT INTO settings (family_id, key, value) VALUES (${q(fam)}, 'screensaver', ${q(JSON.stringify(value))}::jsonb)
        ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value`);
}

mkdirSync(OUT, { recursive: true });
const STATE_FILE = join(OUT, "restore-state.json");

function putSetting(fam, key, text) {
  if (text) psql(`INSERT INTO settings (family_id, key, value) VALUES (${q(fam)}, ${q(key)}, ${q(text)}::jsonb)
        ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value`);
  else psql(`DELETE FROM settings WHERE family_id = ${q(fam)} AND key = ${q(key)}`);
}

/** Puts one saved state back. Each step is independent; failures are returned. */
function restore({ family: fam, savedSaver, savedDefaults, ringing: ids }) {
  const failures = [];
  const step = (name, fn) => {
    try { fn(); } catch (e) { failures.push(`${name}: ${String(e.message).split("\n")[0]}`); }
  };
  // Soft-delete triggers (birthdays) would leave rows in the recycle bin;
  // these never existed for the family. Scoped to the family.
  step("events", () => psql(`BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM events WHERE title LIKE 'matrix-%' AND calendar_id IN (SELECT id FROM calendars WHERE family_id = ${q(fam)});
    COMMIT;`));
  step("birthdays", () => psql(`BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM birthdays WHERE name LIKE 'matrix-%' AND family_id = ${q(fam)};
    COMMIT;`));
  step("devices", () => psql(`BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM devices WHERE hardware_id LIKE 'matrix-%' AND family_id = ${q(fam)};
    COMMIT;`));
  // The fixture layouts of saver-layout, after the devices they were assigned to.
  step("layouts", () => psql(`DELETE FROM layouts WHERE name LIKE 'matrix-%' AND family_id = ${q(fam)}`));
  // Undefined in a state file written before the layouts existed: leave it.
  if (savedDefaults !== undefined) step("layout defaults", () => putSetting(fam, "layout_defaults", savedDefaults));
  if (ids) step("timers", () => psql(`UPDATE timers SET dismissed_at = NULL WHERE family_id = ${q(fam)} AND id IN (${ids.split(",").map(q).join(",")})`));
  step("screensaver setting", () => {
    if (savedSaver) putSaver(JSON.parse(savedSaver), fam);
    else psql(`DELETE FROM settings WHERE family_id = ${q(fam)} AND key = 'screensaver'`);
  });
  return failures;
}

// A run that was killed without cleaning up left its saved state in the file:
// restore from that first, so this run does not take the polluted state as the original.
if (existsSync(STATE_FILE)) {
  const old = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  console.log(`restoring the state an interrupted run left behind (${STATE_FILE})`);
  const failed = restore(old);
  if (failed.length) {
    console.error(`could not restore: ${failed.join("; ")}`);
    process.exit(2);
  }
  unlinkSync(STATE_FILE);
}

// A ringing timer keeps the screensaver away (lib/screensaver-gate.ts), and a
// timer rings once started_at + duration (+ paused time) has passed, whether
// or not finished_at was ever written: DEMO01's seeded "Pasta" and "Oven"
// timers have no finished_at and ran out long ago, which is why its
// screensaver never started. Every undismissed, unpaused timer that has run
// out, or will within the run, is dismissed and put back afterwards.
const saved = {
  family,
  savedSaver: psql(`SELECT value::text FROM settings WHERE family_id = ${q(family)} AND key = 'screensaver'`),
  // A family default would put a designed layout on the matrix's kiosks.
  savedDefaults: psql(`SELECT value::text FROM settings WHERE family_id = ${q(family)} AND key = 'layout_defaults'`),
  ringing: psql(`SELECT string_agg(id::text, ',') FROM timers
    WHERE family_id = ${q(family)} AND dismissed_at IS NULL AND paused_at IS NULL
      AND started_at + (duration_seconds + COALESCE(paused_seconds, 0)) * interval '1 second' < now() + interval '3 hours'`),
};

/** Events and birthdays every shot shows, relative to now so they are always upcoming. */
function seed() {
  if (saved.savedDefaults) putSetting(family, "layout_defaults", null);
  if (saved.ringing) psql(`UPDATE timers SET dismissed_at = now() WHERE id IN (${saved.ringing.split(",").map(q).join(",")})`);
  const calendar = psql(`SELECT id FROM calendars WHERE family_id = ${q(family)} ORDER BY created_at LIMIT 1`);
  if (calendar) {
    psql(`INSERT INTO events (calendar_id, title, start_at, end_at) VALUES
      (${q(calendar)}, 'matrix-Fußballtraining', now() + interval '1 day 2 hours', now() + interval '1 day 3 hours'),
      (${q(calendar)}, 'matrix-Zahnarzt Kontrolle', now() + interval '2 days', now() + interval '2 days 1 hour'),
      (${q(calendar)}, 'matrix-Elternabend Klasse 3b in der Aula', now() + interval '3 days', now() + interval '3 days 2 hours'),
      (${q(calendar)}, 'matrix-Schwimmkurs', now() + interval '5 days', now() + interval '5 days 1 hour')`);
  }
  psql(`INSERT INTO birthdays (family_id, name, date) VALUES
    (${q(family)}, 'matrix-Oma Gerda', (current_date + 4)),
    (${q(family)}, 'matrix-Jonas', (current_date + 9 - interval '8 years')::date),
    (${q(family)}, 'matrix-Tante Marie-Louise', (current_date + 20))`);
}

let cleanedUp = false;
/** Once: the signal handlers and the finally block both come here. */
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  const failed = restore(saved);
  if (failed.length) console.error(`cleanup incomplete, ${STATE_FILE} kept for the next run:\n  ${failed.join("\n  ")}`);
  else if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
}
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(sig, () => {
    console.error(`\n${sig}: restoring the family's state`);
    cleanup();
    try { writeReport(); } catch { /* nothing measured yet */ }
    process.exit(code);
  });
}

// ---------------------------------------------------------------- stubs

const NOW = Date.now();
const SLOT = 3 * 3600e3;
const hourly = Array.from({ length: 8 }, (_, i) => {
  const at = Math.floor(NOW / SLOT) * SLOT + i * SLOT;
  const cond = ["Clouds", "Rain", "Rain", "Clouds", "Clear", "Clear", "Snow", "Clouds"][i];
  const d = new Date(at);
  return {
    time: `${String(d.getHours()).padStart(2, "0")}:00`,
    temp: [4, 5, 6, 3, 1, -1, 0, 2][i],
    condition: cond,
    conditionMain: cond,
    conditionIcon: i >= 4 ? "01n" : "10d",
    precipProbability: [21, 80, 64, 13, 0, 0, 30, 5][i],
    windSpeed: 12,
    at,
  };
});
const daily = Array.from({ length: 5 }, (_, i) => ({
  date: new Date(NOW + i * 86400e3).toISOString().slice(0, 10),
  dayName: ["Mo", "Di", "Mi", "Do", "Fr"][i],
  tempMax: [7, 9, 5, 4, 8][i],
  tempMin: [1, 2, -1, -2, 0][i],
  condition: "Regen",
  conditionMain: ["Rain", "Clouds", "Snow", "Clear", "Rain"][i],
  conditionIcon: "10d",
  humidity: 80,
  windSpeed: 14,
  precipProbability: [80, 20, 60, 0, 40][i],
  rainAmount: 2,
  snowAmount: 0,
}));
const weather = {
  temp: 4, feelsLike: 0, condition: "Leichter Regen", conditionMain: "Rain", conditionIcon: "10d",
  humidity: 90, windSpeed: 18, location: "Hamburg", high: 7, low: 1, visibility: 8000,
  sunrise: "07:48", sunset: "16:12", timezone: 3600,
};
const news = [
  "Neue Radwege in der Innenstadt sollen bis zum Frühjahr fertig sein",
  "Wetterdienst warnt vor Glätte am Wochenende",
  "Stadtbibliothek verlängert Öffnungszeiten am Samstag",
  "Schulen bekommen neue Tablets für den Unterricht in allen Klassen der Grundschule",
  "Weihnachtsmarkt öffnet eine Woche früher",
  "Hafen meldet Rekord beim Containerumschlag",
].map((title, i) => ({
  title,
  link: `https://example.org/news/${i}`,
  pubDate: new Date(NOW - (i + 1) * 23 * 60e3).toUTCString(),
  description: title,
  category: ["Lokal", "Wetter", "Kultur", "Bildung", "Lokal", "Wirtschaft"][i],
  source: "matrix",
  sourceName: "Matrix",
}));

async function stub(page) {
  await page.route(/\/api\/weather\/forecast/, (r) =>
    r.fulfill({ json: { location: "Hamburg", coords: { lat: 53.55, lon: 10 }, timezone: 3600, daily, hourly, units: "metric" } }));
  await page.route(/\/api\/weather(\?|$)/, (r) => r.fulfill({ json: weather }));
  await page.route(/\/api\/news\?/, (r) => r.fulfill({ json: { news } }));
  // DEMO01 has Home Assistant configured, pointing at a mock that is not
  // running here: the 500s are the environment, not the layout.
  await page.route(/\/api\/homeassistant\//, (r) => r.fulfill({ json: { entities: [] } }));
}

// ---------------------------------------------------------------- layouts

/**
 * Every screensaver widget at its minimum box (lib/layouts/widgets.ts), drawn
 * for 1080x1920: packed at the top, the one-row values on the last row so the
 * bottom edge is measured too. Listed in cells, stored in steps (four to a cell).
 */
const MIN_ITEMS = [
  ["clock", 0, 0, 4, 2], ["forecast", 4, 0, 4, 2], ["birthdays", 8, 0, 4, 2],
  ["events", 0, 2, 4, 3], ["news", 4, 2, 4, 3], ["holidays", 8, 2, 4, 2],
  ["weatherNow", 8, 4, 2, 1], ["photoCount", 10, 4, 1, 1],
  ["lessons", 0, 5, 4, 2], ["energy", 4, 5, 3, 2], ["vehicles", 7, 5, 3, 2],
  ["date", 0, 21, 3, 1], ["nextEvent", 4, 21, 4, 1],
].map(([widget, x, y, w, h]) => ({ id: widget, widget, x: x * 4, y: y * 4, w: w * 4, h: h * 4, text: "M" }));

/**
 * The fixture layouts, created through the API as a parent would: a session of
 * its own, unlocked with the settings PIN when the family has one. Named
 * "matrix-…" so restore() finds them; it deletes them by name.
 */
async function createFixtures() {
  const api = await pwRequest.newContext({ baseURL: BASE });
  try {
    const hw = "matrix-fixtures";
    const joined = await api.post("/api/session/join", { data: { joinCode: CODE, deviceName: hw, hardwareId: hw } });
    if (!joined.ok()) throw new Error(`fixtures: join failed: ${joined.status()} ${await joined.text()}`);
    const familyId = (await joined.json()).family?.id;
    if (PIN) {
      const unlock = await api.post("/api/pin", { data: { family_id: familyId, action: "verify", pin: PIN } });
      if (!unlock.ok()) throw new Error(`fixtures: the PIN was not accepted: ${unlock.status()} ${await unlock.text()}`);
    }
    const create = async (name, width, height, from) => {
      const res = await api.post("/api/layouts", { data: { grid: 48, name, width, height, ...(from ? { from } : {}) } });
      if (res.status() === 403) throw new Error("fixtures: the family has a settings PIN; pass it with --pin");
      if (res.status() !== 201) throw new Error(`fixtures: creating ${name} failed: ${res.status()} ${await res.text()}`);
      return (await res.json()).layout;
    };
    const portrait = await create("matrix-Hochkant", 1080, 1920, "builtin");
    const landscape = await create("matrix-Quer", 1920, 1080, "builtin");
    const min = await create("matrix-Alle Widgets", 1080, 1920);
    const patched = await api.patch(`/api/layouts/${min.id}`, { data: { grid: 48, screensaver: MIN_ITEMS, updated_at: min.updated_at } });
    if (patched.status() !== 200) throw new Error(`fixtures: saving the minimum layout failed: ${patched.status()} ${await patched.text()}`);
    return { portrait: portrait.id, landscape: landscape.id, min: min.id };
  } finally {
    await api.dispose();
  }
}

/** The layout shots of a screen: [file view name, layout id]. */
const layoutShots = (screen, fx) =>
  screen.height > screen.width
    ? [["saver-layout", fx.portrait], ["saver-layout-min", fx.min]]
    : [["saver-layout", fx.landscape]];

/**
 * The designed Home's root (components/layouts/designed-home.tsx); its boxes
 * are LayoutGrid's [data-layout-item], and the root covers the grid area.
 * TODO(RFC-022 step 5, feat/rfc022-designed-home): confirm the test id once
 * step 5 lands.
 */
const DESIGNED_HOME = "[data-testid=designed-home]";

/**
 * A designed Home renders only once every Home widget has a component in a
 * box (missingHomeWidgets() is empty), or in the e2e test mode. This is where
 * the matrix would open that gate for its own browser context.
 * TODO(RFC-022 step 5, feat/rfc022-designed-home): step 5 defines the
 * test-only bypass; switch it on here with exactly its mechanism. Until then
 * nothing is done, so before every widget exists the view reports "layout:
 * expected the designed Home" on each screen that holds a grid.
 */
async function allowDesignedHome(_ctx) {
  return false;
}

/** The app's layout code (TypeScript), loaded on first use. */
let layoutLib = null;
function layoutCode() {
  if (!layoutLib) {
    const jiti = createJiti(fileURLToPath(import.meta.url));
    layoutLib = {
      ...jiti("../src/lib/layouts/built-in.ts"),
      ...jiti("../src/lib/layouts/grid.ts"),
      ...jiti("../src/lib/layouts/validate.ts"),
    };
  }
  return layoutLib;
}

/**
 * The size a Home layout is drawn for on a screen: its grid area. A screen
 * whose area holds no grid (under 600px wide, or too few rows) gets the
 * built-in Home whatever is assigned; it is given a layout of its orientation
 * all the same, so the shot proves it is not drawn.
 */
function homeLayoutSize(screen, navHeight) {
  const area = { width: screen.width, height: screen.height - navHeight };
  if (layoutCode().gridFor(area.width, area.height)) return { ...area, holds: true };
  return { ...(screen.height > screen.width ? { width: 1080, height: 1848 } : { width: 1920, height: 1008 }), holds: false };
}

/** Home layouts made this run, by size: the same size is shared by every locale. */
const homeLayouts = new Map();

// ---------------------------------------------------------------- measuring

/** Runs in the page: boxes and findings for the current view. */
function measure({ view, edge, tolerance, homeRoot }) {
  const W = innerWidth;
  const H = innerHeight;
  // home-layout is measured as Home when the screen draws the built-in one.
  const homeView = view === "home" || view === "home-layout";
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  };
  const findings = [];
  const visible = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0 && r.width > 0 && r.height > 0;
  };

  const doc = document.documentElement;
  if (doc.scrollWidth > W + 1) findings.push({ kind: "overflow", text: `page ${doc.scrollWidth - W}px wider than the screen` });

  // A designed screensaver, when the view asked for one and the screen draws it.
  const layoutRoot = view.startsWith("saver-layout") ? document.querySelector("[data-testid=designed-screensaver]")
    : view === "home-layout" ? document.querySelector(homeRoot) : null;
  const designedHome = !!layoutRoot && view === "home-layout";
  let blocks = [];
  if (designedHome) {
    // Per-child widgets share a widget key; the item id tells them apart.
    blocks = [...layoutRoot.querySelectorAll("[data-layout-item]")].filter(visible).map((el) => ({ name: el.dataset.layoutId || el.dataset.layoutItem, el }));
    if (doc.scrollHeight > H + 1) findings.push({ kind: "overflow", text: `Home scrolls: the page is ${doc.scrollHeight - H}px taller than the screen` });
  } else if (layoutRoot) {
    blocks = [...layoutRoot.querySelectorAll("[data-layout-item]")].filter(visible).map((el) => ({ name: el.dataset.layoutItem, el }));
    const saver = layoutRoot.closest(".fixed");
    if (saver && saver.scrollHeight > H + 1) findings.push({ kind: "overflow", text: `screensaver ${saver.scrollHeight - H}px taller than the screen` });
  } else if (homeView) {
    const grid = document.querySelector(".festival-grid");
    blocks = grid ? [...grid.children].filter((el) => visible(el) && getComputedStyle(el).position !== "fixed").map((el, i) => ({ name: el.querySelector("h2,h3,[data-widget]")?.textContent?.trim()?.slice(0, 24) || `widget ${i + 1}`, el })) : [];
    const hero = document.querySelector(".hero-block");
    if (hero && visible(hero)) blocks.unshift({ name: "hero", el: hero });
  } else {
    blocks = [...document.querySelectorAll("[data-saver-block]")].filter(visible).map((el) => ({ name: el.dataset.saverBlock, el }));
    const saver = document.querySelector("[data-saver-block]")?.closest(".fixed");
    if (saver && saver.scrollHeight > H + 1) findings.push({ kind: "overflow", text: `screensaver ${saver.scrollHeight - H}px taller than the screen` });
  }
  const boxes = blocks.map((b) => ({ name: b.name, ...box(b.el) }));

  for (const b of boxes) {
    if (b.x < -1 || b.right > W + 1 || ((!homeView || designedHome) && (b.y < -1 || b.bottom > H + 1))) {
      findings.push({ kind: "offscreen", text: `${b.name} reaches past the screen (${Math.round(b.x)},${Math.round(b.y)} → ${Math.round(b.right)},${Math.round(b.bottom)})` });
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const w = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      if (w > 1 && h > 1) findings.push({ kind: "overlap", text: `${a.name} and ${b.name} overlap by ${Math.round(w)}×${Math.round(h)}px` });
    }
  }

  // The edges a screensaver block sits against: the nearer side on each axis.
  const edges = {};
  const lists = {};
  if (layoutRoot) {
    // The screen's grid, as lib/layouts/grid.ts computes it: 12 cells across,
    // 24px gaps between boxes, positions in quarter-cell steps (48 columns).
    // A designed Home's grid covers its root (the screen less the navigation
    // bar), and its cell is also limited by the area's height, as gridFor()
    // does; the screensaver's covers the screen.
    const GAP = 24, COLS = 12;
    const ar = designedHome ? layoutRoot.getBoundingClientRect() : null;
    const area = ar ? { left: ar.left, top: ar.top, w: ar.width, h: ar.height } : { left: 0, top: 0, w: W, h: H };
    let cell = Math.floor((area.w - 2 * edge - (COLS - 1) * GAP) / COLS);
    if (designedHome) cell = Math.min(cell, Math.floor((area.h - 2 * edge - 5 * GAP) / 6));
    const rows = Math.floor((area.h - 2 * edge + GAP) / (cell + GAP));
    const ox = area.left + edge + (area.w - 2 * edge - (COLS * cell + (COLS - 1) * GAP)) / 2;
    const oy = area.top + edge + (area.h - 2 * edge - (rows * cell + (rows - 1) * GAP)) / 2;
    const step = (cell + GAP) / 4;
    const onGrid = (v) => Math.abs(v - Math.round(v)) * step <= tolerance;
    for (const b of boxes) {
      const cx = (b.x - ox) / step, cy = (b.y - oy) / step, cw = (b.w + GAP) / step, ch = (b.h + GAP) / step;
      if (![cx, cy, cw, ch].every(onGrid)) findings.push({ kind: "offgrid", text: `${b.name} is not on the grid (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}; cell ${cell}, offsets ${ox},${oy})` });
    }
    if (boxes.length) {
      const outer = {
        left: Math.min(...boxes.map((b) => b.x)) - area.left,
        top: Math.min(...boxes.map((b) => b.y)) - area.top,
        right: area.left + area.w - Math.max(...boxes.map((b) => b.right)),
        bottom: area.top + area.h - Math.max(...boxes.map((b) => b.bottom)),
      };
      edges.outer = Object.fromEntries(Object.entries(outer).map(([k, v]) => [k, Math.round(v)]));
      edges.grid = { cell, rows, x: Math.round(ox), y: Math.round(oy) };
      for (const [side, d] of Object.entries(outer)) {
        if (d < edge - tolerance) findings.push({ kind: "edges", text: `a box is ${Math.round(d)}px from the ${side} edge, under ${edge}` });
      }
    }
    for (const b of blocks) {
      const el = b.el;
      const r = el.getBoundingClientRect();
      // Content larger than the box: the box clips it, so nothing shows, but
      // something is missing.
      const dw = el.scrollWidth - el.clientWidth, dh = el.scrollHeight - el.clientHeight;
      if (dw > 1 || dh > 1) findings.push({ kind: "overflow", text: `${b.name}: content ${Math.max(dw, 0)}×${Math.max(dh, 0)}px larger than its box` });
      for (const d of el.querySelectorAll("*")) {
        if (!visible(d)) continue;
        const dr = d.getBoundingClientRect();
        const out = Math.max(r.left - dr.left, r.top - dr.top, dr.right - r.right, dr.bottom - r.bottom);
        if (out > 1) {
          findings.push({ kind: "overflow", text: `${b.name}: ${d.tagName.toLowerCase()} "${(d.textContent ?? "").trim().slice(0, 24)}" reaches ${Math.round(out)}px past its box` });
          break;
        }
      }
      // Lists end with a whole entry, or with "+n" for the rest.
      for (const l of el.querySelectorAll("[data-list-shown]")) {
        const shown = Number(l.dataset.listShown), more = Number(l.dataset.listMore);
        lists[b.name] = { shown, more };
        const lr = l.getBoundingClientRect();
        const v = l.querySelector("[data-list-visible]");
        const cut = v ? v.getBoundingClientRect().bottom - lr.bottom : 0;
        if (cut > 1) findings.push({ kind: "list", text: `${b.name}: the last line is cut off by ${Math.round(cut)}px` });
        const plus = l.querySelector("[data-testid=list-more]");
        if (more > 0 && !(plus && visible(plus))) findings.push({ kind: "list", text: `${b.name}: ${more} entries left out without a "+n"` });
        if (more > 0 && shown < 2) findings.push({ kind: "list", text: `${b.name}: ${shown} entr${shown === 1 ? "y" : "ies"} shown of ${shown + more}` });
      }
      // Home is touched: every tap target in a box stays at least 48px
      // (RFC-022 §3.3). A target inside another (a checkbox in its row's
      // button) counts as the outer one.
      if (designedHome) {
        const TARGET = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=checkbox], [role=link], [role=switch], [tabindex]:not([tabindex="-1"])';
        const small = [...el.querySelectorAll(TARGET)].filter((t) => {
          if (!visible(t)) return false;
          const outer = t.parentElement?.closest(TARGET);
          if (outer && el.contains(outer)) return false;
          const tr = t.getBoundingClientRect();
          return tr.width < 48 - tolerance || tr.height < 48 - tolerance;
        });
        if (small.length) {
          const t = small[0];
          const tr = t.getBoundingClientRect();
          const label = (t.getAttribute("aria-label") || t.textContent || "").trim().slice(0, 24);
          findings.push({ kind: "touch", text: `${b.name}: ${small.length} tap target(s) under 48px, e.g. ${t.tagName.toLowerCase()} "${label}" ${Math.round(tr.width)}×${Math.round(tr.height)}px` });
        }
      }
    }
  } else if (!homeView) {
    for (const b of boxes) {
      const d = { left: b.x, right: W - b.right, top: b.y, bottom: H - b.bottom };
      // Only the sides it sits against: within a quarter of the screen, with
      // no other block between it and the edge (the events above the clock
      // on a portrait screen sit against the clock, not the bottom).
      const between = (s) => boxes.some((o) => o !== b && (
        s === "bottom" ? o.y >= b.bottom - 1 && o.x < b.right && o.right > b.x :
        s === "top" ? o.bottom <= b.y + 1 && o.x < b.right && o.right > b.x :
        s === "left" ? o.right <= b.x + 1 && o.y < b.bottom && o.bottom > b.y :
        o.x >= b.right - 1 && o.y < b.bottom && o.bottom > b.y));
      const sides = [d.left <= d.right ? "left" : "right", d.top <= d.bottom ? "top" : "bottom"]
        .filter((s) => d[s] < ((s === "left" || s === "right") ? W : H) / 4 && !between(s));
      edges[b.name] = Object.fromEntries(sides.map((s) => [s, Math.round(d[s])]));
      for (const s of sides) {
        if (Math.abs(d[s] - edge) > tolerance) findings.push({ kind: "edges", text: `${b.name} is ${Math.round(d[s])}px from the ${s} edge, not ${edge}` });
      }
    }
    const digits = document.querySelector("[data-testid=screensaver-clock-digits]");
    const events = document.querySelector("[data-saver-block=events]");
    if (H > W && digits && events && visible(events) && events.children.length > 0) {
      const dw = digits.getBoundingClientRect().width, ew = events.getBoundingClientRect().width;
      // The size is whole pixels, so the time can fall short by one step of
      // it, and the digits change width with the minute (the fit was made
      // for the previous time): allow two steps.
      const step = dw / parseFloat(getComputedStyle(digits).fontSize);
      if (Math.abs(dw - ew) > Math.max(tolerance, 2 * step)) findings.push({ kind: "clock", text: `time ${Math.round(dw)}px wide (font ${getComputedStyle(digits).fontSize}), cards ${Math.round(ew)}px` });
    }
  }

  // Text cut off without an ellipsis.
  let ellipsis = 0;
  const scope = homeView && !designedHome ? document.querySelector("main") ?? document.body : layoutRoot ?? document.querySelector("[data-saver-block]")?.closest(".fixed") ?? document.body;
  for (const el of scope.querySelectorAll("p, span, h1, h2, h3, h4, a, button, li, div")) {
    if (el.children.length > 0 || !el.textContent?.trim() || !visible(el)) continue;
    // Screen-reader-only text is 1px wide on purpose.
    if (el.closest(".sr-only") || el.getBoundingClientRect().width <= 2) continue;
    const s = getComputedStyle(el);
    const over = el.scrollWidth > el.clientWidth + 1 && (s.overflow !== "visible" || s.overflowX !== "visible");
    const overY = el.scrollHeight > el.clientHeight + 2 && s.overflowY === "hidden" && !s.webkitLineClamp?.match(/\d/);
    if (!over && !overY) continue;
    if (s.textOverflow === "ellipsis" || s.webkitLineClamp?.match(/\d/)) {
      ellipsis++;
      continue;
    }
    findings.push({ kind: "clipped", text: `"${el.textContent.trim().slice(0, 40)}" is cut off` });
  }

  return { boxes: boxes.map((b) => ({ ...b, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) })), edges, ...(layoutRoot ? { lists } : {}), findings, ellipsis, viewport: { width: W, height: H } };
}

// ---------------------------------------------------------------- run

const saverBase = {
  screensaverTimeout: 2,
  presenceTimeout: 30,
  presenceControlMode: "screensaver",
  photoRotationInterval: 300,
  showNews: true,
  showForecast: true,
  weatherEffects: false,
  largeDetails: false,
};

const results = [];
let browser;
try {
  browser = await chromium.launch();
  writeFileSync(STATE_FILE, JSON.stringify(saved));
  seed();
  const fixtures = views.includes("saver-layout") ? await createFixtures() : null;
  for (const screen of screens) {
    for (const locale of locales) {
      const ctx = await browser.newContext({
        viewport: { width: screen.width, height: screen.height },
        screen: { width: screen.width, height: screen.height },
        deviceScaleFactor: screen.scale,
        serviceWorkers: "block",
        reducedMotion: "reduce",
        locale: { de: "de-DE", en: "en-GB", fr: "fr-FR" }[locale],
      });
      const page = await ctx.newPage();
      await stub(page);
      // Failed requests: two or more put "server unreachable" over Home.
      let failed = [];
      page.on("response", (r) => {
        if (r.status() >= 400 && r.url().startsWith(BASE)) failed.push(`${r.status()} ${r.url().slice(BASE.length).split("?")[0]}`);
      });
      // The dev server's own indicator is not part of the app.
      await page.addInitScript(() => {
        const style = () => {
          const el = document.createElement("style");
          el.textContent = "nextjs-portal{display:none!important}";
          document.head.appendChild(el);
        };
        if (document.head) style();
        else document.addEventListener("DOMContentLoaded", style);
      });
      const hw = `matrix-${screen.id}-${locale}`;
      const joined = await (await page.request.post(`${BASE}/api/session/join`, { data: { joinCode: CODE, deviceName: hw, hardwareId: hw } })).json();
      if (!joined.device) throw new Error(`join failed: ${JSON.stringify(joined)}`);
      // The screen reads its kiosk flag from its stored session, not the
      // database: a narrow screen that is not a kiosk gets no screensaver.
      const session = (kiosk) => ctx.addCookies([
        { name: "family-calendar-storage", value: encodeURIComponent(JSON.stringify({ state: { family: joined.family, device: { ...joined.device, is_kiosk: kiosk } }, version: 0 })), url: BASE },
        { name: "NEXT_LOCALE", value: locale, url: BASE },
      ]);

      // A layout on a screen at least 600px wide with room for 6 rows
      // (lib/layouts/grid.ts); a smaller one keeps the built-in screensaver.
      const cell = Math.floor((screen.width - 2 * EDGE - 11 * 24) / 12);
      const holdsLayout = screen.width >= 600 && Math.floor((screen.height - 2 * EDGE + 24) / (cell + 24)) >= 6;
      let unlocked = false;
      const unlock = async () => {
        if (!PIN || unlocked) return;
        const res = await page.request.post(`${BASE}/api/pin`, { data: { family_id: family, action: "verify", pin: PIN } });
        if (!res.ok()) throw new Error(`the PIN was not accepted: ${res.status()}`);
        unlocked = true;
      };
      let assigned = null;
      const assign = async (layoutId) => {
        if (assigned === layoutId) return;
        await unlock();
        const res = await page.request.put(`${BASE}/api/devices/${joined.device.id}/layout`, { data: { layout_id: layoutId } });
        if (!res.ok()) throw new Error(`assigning a layout failed: ${res.status()} ${await res.text()}`);
        assigned = layoutId;
      };

      /**
       * home-layout: the built-in Home first, without a layout, to measure the
       * navigation bar; then a layout whose Home is builtInHome for the grid
       * area (made once per size, as a parent would through the API). Until
       * PATCH accepts `home` (RFC-022 step 6) it is written to the row directly.
       */
      const homeLayoutFor = async () => {
        await assign(null);
        await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(".festival-grid", { timeout: 60_000 });
        const navHeight = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll("nav")].map((el) => {
          const r = el.getBoundingClientRect();
          const fixedAtBottom = getComputedStyle(el).position === "fixed" && r.height > 0 && r.bottom >= innerHeight - 1 && r.width >= innerWidth / 2;
          return fixedAtBottom ? Math.ceil(innerHeight - r.top) : 0;
        })));
        const size = homeLayoutSize(screen, navHeight);
        const key = `${size.width}x${size.height}`;
        if (!homeLayouts.has(key)) {
          const { builtInHome, validateItems } = layoutCode();
          const checked = validateItems(builtInHome(size.width, size.height), size.width, size.height, "home");
          if (!checked.ok) throw new Error(`builtInHome(${key}) is not a valid Home: ${checked.error} ${checked.itemId ?? ""}`);
          await unlock();
          const made = await page.request.post(`${BASE}/api/layouts`, { data: { grid: 48, name: `matrix-Home ${key}`, width: size.width, height: size.height } });
          if (made.status() !== 201) throw new Error(`home-layout: creating ${key} failed: ${made.status()} ${await made.text()}`);
          const layout = (await made.json()).layout;
          const patched = await page.request.patch(`${BASE}/api/layouts/${layout.id}`, { data: { grid: 48, home: checked.items, updated_at: layout.updated_at } });
          if (patched.status() === 400 && (await patched.json().catch(() => ({}))).error === "bad_body") {
            psql(`UPDATE layouts SET home = ${q(JSON.stringify(checked.items))}::jsonb WHERE id = ${q(layout.id)} AND family_id = ${q(family)}`);
          } else if (patched.status() !== 200) {
            throw new Error(`home-layout: saving the Home of ${key} failed: ${patched.status()} ${await patched.text()}`);
          }
          homeLayouts.set(key, layout.id);
        }
        return { layoutId: homeLayouts.get(key), holds: size.holds, navHeight };
      };
      await allowDesignedHome(ctx);

      const shots = views.flatMap((view) => (view === "saver-layout" ? layoutShots(screen, fixtures) : [[view, null]]));
      for (const [view, fixedLayoutId] of shots) {
        const homeLayout = view === "home-layout";
        const saver = view !== "home" && !homeLayout;
        psql(`UPDATE devices SET is_kiosk = ${saver} WHERE hardware_id = ${q(hw)}`);
        await session(saver);
        const saverSetting = { ...saverBase, screensaverTimeout: saver ? 2 : 0, largeDetails: view === "saver-large" };
        // The measuring load of home-layout runs with the screensaver off as well.
        if (homeLayout) putSaver(saverSetting);
        const home = homeLayout ? await homeLayoutFor() : null;
        const layoutId = home ? home.layoutId : fixedLayoutId;
        const wantLayout = home ? home.holds : !!layoutId && holdsLayout;
        await assign(layoutId);
        putSaver(saverSetting);
        failed = [];
        await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
        const file = `${screen.id}__${locale}__${view}.png`;
        try {
          // A designed Home or the built-in: which one appeared is checked below.
          await page.waitForSelector(homeLayout ? `${DESIGNED_HOME} [data-layout-item], .festival-grid` : !saver ? ".festival-grid" : wantLayout ? "[data-layout-item=clock]" : "[data-saver-block=clock]", { timeout: 60_000 });
        } catch {
          // Recorded, not fatal: the rest of the matrix still runs.
          await page.screenshot({ path: join(OUT, file) });
          results.push({ screen: screen.id, label: screen.label, locale, view, file, boxes: [], edges: {}, ellipsis: 0,
            findings: [{ kind: "missing", text: !saver ? "Home did not render" : wantLayout ? "the designed screensaver did not appear" : "the screensaver did not appear" }] });
          console.log(`${screen.id.padEnd(20)} ${locale} ${view.padEnd(16)} MISSING`);
          continue;
        }
        // Data, web fonts and the slide-in animations (reduced motion skips most).
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(2500);
        const m = await page.evaluate(measure, { view, edge: EDGE, tolerance: TOLERANCE, homeRoot: DESIGNED_HOME });
        if (home) {
          m.edges.nav = home.navHeight;
          const shown = await page.evaluate((root) => ({
            layout: document.querySelectorAll(`${root} [data-layout-item]`).length,
            builtIn: document.querySelectorAll(".festival-grid").length,
          }), DESIGNED_HOME);
          if (wantLayout && (shown.builtIn > 0 || shown.layout === 0)) m.findings.push({ kind: "layout", text: `expected the designed Home, found ${shown.layout} layout boxes and ${shown.builtIn} built-in grid(s)` });
          if (!wantLayout && shown.layout > 0) m.findings.push({ kind: "layout", text: `a screen under 600px wide or without a grid shows the designed Home (${shown.layout} boxes)` });
        } else if (layoutId) {
          const shown = await page.evaluate(() => ({
            layout: document.querySelectorAll("[data-layout-item]").length,
            builtIn: document.querySelectorAll("[data-saver-block]").length,
          }));
          if (wantLayout && (shown.builtIn > 0 || shown.layout === 0)) m.findings.push({ kind: "layout", text: `expected the layout, found ${shown.layout} layout boxes and ${shown.builtIn} built-in blocks` });
          if (!wantLayout && shown.layout > 0) m.findings.push({ kind: "layout", text: `a screen under 600px wide or 6 rows shows the layout (${shown.layout} boxes)` });
        }
        for (const f of [...new Set(failed)]) m.findings.push({ kind: "request", text: f });
        // What the screen shows: the viewport, never a stitched full page.
        await page.screenshot({ path: join(OUT, file) });
        results.push({ screen: screen.id, label: screen.label, locale, view, file, ...m });
        const tag = m.findings.length ? `${m.findings.length} finding(s)` : "ok";
        console.log(`${screen.id.padEnd(20)} ${locale} ${view.padEnd(16)} ${tag}`);
        for (const f of m.findings) console.log(`    ${f.kind}: ${f.text}`);
      }
      await ctx.close();
    }
  }
} finally {
  cleanup();
  await browser?.close().catch(() => {});
  writeReport();
}
if (STRICT && results.some((r) => r.findings.length)) process.exit(1);

// ---------------------------------------------------------------- report

function writeReport() {
writeFileSync(join(OUT, "report.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), edge: EDGE, results }, null, 2));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const total = results.reduce((n, r) => n + r.findings.length, 0);
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Screen matrix</title>
<style>
  body{font:14px system-ui,sans-serif;margin:24px;background:#111;color:#eee}
  h1{font-size:20px;margin:0 0 4px} .sum{color:#aaa;margin-bottom:24px}
  .row{display:flex;gap:16px;overflow-x:auto;padding-bottom:16px;margin-bottom:24px;border-bottom:1px solid #333}
  figure{margin:0;flex:none;width:260px} img{width:100%;border:1px solid #333;background:#000}
  figcaption{margin-top:6px;font-size:12px;color:#bbb} .ok{color:#6c6} .bad{color:#f77}
  ul{margin:4px 0 0;padding-left:16px;font-size:12px;color:#f99} h2{font-size:16px;margin:0 0 8px}
</style>
<h1>Screen matrix</h1>
<div class="sum">${results.length} shots, ${total ? `<span class="bad">${total} finding(s)</span>` : `<span class="ok">no findings</span>`} · edge ${EDGE}px · ${esc(new Date().toLocaleString())}</div>
${[...new Set(results.map((r) => r.screen))].map((id) => {
  const rs = results.filter((r) => r.screen === id);
  return `<h2>${esc(rs[0].label)}</h2><div class="row">${rs.map((r) => `<figure><a href="${esc(r.file)}"><img src="${esc(r.file)}" loading="lazy"></a>
  <figcaption>${esc(r.view)} · ${esc(r.locale)} · ${r.findings.length ? `<span class="bad">${r.findings.length} finding(s)</span>` : `<span class="ok">ok</span>`}${r.ellipsis ? ` · ${r.ellipsis} ellipsis` : ""}</figcaption>
  ${r.findings.length ? `<ul>${r.findings.map((f) => `<li>${esc(f.kind)}: ${esc(f.text)}</li>`).join("")}</ul>` : ""}</figure>`).join("")}</div>`;
}).join("\n")}`;
writeFileSync(join(OUT, "index.html"), html);
console.log(`\n${results.length} shots, ${total} finding(s). Contact sheet: ${join(OUT, "index.html")}`);
}
