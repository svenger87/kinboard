import { expect, test, type Browser } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";
import { builtInHome } from "../src/lib/layouts/built-in";
import { homeArea } from "../src/lib/layouts/home-area";
import { gridFor } from "../src/lib/layouts/grid";
import { homeMin } from "../src/lib/layouts/home-size";
import type { HomeLayoutItem, HomeWidgetKey, TextSize } from "../src/lib/layouts/types";

/**
 * One frame and one type scale for every Home widget in a box
 * (components/layouts/home-widgets/frame.tsx). The groups of widgets were
 * built side by side, each with a card of its own (titles at 1em, 0.9em and
 * 0.85em, icons and padding to match), so two boxes at the same text size
 * did not look alike, and set-up prompts and empty states had sizes of
 * their own besides.
 *
 * Since then the title row is one size on the whole screen: a box's text
 * size (S to XL) scales its content, never its title, icon, chevron, count
 * or chips, so a box at S beside one at M has the same title row.
 */

const DIR = join(__dirname, "../src/components/layouts/home-widgets");
/** A font size set in a class: text-[0.8em], text-[14px], text-sm, text-2xl … (colours like text-primary are not sizes). */
const OWN_SIZE = /\btext-(?:\[(?:length:)?[\d.]+(?:em|px|rem)\]|xs|sm|base|lg|[2-9]?xl)(?![\w-])/g;

test("no Home widget sets a font size of its own: only frame.tsx's roles", () => {
  const found: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))) {
    if (file === "frame.tsx") continue;
    readFileSync(join(DIR, file), "utf8")
      .split("\n")
      .forEach((line, n) => {
        for (const m of line.match(OWN_SIZE) ?? []) found.push(`${file}:${n + 1} ${m}`);
      });
  }
  expect(found).toEqual([]);
});

test("the old per-group frames are gone", () => {
  const src = readdirSync(DIR).map((f) => readFileSync(join(DIR, f), "utf8")).join("\n");
  for (const name of ["HomeCardFrame", "HomeListFrame", "BoxCard", "BoxHeader", "SetUpBox", "boxPadding"]) {
    expect(src.includes(name), name).toBe(false);
  }
});

/**
 * The widgets drawn without a title row: the clock block's pieces (a value
 * or a strip across the top of the screen, as on today's Home) and a photo,
 * which fills its box.
 */
const HEADLESS = new Set<string>(["clock", "date", "greeting", "familyMembers", "todayStrip", "photos"]);

const BASE = process.env.PLAYWRIGHT_BASE_URL;
const CODE = process.env.HOME_LISTS_CODE;

/** What the measuring in the page returns for one box. */
interface Box {
  id: string;
  widget: string;
  /** The box's text size, px. */
  box: number;
  /** Whether the widget drew anything at all (the media player is absent when nothing plays). */
  drawn: boolean;
  header: null | {
    title: number;
    icon: number;
    badge: number;
    height: number;
    /** From the box's top and left edge to the title row's (the card's padding). */
    top: number;
    left: number;
    /** The title's text from the box's top: two boxes in a row have their titles on one line. */
    titleTop: number;
  };
  empties: { text: string; px: number; align: string; left: number }[];
  small: string[];
}

/** Measures every box of the designed Home on `page` (in the page). */
function measure(): Box[] {
  return [...document.querySelectorAll("[data-testid=designed-home-grid] [data-layout-id]")].map((box) => {
    const px = (el: Element) => Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const b = box.getBoundingClientRect();
    // A title row: the shared header (data-box-header), or a set-up prompt's first line.
    const head = box.querySelector("[data-box-header]") ?? box.querySelector("[data-testid=box-set-up] .flex-col");
    const title = head?.querySelector(".font-display") ?? null;
    const icon = head?.querySelector("svg") ?? null;
    const badge = icon?.parentElement ?? null;
    const boxPx = parseFloat(getComputedStyle(box).fontSize);
    const small: string[] = [];
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !(n.textContent ?? "").trim() || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      // An avatar's initial is part of a picture (role="img", named by its label), not a line of text.
      if (el.closest("[role=img]")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < boxPx * 0.72 - 0.5) small.push(`"${(n.textContent ?? "").trim().slice(0, 20)}" ${size.toFixed(1)}px`);
    }
    const hr = head?.getBoundingClientRect();
    return {
      id: box.getAttribute("data-layout-id") ?? "",
      widget: box.getAttribute("data-layout-item") ?? "",
      box: r1(boxPx),
      drawn: box.childElementCount > 0,
      header:
        head && title && icon && badge && hr
          ? {
              title: px(title),
              icon: r1(icon.getBoundingClientRect().width),
              badge: r1(badge.getBoundingClientRect().width),
              height: r1(hr.height),
              top: r1(hr.top - b.top),
              left: r1(hr.left - b.left),
              titleTop: r1(title.getBoundingClientRect().top - b.top),
            }
          : null,
      empties: [...box.querySelectorAll("[data-home-empty]")].map((el) => ({
        text: (el.textContent ?? "").trim().slice(0, 30),
        px: parseFloat(getComputedStyle(el).fontSize),
        align: getComputedStyle(el).textAlign,
        left: r1(el.getBoundingClientRect().left - b.left),
      })),
      small,
    };
  });
}

/** Every title row on the screen alike, whatever the box's text size: what is different, one line each. */
function headerMismatches(boxes: Box[]): string[] {
  const cards = boxes.filter((b) => b.header);
  const odd: string[] = [];
  for (const key of ["title", "icon", "badge", "height", "top", "left"] as const) {
    const vals = cards.map((c) => c.header![key]);
    // Within a pixel: boxes are drawn at whole pixels.
    if (Math.max(...vals) - Math.min(...vals) > 1) {
      odd.push(`${key}: ${cards.map((c) => `${c.id}(${c.box}px) ${c.header![key]}`).join(", ")}`);
    }
  }
  return odd;
}

function smallText(boxes: Box[]): string[] {
  return boxes.flatMap((b) => b.small.map((t) => `${b.id} (text ${b.box}px): ${t} is below the meta size`));
}

/** A throwaway family of its own, through the API (rate-limited: five a minute). */
async function newFamily(browser: Browser, width: number, height: number, label: string) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    serviceWorkers: "block",
    reducedMotion: "reduce",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  });
  const name = `claude-hh-${label}-${Date.now()}`;
  let res = await ctx.request.post(`${BASE}/api/session/create`, { data: { familyName: name, hardwareId: name, deviceName: name } });
  for (let i = 0; i < 6 && res.status() === 429; i++) {
    await new Promise((r) => setTimeout(r, 15_000));
    res = await ctx.request.post(`${BASE}/api/session/create`, { data: { familyName: name, hardwareId: name, deviceName: name } });
  }
  expect(res.ok(), `session/create ${res.status()}`).toBe(true);
  const created = await res.json();
  return { ctx, name, family: created.family, device: created.device };
}

/** YYYY-MM-DD of today + `days` in Berlin, as the page reckons its days. */
function dayKey(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(d);
}

/**
 * A household's data, so each widget shows the state it shows at home, not
 * its empty or set-up one: two children (the schedule's chips in its title
 * row) with lessons every day that are over by the afternoon, events,
 * birthdays, bin days, a holiday region, a car with its picture and its
 * readings; and no messages, the one list left empty on purpose.
 */
function seed(fam: string): void {
  psql(`UPDATE families SET setup_completed = true WHERE id = '${fam}'`);
  const kids = psql(
    `INSERT INTO people (family_id, name, color, is_child) VALUES ('${fam}', 'Henrik', '#64b5f6', true), ('${fam}', 'Enno', '#81c784', true) RETURNING id`,
  )
    .split("\n")
    .filter((l) => /^[0-9a-f-]{36}$/.test(l));
  psql(`INSERT INTO people (family_id, name, color, is_child) VALUES ('${fam}', 'Anna', '#e57373', false)`);
  const slots = JSON.stringify([
    { period: 1, start: "08:00", end: "08:45", subject: "Mathe" },
    { period: 2, start: "08:50", end: "09:35", subject: "Deutsch" },
    { period: 3, start: "09:55", end: "10:40", subject: "Sport" },
  ]);
  for (const kid of kids) {
    for (let dow = 0; dow < 7; dow++) {
      psql(`INSERT INTO schedules (family_id, person_id, day_of_week, time_slots) VALUES ('${fam}', '${kid}', ${dow}, ${sqlText(slots)}::jsonb)`);
    }
  }
  // No preview of the next school day in the evening: the day stays the day without lessons left.
  psql(`INSERT INTO settings (family_id, key, value) VALUES ('${fam}', 'schedule_widget', '{"tomorrowFrom":"off"}'::jsonb) ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value`);
  psql(`INSERT INTO settings (family_id, key, value) VALUES ('${fam}', 'holiday_region', '{"code":"DE-NI","chosen":true}'::jsonb) ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value`);
  const cal = psqlRow(`INSERT INTO calendars (family_id, name, color) VALUES ('${fam}', 'Familie', '#3b82f6') RETURNING id`);
  const waste = psqlRow(`INSERT INTO calendars (family_id, name, color, is_waste_collection) VALUES ('${fam}', 'Abfall', '#795548', true) RETURNING id`);
  const ev = (calendar: string, title: string, day: number, time: string | null) => {
    const start = time ? `'${dayKey(day)} ${time}:00 Europe/Berlin'` : `'${dayKey(day)} 00:00:00 Europe/Berlin'`;
    const end = time ? `${start}::timestamptz + interval '1 hour'` : `${start}::timestamptz + interval '1 day'`;
    psql(`INSERT INTO events (calendar_id, title, start_at, end_at, all_day) VALUES ('${calendar}', ${sqlText(title)}, ${start}, ${end}, ${time ? "false" : "true"})`);
  };
  ev(cal, "Elternabend", 1, "19:30");
  ev(cal, "Zahnarzt Henrik", 2, "15:00");
  ev(cal, "Schwimmkurs", 3, "16:15");
  ev(cal, "Oma kommt", 5, null);
  ev(waste, "Restmüll", 1, null);
  ev(waste, "Gelber Sack", 3, null);
  ev(waste, "Papier", 6, null);
  const bday = (name: string, days: number) => {
    const [, m, d] = dayKey(days).split("-");
    psql(`INSERT INTO birthdays (family_id, name, date) VALUES ('${fam}', ${sqlText(name)}, '1960-${m}-${d}')`);
  };
  bday("Oma Ilse", 4);
  bday("Onkel Jan", 19);
  psql(
    `INSERT INTO vehicles (family_id, position, vendor, nickname, config) VALUES ('${fam}', 0, 'tesla', 'Model Y', '{"battery_level":"sensor.car_battery","battery_range":"sensor.car_range"}'::jsonb)`,
  );
}

/** The Küche layout's boxes (1080x1920, 14 boxes, text S, M and L). */
const KUECHE = readFileSync(join(__dirname, "fixtures/home-portrait-step-minimums.json"), "utf8");

/**
 * The same widgets on a 1920x1080 panel: four columns of 12 steps, each
 * box at least its minimum at its text size, the lists at S and the car at
 * L as in the kitchen.
 */
function landscapeHome(): string {
  const a = homeArea(1920, 1080);
  const rows = gridFor(a.width, a.height)!.rows;
  const cols: [HomeWidgetKey, TextSize][][] = [
    [["weather", "M"], ["birthday", "S"]],
    [["upcomingEvents", "M"], ["wasteCollection", "S"]],
    [["schedule", "M"], ["holidays", "S"]],
    [["messages", "M"], ["vehicles", "L"]],
  ];
  const items: HomeLayoutItem[] = [];
  cols.forEach((col, c) => {
    const mins = col.map(([w, t]) => homeMin(w, t, a.width, a.height).h);
    const spare = Math.max(0, rows - mins.reduce((s, h) => s + h, 0));
    let y = 0;
    col.forEach(([widget, text], i) => {
      const h = mins[i] + Math.floor(spare / col.length);
      items.push({ id: widget, widget, x: c * 12, y, w: Math.max(12, homeMin(widget, text, a.width, a.height).w), h, text } as HomeLayoutItem);
      y += h;
    });
  });
  return JSON.stringify(items);
}

test.describe("drawn with a household's data", () => {
  test.skip(!BASE, "needs PLAYWRIGHT_BASE_URL");

  const REAL: { name: string; width: number; height: number; home: () => string }[] = [
    { name: "kueche-1080x1920", width: 1080, height: 1920, home: () => KUECHE },
    { name: "landscape-1920x1080", width: 1920, height: 1080, home: landscapeHome },
  ];

  for (const c of REAL) {
    test(`${c.name}: one title row on the whole screen, one empty-state line`, async ({ browser, browserName }) => {
      test.setTimeout(300_000);
      const { ctx, name, family, device } = await newFamily(browser, c.width, c.height, `${browserName}-${c.width}`);
      const fam = family.id as string;
      try {
        seed(fam);
        const layout = psqlRow(
          `INSERT INTO layouts (family_id, name, width, height, grid, home) VALUES ('${fam}', '${name}', ${c.width}, ${c.height}, 48, ${sqlText(c.home())}::jsonb) RETURNING id`,
        );
        psql(`UPDATE devices SET is_kiosk = true, layout_id = '${layout}' WHERE id = '${device.id}'`);
        await ctx.addCookies([
          {
            name: "family-calendar-storage",
            value: encodeURIComponent(JSON.stringify({ state: { family, device: { ...device, is_kiosk: true, layout_id: layout } }, version: 0 })),
            url: BASE!,
          },
          { name: "NEXT_LOCALE", value: "de", url: BASE! },
        ]);
        const page = await ctx.newPage();
        // A Home Assistant that answers with the car's readings: its connection, and the two sensors.
        let ha = 0;
        await page.route(/\/api\/settings\?.*key=home_assistant/, (route) => {
          ha++;
          return route.fulfill({ json: { value: { url: "http://ha.invalid", access_token: "test" } } });
        });
        await page.route(/\/api\/homeassistant\/states/, (route) => {
          ha++;
          return route.fulfill({
            json: {
              entities: [
              { entity_id: "sensor.car_battery", state: "66", attributes: { unit_of_measurement: "%" } },
              { entity_id: "sensor.car_range", state: "340", attributes: { unit_of_measurement: "km" } },
              ],
            },
          });
        });
        // The afternoon of today, Berlin time: every lesson is over ("Schule ist aus!", or the weekend's line).
        await page.clock.setFixedTime(new Date(`${dayKey(0)}T15:30:00+01:00`));
        await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("designed-home")).toBeVisible({ timeout: 120_000 });
        // The data has arrived: an event row, the car's charge.
        await expect(page.locator("[data-layout-id=upcomingEvents] a[href^='/calendar?event=']").first()).toBeVisible({ timeout: 60_000 });
        await expect(page.locator("[data-layout-id=vehicles]")).toContainText("66", { timeout: 60_000 });
        await page.waitForTimeout(4000);
        // Nothing still loading (a refetch puts a card back in its loading state for a moment).
        await expect(page.locator("[data-testid=designed-home-grid] .animate-pulse")).toHaveCount(0, { timeout: 30_000 });
        await expect(page.locator("[data-layout-id=schedule]")).not.toBeEmpty();
        expect(ha, "the Home Assistant stubs answered").toBeGreaterThan(0);

        const boxes = await page.evaluate(measure);
        console.log(browserName, c.name, JSON.stringify(boxes.map(({ small: _s, ...rest }) => rest)));

        // The states this is about, so a green run cannot be an empty screen.
        const byId = new Map(boxes.map((b) => [b.id, b]));
        const sched = page.locator("[data-layout-id=schedule]");
        await expect(sched.locator("[data-box-header] button[aria-pressed]"), "the children's chips in the schedule's title row").toHaveCount(2);
        await expect(sched).not.toContainText("Mathe");
        await expect(page.locator("[data-layout-id=birthday]")).toContainText("Oma Ilse");
        await expect(page.locator("[data-layout-id=wasteCollection]")).toContainText(/Restm/);
        await expect(page.locator("[data-layout-id=holidays] [data-list-shown]").first()).not.toHaveAttribute("data-list-shown", "0");

        const odd: string[] = [];
        // Every box but the clock block's values and strips and a photo has the shared title row.
        for (const b of boxes) if (b.drawn && !HEADLESS.has(b.widget) && !b.header) odd.push(`${b.id}: no title row`);
        odd.push(...headerMismatches(boxes));
        // Two boxes side by side have their titles on one line.
        const rowOf = (id: string) => byId.get(id)?.header?.titleTop;
        for (const [l, r] of [["schedule", "upcomingEvents"], ["messages", "holidays"]]) {
          const a = rowOf(l);
          const z = rowOf(r);
          if (a !== undefined && z !== undefined && Math.abs(a - z) > 1) odd.push(`${l} and ${r}: titles ${a} and ${z} from their box's top`);
        }
        // Empty and special states: one role (body, at the box's text size), at the start of the line, under the title.
        for (const id of ["schedule", "messages"]) {
          if (byId.has(id) && !byId.get(id)!.empties.length) odd.push(`${id}: its empty state is not the shared line`);
        }
        for (const b of boxes) {
          for (const e of b.empties) {
            const want = Math.round(b.box * 0.78 * 10) / 10;
            if (Math.abs(e.px - want) > 0.5) odd.push(`${b.id} "${e.text}": ${e.px}px, not the body role (${want}px)`);
            if (!["start", "left"].includes(e.align)) odd.push(`${b.id} "${e.text}": aligned ${e.align}`);
            if (b.header && Math.abs(e.left - b.header.left) > 1) odd.push(`${b.id} "${e.text}": starts at ${e.left}, the title row at ${b.header.left}`);
          }
        }
        odd.push(...smallText(boxes));
        expect(odd).toEqual([]);
      } finally {
        await ctx.request.delete(`${BASE}/api/family`, { data: { family_id: fam, confirm_name: name } }).catch(() => undefined);
        try {
          psql(`DELETE FROM families WHERE id = '${fam}'`);
        } catch {
          // Gone already, through the API.
        }
        await ctx.close();
      }
    });
  }
});

/**
 * Drawn on a family's own data (HOME_LISTS_CODE): the Küche layout and the
 * built-in Home redrawn as a layout on seven screens of every shape. On
 * each, every title row is alike and no text on screen is smaller than the
 * meta role at its box's text size (a line too big for its box is left
 * out, never shrunk below that).
 */
const SCREENS: [number, number][] = [[1080, 1920], [720, 1280], [800, 1280], [1024, 768], [1280, 800], [1920, 1080], [2560, 1080]];
const CASES: { name: string; width: number; height: number; home: () => string }[] = [
  { name: "saved-1080x1920", width: 1080, height: 1920, home: () => KUECHE },
  ...SCREENS.map(([width, height]) => ({
    name: `built-in-${width}x${height}`,
    width,
    height,
    home: () => {
      const a = homeArea(width, height);
      return JSON.stringify(builtInHome(a.width, a.height));
    },
  })),
];

test.describe("drawn on a family's data", () => {
  // In a describe, not inside the test: the `browser` fixture launches a
  // browser before a test body runs, so a skip in the body still fails on a
  // runner without one (CI's stack-free Specs job).
  test.skip(!BASE || !CODE, "needs PLAYWRIGHT_BASE_URL and HOME_LISTS_CODE");

  for (const c of CASES) {
    test(`${c.name}: one type scale, one frame, no text below the meta size`, async ({ browser, browserName }) => {
      test.setTimeout(240_000);
      const fam = psqlRow(`SELECT id FROM families WHERE join_code = ${sqlText(CODE!)}`);
      const hw = `claude-hh-frame-${browserName}-${Date.now()}`;
      const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, serviceWorkers: "block", reducedMotion: "reduce" });
      const joined = await (await ctx.request.post(`${BASE}/api/session/join`, { data: { joinCode: CODE, deviceName: hw, hardwareId: hw } })).json();
      const layout = psqlRow(
        `INSERT INTO layouts (family_id, name, width, height, grid, home) VALUES ('${fam}', '${hw}', ${c.width}, ${c.height}, 48, ${sqlText(c.home())}::jsonb) RETURNING id`,
      );
      try {
        psql(`UPDATE devices SET is_kiosk = true, layout_id = '${layout}' WHERE id = '${joined.device.id}'`);
        const device = { ...joined.device, is_kiosk: true, layout_id: layout };
        await ctx.addCookies([
          { name: "family-calendar-storage", value: encodeURIComponent(JSON.stringify({ state: { family: joined.family, device }, version: 0 })), url: BASE! },
          { name: "NEXT_LOCALE", value: "de", url: BASE! },
        ]);
        const page = await ctx.newPage();
        await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("designed-home")).toBeVisible({ timeout: 120_000 });
        await page.waitForTimeout(8000);
        const boxes = await page.evaluate(measure);
        console.log(browserName, c.name, JSON.stringify(boxes.map(({ small: _s, ...rest }) => rest)));
        expect(boxes.filter((b) => b.header).length).toBeGreaterThanOrEqual(3);
        expect([...headerMismatches(boxes), ...smallText(boxes)]).toEqual([]);
      } finally {
        psql(`DELETE FROM devices WHERE id = '${joined.device.id}'`);
        psql(`DELETE FROM layouts WHERE id = '${layout}'`);
        await ctx.close();
      }
    });
  }
});
