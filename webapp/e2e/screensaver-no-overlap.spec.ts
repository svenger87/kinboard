import { test, expect, request as pwRequest, type APIRequestContext, type Browser } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { postJoin } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";
import { saverListMaxCut, saverListPlan } from "../src/lib/screensaver-fit";

/**
 * #282: on a 10-inch tablet in landscape the built-in screensaver drew five
 * events straight over the weather forecast. The events, birthdays and the
 * lessons were one column anchored to the bottom edge that grew upwards for
 * as long as it had entries, and the weather was anchored to the top with
 * nothing between them that knew about the other.
 *
 * This draws the built-in screensaver with that widget set (five events,
 * three birthdays, the forecast, today's lessons) on the screens it is hung
 * on, and checks the blocks as drawn: no two of them cover each other, none
 * reaches past the screen, and a list that had to leave entries out says how
 * many with a "+n" line. In a family of its own, removed afterwards.
 * FAMILY_CODE says there is a stack (e2e.yml sets it).
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE and a running stack");
// One after another (one family, one device), but every screen measured even when one fails.
test.describe.configure({ mode: "default" });

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const P = "claude-saveroverlap-";

const SCREENS = [
  { id: "tablet-960x600", width: 960, height: 600 },
  { id: "tablet-1024x600", width: 1024, height: 600 },
  { id: "tablet-1280x800", width: 1280, height: 800 },
  // The same tablet in a browser, less its status and address bars.
  { id: "tablet-1280x720", width: 1280, height: 720 },
  { id: "landscape-1920x1080", width: 1920, height: 1080 },
  { id: "portrait-1080x1920", width: 1080, height: 1920 },
];
/** Text size (Settings -> Appearance, per device) and the screensaver's large details. */
const VARIANTS = [
  { id: "normal", textScale: 1, largeDetails: false },
  { id: "text-xl", textScale: 1.3, largeDetails: false },
  { id: "large-details", textScale: 1, largeDetails: true },
];

let famId = "";
let code = "";
let api: APIRequestContext;
let device: Record<string, unknown>;
let familyJson: Record<string, unknown>;

function purge(ids: string[]) {
  for (const id of ids.filter(Boolean)) {
    const f = sqlText(id);
    psql(`BEGIN; SET LOCAL session_replication_role = replica;
      DELETE FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE family_id = ${f});
      DELETE FROM calendars WHERE family_id = ${f};
      DELETE FROM birthdays WHERE family_id = ${f};
      DELETE FROM schedules WHERE family_id = ${f};
      DELETE FROM people WHERE family_id = ${f};
      DELETE FROM devices WHERE family_id = ${f};
      DELETE FROM settings WHERE family_id = ${f};
      DELETE FROM families WHERE id = ${f};
      COMMIT;`);
  }
}

const saverSetting = (largeDetails: boolean) =>
  JSON.stringify({
    screensaverTimeout: 2,
    showNews: false,
    showForecast: true,
    showLessons: true,
    weatherEffects: false,
    eventCount: 5,
    birthdayCount: 3,
    largeDetails,
  });

test.beforeAll(async () => {
  test.setTimeout(90_000);
  // A run killed before its afterAll left its family behind. Only old ones:
  // the desktop and webkit projects run this file side by side, each with its own.
  purge(psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%' AND created_at < now() - interval '1 hour'`).split(","));
  code = `CO${randomBytes(4).toString("hex").toUpperCase()}`;
  famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family-${code}', '${code}', true) RETURNING id`);
  const f = sqlText(famId);
  psql(`INSERT INTO settings (family_id, key, value) VALUES (${f}, 'screensaver', ${sqlText(saverSetting(false))}::jsonb)`);
  // The lessons show the school day: today on a weekday; on a weekend the
  // next one, so the block is there whichever day this runs.
  const weekend = [0, 6].includes(new Date().getDay());
  if (weekend) psql(`INSERT INTO settings (family_id, key, value) VALUES (${f}, 'schedule_widget', '{"tomorrowFrom":"00:00"}'::jsonb)`);

  const calendar = psqlRow(`INSERT INTO calendars (family_id, name) VALUES (${f}, '${P}calendar') RETURNING id`);
  const c = sqlText(calendar);
  // At fixed times of day, so every run draws the same text (the page's clock is fixed too).
  const day = (n: number, h: number) => `date_trunc('day', now()) + interval '${n} days ${h} hours'`;
  psql(`INSERT INTO events (calendar_id, title, start_at, end_at) VALUES
    (${c}, 'Fußballtraining', ${day(1, 16)}, ${day(1, 17)}),
    (${c}, 'Zahnarzt Kontrolle', ${day(2, 9)}, ${day(2, 10)}),
    (${c}, 'Elternabend Klasse 3b in der Aula', ${day(3, 19)}, ${day(3, 21)}),
    (${c}, 'Schwimmkurs', ${day(4, 15)}, ${day(4, 16)}),
    (${c}, 'Laternenumzug mit der Kita', ${day(5, 17)}, ${day(5, 18)}),
    (${c}, 'Musikschule', ${day(6, 14)}, ${day(6, 15)})`);
  psql(`INSERT INTO birthdays (family_id, name, date) VALUES
    (${f}, 'Oma Gerda', (current_date + 4)),
    (${f}, 'Jonas', (current_date + 9 - interval '8 years')::date),
    (${f}, 'Tante Marie-Louise', (current_date + 20)),
    (${f}, 'Opa Heinz', (current_date + 40))`);
  const kids = [
    { name: "Mia", color: "#e11d48", subjects: ["Deutsch", "Mathe", "Sport", "Sachkunde"] },
    { name: "Ben", color: "#2563eb", subjects: ["Englisch", "Kunst", "Schwimmen"] },
  ];
  for (const kid of kids) {
    const person = psqlRow(`INSERT INTO people (family_id, name, color, is_child) VALUES (${f}, '${kid.name}', '${kid.color}', true) RETURNING id`);
    const slots = JSON.stringify(kid.subjects.map((subject, i) => ({ period: i + 1, subject })));
    for (let dow = 0; dow < 7; dow++) {
      psql(`INSERT INTO schedules (family_id, person_id, day_of_week, time_slots) VALUES (${f}, ${sqlText(person)}, ${dow}, ${sqlText(slots)}::jsonb)`);
    }
  }

  api = await pwRequest.newContext({ baseURL: BASE });
  const res = await postJoin(api, { joinCode: code, hardwareId: `${P}kiosk-${Date.now()}`, deviceName: `${P}kiosk` });
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { family: Record<string, unknown>; device: { id: string } & Record<string, unknown> };
  psql(`UPDATE devices SET is_kiosk = true WHERE id = '${body.device.id}'`);
  familyJson = body.family;
  device = body.device;
});

test.afterAll(async () => {
  purge([famId]);
  await api?.dispose();
  expect(psql(`SELECT count(*) FROM families WHERE id = ${sqlText(famId)}`)).toBe("0");
  expect(psql(`SELECT count(*) FROM devices WHERE family_id = ${sqlText(famId)}`)).toBe("0");
});

// The weather and the forecast, stubbed: eight three-hour slots from now.
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

async function openSaver(browser: Browser, size: { width: number; height: number }, textScale: number) {
  const ctx = await browser.newContext({
    viewport: size,
    screen: size,
    // The stubs below must not be answered by the PWA's service worker instead.
    serviceWorkers: "block",
    reducedMotion: "reduce",
    locale: "de-DE",
    storageState: await api.storageState(),
  });
  await ctx.addCookies([
    {
      name: "family-calendar-storage",
      value: encodeURIComponent(JSON.stringify({ state: { family: familyJson, device: { ...device, is_kiosk: true } }, version: 0 })),
      url: BASE,
    },
    { name: "NEXT_LOCALE", value: "de", url: BASE },
  ]);
  const hits = { weather: 0, forecast: 0 };
  await ctx.route(/\/api\/weather\/forecast/, (r) => {
    hits.forecast++;
    return r.fulfill({ json: { location: "Hamburg", coords: { lat: 53.55, lon: 10 }, timezone: 3600, daily, hourly, units: "metric" } });
  });
  await ctx.route(/\/api\/weather(\?|$)/, (r) => {
    hits.weather++;
    return r.fulfill({ json: weather });
  });
  await ctx.route(/\/api\/news(\?|$)/, (r) => r.fulfill({ json: { news: [] } }));
  const page = await ctx.newPage();
  // Ten in the morning today: the clock and the "tomorrow, 16:00" lines are
  // the same on every run, so two runs can be compared pixel for pixel.
  const morning = new Date();
  morning.setHours(10, 0, 0, 0);
  await page.clock.setFixedTime(morning);
  await page.addInitScript((scale) => {
    try {
      localStorage.setItem("kinboard_text_scale", String(scale));
    } catch {}
    const hide = () => {
      const el = document.createElement("style");
      el.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(el);
    };
    if (document.head) hide();
    else document.addEventListener("DOMContentLoaded", hide);
  }, textScale);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  return { ctx, page, hits };
}

/** In the page: the blocks as drawn, and what is wrong with them. */
function measure() {
  const W = innerWidth;
  const H = innerHeight;
  const visible = (el: Element) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0 && r.width > 0 && r.height > 0;
  };
  const findings: string[] = [];
  const boxes = [...document.querySelectorAll<HTMLElement>("[data-saver-block]")]
    .filter(visible)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.dataset.saverBlock!, el, x: r.left, y: r.top, right: r.right, bottom: r.bottom };
    });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const w = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      if (w > 1 && h > 1) findings.push(`${a.name} and ${b.name} overlap by ${Math.round(w)}x${Math.round(h)}px`);
    }
  }
  for (const b of boxes) {
    if (b.x < -1 || b.y < -1 || b.right > W + 1 || b.bottom > H + 1) {
      findings.push(`${b.name} reaches past the screen (${Math.round(b.x)},${Math.round(b.y)} -> ${Math.round(b.right)},${Math.round(b.bottom)})`);
    }
    // Anything drawn inside a block stays on the screen too.
    for (const d of b.el.querySelectorAll("*")) {
      if (!visible(d) || d.closest("[aria-hidden=true]")) continue;
      const r = d.getBoundingClientRect();
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) {
        findings.push(`${b.name}: "${(d.textContent ?? "").trim().slice(0, 30)}" reaches past the screen`);
        break;
      }
    }
  }
  // A list that left entries out says how many; one that shows its entries shows them whole.
  const lists = [...document.querySelectorAll<HTMLElement>("[data-saver-block] [data-list-shown]")].filter(visible).map((l) => {
    const shown = Number(l.dataset.listShown), more = Number(l.dataset.listMore);
    const lr = l.getBoundingClientRect();
    const v = l.querySelector("[data-list-visible]");
    const cut = v ? v.getBoundingClientRect().bottom - lr.bottom : 0;
    if (cut > 1) findings.push(`a list's last entry is cut off by ${Math.round(cut)}px`);
    const plus = l.querySelector("[data-testid=list-more]");
    if (more > 0 && !(plus && visible(plus))) findings.push(`${more} entries left out without a "+n"`);
    return { name: l.closest<HTMLElement>("[data-saver-list]")?.dataset.saverList ?? "?", shown, more };
  });
  return { findings, blocks: boxes.map((b) => b.name), lists };
}

for (const variant of VARIANTS) {
  for (const screen of SCREENS) {
    // The large text variants on the screens where room is shortest, and the reference sizes.
    if (variant.id !== "normal" && !["tablet-960x600", "tablet-1280x800", "portrait-1080x1920"].includes(screen.id)) continue;

    test(`${screen.id} ${variant.id}: no block covers another or leaves the screen`, async ({ browser }, testInfo) => {
      test.setTimeout(90_000);
      psql(`UPDATE settings SET value = ${sqlText(saverSetting(variant.largeDetails))}::jsonb WHERE family_id = ${sqlText(famId)} AND key = 'screensaver'`);
      const { ctx, page, hits } = await openSaver(browser, { width: screen.width, height: screen.height }, variant.textScale);
      try {
        await page.waitForSelector("[data-saver-block=clock]", { timeout: 45_000 });
        // Every widget of the set is there before anything is measured: the
        // forecast, the first event, and both children's lessons loaded (they
        // may be left out for room, which is what is measured).
        await expect(page.getByTestId("screensaver-forecast")).toBeVisible({ timeout: 15_000 });
        await expect(page.locator("[data-saver-block=events]")).toContainText("Fußballtraining", { timeout: 15_000 });
        await page.waitForFunction(
          () =>
            document.querySelector("[data-saver-block=events]")?.getAttribute("data-lesson-rows") === "2" ||
            // A build without the fit shows every row.
            document.querySelectorAll("[data-testid=screensaver-lessons] [data-person]").length === 2,
          undefined,
          { timeout: 15_000 },
        );
        expect(hits.weather + hits.forecast, "the weather stubs answered").toBeGreaterThan(1);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(1500);
        const m = await page.evaluate(measure);
        const shot = `${screen.id}-${variant.id}-${testInfo.project.name}.png`;
        await page.screenshot({ path: process.env.SAVER_SHOTS ? `${process.env.SAVER_SHOTS}/${shot}` : testInfo.outputPath(shot) });
        await testInfo.attach("measured", { body: JSON.stringify(m, null, 2), contentType: "application/json" });
        expect(m.blocks).toEqual(expect.arrayContaining(["clock", "weather", "events"]));
        expect(m.findings).toEqual([]);
        // What was left out was left out in the order lib/screensaver-fit.ts gives.
        const of = (name: string) => m.lists.find((l) => l.name === name);
        const count = (name: string, all: number) => ({ shown: of(name)?.shown ?? 0, total: of(name) ? of(name)!.shown + of(name)!.more : all });
        const ev = count("events", 5), bd = count("birthdays", 3), ls = count("lessons", 2);
        const totals = { events: ev.total, birthdays: bd.total, lessons: ls.total };
        const shown = { events: ev.shown, birthdays: bd.shown, lessons: ls.shown };
        const steps = Array.from({ length: saverListMaxCut(totals) + 1 }, (_, k) => saverListPlan(totals, k));
        // (Only a build with the fit marks its lists; without it, the checks above are the ones that fail.)
        if (m.lists.length > 0) expect(steps, JSON.stringify(m.lists)).toContainEqual(shown);
        console.log(`${screen.id} ${variant.id} ${testInfo.project.name}: ${JSON.stringify(shown)}`);
      } finally {
        await ctx.close();
      }
    });
  }
}
