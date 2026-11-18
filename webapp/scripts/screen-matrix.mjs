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
 * phone layout is designed.
 *
 * Output: one PNG per shot, report.json, and index.html, a contact sheet
 * with every shot and its findings side by side.
 *
 * Needs a running stack and dev server (or a build), and the family's join
 * code (DEMO01 is the demo family with rich data). It joins as its own device, seeds events and birthdays prefixed
 * "matrix-", stubs news and weather, and removes all of it afterwards. The
 * family's screensaver settings are put back as they were.
 *
 *   node scripts/screen-matrix.mjs --base http://localhost:3157 --code DEMO01
 *   node scripts/screen-matrix.mjs --only portrait-1080 --locales de --views saver-large
 *
 * Options:
 *   --base URL        the app (default http://localhost:3157)
 *   --code CODE       family join code (required)
 *   --out DIR         output (default e2e/screen-matrix)
 *   --only a,b        screen ids to run (default all)
 *   --locales a,b     de,en,fr by default
 *   --views a,b       home,saver,saver-large by default
 *   --db CONTAINER    database container (default $KINBOARD_DB_CONTAINER or kbfresh-db)
 *   --strict          exit 1 when any shot has a finding
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
const LOCALES = ["de", "en", "fr"];

const screens = SCREENS.filter((s) => list("only", null)?.includes(s.id) ?? true);
const locales = list("locales", LOCALES);
const views = list("views", VIEWS);

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
const savedSaver = psql(`SELECT value::text FROM settings WHERE family_id = ${q(family)} AND key = 'screensaver'`);

function putSaver(value) {
  psql(`INSERT INTO settings (family_id, key, value) VALUES (${q(family)}, 'screensaver', ${q(JSON.stringify(value))}::jsonb)
        ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value`);
}

// A ringing timer keeps the screensaver away (lib/screensaver-gate.ts), and a
// timer rings once started_at + duration (+ paused time) has passed, whether
// or not finished_at was ever written: DEMO01's seeded "Pasta" and "Oven"
// timers have no finished_at and ran out long ago, which is why its
// screensaver never started. Every undismissed, unpaused timer that has run
// out, or will within the run, is dismissed and put back afterwards.
const ringing = psql(`SELECT string_agg(id::text, ',') FROM timers
  WHERE family_id = ${q(family)} AND dismissed_at IS NULL AND paused_at IS NULL
    AND started_at + (duration_seconds + COALESCE(paused_seconds, 0)) * interval '1 second' < now() + interval '3 hours'`);

/** Events and birthdays every shot shows, relative to now so they are always upcoming. */
function seed() {
  if (ringing) psql(`UPDATE timers SET dismissed_at = now() WHERE id IN (${ringing.split(",").map(q).join(",")})`);
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

function cleanup() {
  // Soft-delete triggers would leave rows in the recycle bin; these never existed for the family.
  psql(`BEGIN; SET LOCAL session_replication_role = replica;
    DELETE FROM events WHERE title LIKE 'matrix-%';
    DELETE FROM birthdays WHERE name LIKE 'matrix-%';
    DELETE FROM devices WHERE hardware_id LIKE 'matrix-%';
    COMMIT;`);
  if (ringing) psql(`UPDATE timers SET dismissed_at = NULL WHERE id IN (${ringing.split(",").map(q).join(",")})`);
  if (savedSaver) putSaver(JSON.parse(savedSaver));
  else psql(`DELETE FROM settings WHERE family_id = ${q(family)} AND key = 'screensaver'`);
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

// ---------------------------------------------------------------- measuring

/** Runs in the page: boxes and findings for the current view. */
function measure({ view, edge, tolerance }) {
  const W = innerWidth;
  const H = innerHeight;
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

  let blocks = [];
  if (view === "home") {
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
    if (b.x < -1 || b.right > W + 1 || (view !== "home" && (b.y < -1 || b.bottom > H + 1))) {
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
  if (view !== "home") {
    for (const b of boxes) {
      const d = { left: b.x, right: W - b.right, top: b.y, bottom: H - b.bottom };
      // Only the sides it sits against: within a quarter of the screen. The
      // events above the clock on a portrait screen sit against no bottom edge.
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
  const scope = view === "home" ? document.querySelector("main") ?? document.body : document.querySelector("[data-saver-block]")?.closest(".fixed") ?? document.body;
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

  return { boxes: boxes.map((b) => ({ ...b, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) })), edges, findings, ellipsis, viewport: { width: W, height: H } };
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

mkdirSync(OUT, { recursive: true });
const results = [];
const browser = await chromium.launch();
seed();
try {
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

      for (const view of views) {
        const saver = view !== "home";
        psql(`UPDATE devices SET is_kiosk = ${saver} WHERE hardware_id = ${q(hw)}`);
        await session(saver);
        putSaver({ ...saverBase, screensaverTimeout: saver ? 2 : 0, largeDetails: view === "saver-large" });
        failed = [];
        await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
        const file = `${screen.id}__${locale}__${view}.png`;
        try {
          await page.waitForSelector(saver ? "[data-saver-block=clock]" : ".festival-grid", { timeout: 60_000 });
        } catch {
          // Recorded, not fatal: the rest of the matrix still runs.
          await page.screenshot({ path: join(OUT, file) });
          results.push({ screen: screen.id, label: screen.label, locale, view, file, boxes: [], edges: {}, ellipsis: 0,
            findings: [{ kind: "missing", text: saver ? "the screensaver did not appear" : "Home did not render" }] });
          console.log(`${screen.id.padEnd(20)} ${locale} ${view.padEnd(12)} MISSING`);
          continue;
        }
        // Data, web fonts and the slide-in animations (reduced motion skips most).
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(2500);
        const m = await page.evaluate(measure, { view, edge: EDGE, tolerance: TOLERANCE });
        for (const f of [...new Set(failed)]) m.findings.push({ kind: "request", text: f });
        // What the screen shows: the viewport, never a stitched full page.
        await page.screenshot({ path: join(OUT, file) });
        results.push({ screen: screen.id, label: screen.label, locale, view, file, ...m });
        const tag = m.findings.length ? `${m.findings.length} finding(s)` : "ok";
        console.log(`${screen.id.padEnd(20)} ${locale} ${view.padEnd(12)} ${tag}`);
        for (const f of m.findings) console.log(`    ${f.kind}: ${f.text}`);
      }
      await ctx.close();
    }
  }
} finally {
  cleanup();
  await browser.close();
}

// ---------------------------------------------------------------- report

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
if (STRICT && total > 0) process.exit(1);
