import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "child_process";
import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";
import { getHolidays } from "../src/lib/holidays";
import { holidayLabel } from "../src/lib/holidays/label";

/**
 * Holidays in the Events widget, the week overview and the screensaver,
 * rendered (RFC-014). With a holiday calendar switched off, those views
 * showed no holidays at all: they only ever listed calendar events.
 *
 * A throwaway family in Lower Saxony, the browser clock fixed at noon on
 * Friday 2 October 2026: Tag der Deutschen Einheit is tomorrow, a school
 * break typed in runs from Wednesday to the next Wednesday, and a synced
 * break the family hid sits on Monday. Run with --project=webkit (1440 and,
 * resized, 390) as well as Chromium. Needs FAMILY_CODE (a running stack).
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");

// The PWA service worker answers fetches before page.route sees them.
test.use({ serviceWorkers: "block", timezoneId: "Europe/Berlin" });
// One family, one set of rows: the tests change its settings in turn.
test.describe.configure({ mode: "serial" });

/**
 * Everything this spec makes is named from this, per project: Chromium and
 * WebKit run in parallel workers, and each must only ever clean up its own.
 * The device prefix is what establishSession adds, `e2e-`, plus the name.
 */
let P = "";
const DEVICE = () => `claude-holwidgets-${P.split("-").at(-2)}-`;
const NOW = new Date("2026-10-02T12:00:00+02:00");
const SHOTS = process.env.HOLIDAY_WIDGET_SHOTS ?? "";

function psql(sql: string, user = "postgres"): string {
  return execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", user, "-d", "postgres", "-tA", "-q", "-c", sql], {
    encoding: "utf8",
  }).trim();
}
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

let familyId = "";
let joinCode = "";

function put(key: string, value: unknown) {
  psql(
    `INSERT INTO settings (family_id, key, value) VALUES ('${familyId}', '${key}', ${quote(JSON.stringify(value))}::jsonb)
     ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value`,
  );
}

const LONG_NAME =
  "Herbstferien der Grundschule am Schlossgarten mit Betreuungsangebot und Ferienprogramm des Fördervereins";

function purge() {
  const stale = psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`);
  for (const id of stale.split(",").filter(Boolean)) {
    // Synced rows only go as the sync's owner would remove them; a family
    // delete cascades past the browser-only trigger.
    psql(`DELETE FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE family_id = '${id}')`);
    psql(`DELETE FROM calendars WHERE family_id = '${id}'`);
    psql(`DELETE FROM families WHERE id = '${id}'`, "supabase_admin");
  }
  psql(`DELETE FROM devices WHERE hardware_id LIKE 'e2e-${DEVICE()}%'`);
}

test.beforeAll(({}, testInfo) => {
  P = `e2e-claude-holwidgets-${testInfo.project.name}-`;
  purge();
  joinCode = `HW${randomBytes(4).toString("hex").toUpperCase()}`;
  familyId = psql(
    `INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${joinCode}', true) RETURNING id`,
  );
  put("holiday_region", { code: "DE-NI", chosen: true });
  // No sync: the rows below are the whole story, and a cron run must not replace them.
  put("school_holiday_sync", { enabled: false, region: null, group: null, pending: null, last_success_at: null, last_error_at: null, last_error: null });
  put("calendar_display", { showHolidays: true, showTasks: false, tasksAsEvents: false });
  put("widget_visibility", { upcomingEvents: true, weekOverview: true });
  psql(
    `INSERT INTO school_holidays (family_id, name, starts_on, ends_on) VALUES
       ('${familyId}', 'Herbstferien', '2026-09-30', '2026-10-07')`,
  );
  // A synced row the family hid (RFC-014 §6.2): never shown. Written as the
  // service role would; the browser cannot write a synced row.
  psql(
    `INSERT INTO school_holidays (family_id, name, starts_on, ends_on, source, external_id, hidden, synced_at) VALUES
       ('${familyId}', 'Versteckte Ferien', '2026-10-05', '2026-10-05', 'openholidays', '${P}hidden', true, now())`,
    "supabase_admin",
  );
});

test.afterAll(() => {
  if (!familyId) return;
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM school_holidays WHERE family_id = '${familyId}'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM devices WHERE hardware_id LIKE 'e2e-${DEVICE()}%'`)).toBe("0");
});

type Locale = "de" | "fr";
const messages = (locale: Locale) =>
  JSON.parse(readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8")) as Record<string, Record<string, string>>;

/** Tag der Deutschen Einheit as the page names it in `locale`. */
function unityDay(locale: Locale): string {
  const holidays = messages(locale).holidays;
  const t = Object.assign((key: string) => holidays[key], { has: (key: string) => key in holidays });
  const day = getHolidays("DE-NI", 2026, locale).find((h) => h.date.getMonth() === 9 && h.date.getDate() === 3)!;
  return holidayLabel(day, t);
}

async function open(page: Page, locale: Locale, device: string, width: number, screensaver = false) {
  // Idle after two seconds for the screensaver's tests; never for the others,
  // or it covers the widgets halfway through.
  put("screensaver", { screensaverTimeout: screensaver ? 2 : 0 });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 810 });
  await page.clock.setFixedTime(NOW);
  const base = test.info().project.use.baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
  await establishSession(page, joinCode, `${DEVICE()}${device}`);
  // A phone gets no screensaver unless the device is a kiosk.
  if (screensaver) psql(`UPDATE devices SET is_kiosk = true WHERE hardware_id = 'e2e-${DEVICE()}${device}'`);
  put("locale", locale);
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

/** The widget card whose heading is `name`. */
const card = (page: Page, name: RegExp) =>
  page.getByRole("heading", { name }).locator("xpath=ancestor::*[contains(@class,'accent-border-top')][1]");

const EVENTS = /^(Termine|Événements)$/;
const WEEK = /^(Wochenübersicht|Aperçu de la semaine)$/;

/** Faded in (framer-motion starts the cards at opacity 0): what is not at 1, if anything. */
async function settle(page: Page, locator: ReturnType<Page["locator"]>) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect
    .poll(
      () =>
        locator.evaluate((el) => {
          const faded: string[] = [];
          for (let node: Element | null = el; node; node = node.parentElement) {
            const opacity = Number(getComputedStyle(node).opacity);
            if (opacity < 1) faded.push(`${node.tagName}.${String(node.className).slice(0, 60)}=${opacity}`);
          }
          return faded;
        }),
      { timeout: 15_000 },
    )
    .toEqual([]);
}

async function shot(locator: ReturnType<Page["locator"]>, testInfo: TestInfo, name: string) {
  const file = `holiday-widgets-${name}-${testInfo.project.name}.png`;
  await locator.screenshot({ path: SHOTS ? join(SHOTS, file) : testInfo.outputPath(file) });
}

for (const locale of ["de", "fr"] as const) {
  for (const width of [1440, 390]) {
    test(`${locale} ${width}: the Events widget and the week overview list public and school holidays`, async ({ page }, testInfo) => {
      await open(page, locale, `${locale}-${width}`, width);
      const holidayName = unityDay(locale);
      const tomorrow = locale === "de" ? "Morgen" : "Demain";

      // ---- Events widget
      const events = card(page, EVENTS);
      await expect(events.locator('[data-holiday="true"]').first()).toBeVisible({ timeout: 30_000 });
      const rows = events.locator('[data-holiday="true"]');
      await expect(rows).toHaveCount(2);
      // The break under way first, under today, with the day it ends; then tomorrow's holiday.
      await expect(rows.nth(0)).toContainText("Herbstferien");
      await expect(events.getByText(locale === "de" ? "Heute" : "Aujourd'hui", { exact: true })).toBeVisible();
      await expect(rows.nth(0)).toContainText(locale === "de" ? "bis Mi. 7. Okt." : "jusqu'au mer. 7 oct.");
      await expect(rows.nth(1)).toContainText(holidayName);
      await expect(rows.nth(1)).toContainText(tomorrow);
      await expect(events).not.toContainText("Versteckte Ferien");
      await settle(page, events);
      await shot(events, testInfo, `events-${locale}-${width}`);

      // ---- Week overview: Saturday 3 October ringed, the break banded on
      // Friday to Wednesday (6 of the 7 days), both named under the grid.
      const week = card(page, WEEK);
      await expect(week.locator('div[data-holiday="public"]')).toHaveCount(1);
      await expect(week.locator('div[data-holiday="public"]')).toHaveText(/^3/);
      await expect(week.locator('div[data-holiday="school"]')).toHaveCount(6);
      const list = week.locator("li[data-holiday]");
      await expect(list).toHaveCount(2);
      // The break began before the week did: first, from today to its end.
      await expect(list.nth(0)).toContainText("Herbstferien");
      await expect(list.nth(1)).toContainText(holidayName);
      await expect(week).not.toContainText("Versteckte Ferien");
      const fits = await week.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(fits, "the week overview overflows sideways").toBe(true);
      await settle(page, week);
      await shot(week, testInfo, `week-${locale}-${width}`);
    });

    test(`${locale} ${width}: the screensaver lists holidays, wraps a long name and keeps to four rows`, async ({ page }, testInfo) => {
      psql(
        `INSERT INTO school_holidays (family_id, name, starts_on, ends_on) VALUES
           ('${familyId}', ${quote(LONG_NAME)}, '2026-10-06', '2026-10-06'),
           ('${familyId}', 'Brückentag', '2026-10-08', '2026-10-08'),
           ('${familyId}', 'Studientag', '2026-10-09', '2026-10-09')`,
      );
      try {
        await open(page, locale, `ss-${locale}-${width}`, width, true);
        const screensaver = page.locator(".screensaver-slide-right");
        await expect(screensaver.locator("[data-holiday]").first()).toBeVisible({ timeout: 30_000 });
        const rows = screensaver.locator("[data-holiday]");
        // Five entries in the next seven days; the list keeps to four.
        await expect(rows).toHaveCount(4);
        await expect(rows.nth(0)).toContainText("Herbstferien");
        await expect(rows.nth(1)).toContainText(unityDay(locale));
        await expect(screensaver).not.toContainText("Versteckte Ferien");

        const long = rows.filter({ hasText: "Schlossgarten" });
        await expect(long).toHaveCount(1);
        const geometry = await long.evaluate((row) => {
          const title = row.querySelector("p")!;
          const r = row.getBoundingClientRect();
          const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
          return {
            rowFits: row.scrollWidth <= row.clientWidth + 1,
            titleLines: Math.round(title.getBoundingClientRect().height / lineHeight),
            inViewport: r.left >= 0 && r.right <= window.innerWidth + 0.5,
          };
        });
        expect(geometry.rowFits, "the long name overflows its row").toBe(true);
        expect(geometry.inViewport, "the row runs off the screen").toBe(true);
        // Wrapped, not cut to one line -- and clamped at two.
        expect(geometry.titleLines).toBe(2);
        await page.waitForTimeout(1_000);
        await shot(screensaver, testInfo, `screensaver-${locale}-${width}`);
      } finally {
        psql(`DELETE FROM school_holidays WHERE family_id = '${familyId}' AND name IN (${quote(LONG_NAME)}, 'Brückentag', 'Studientag')`);
      }
    });
  }
}

test("a holiday calendar that has the day already is not doubled", async ({ page }) => {
  const calendarId = psql(
    `INSERT INTO calendars (family_id, name, color, is_holidays) VALUES ('${familyId}', '${P}Feiertage', '#22c55e', true) RETURNING id`,
  );
  psql(
    `INSERT INTO events (calendar_id, title, start_at, end_at, all_day) VALUES
       ('${calendarId}', 'Tag d. Dt. Einheit', '2026-10-03T00:00:00+02:00', '2026-10-04T00:00:00+02:00', true)`,
  );
  try {
    await open(page, "de", "dedupe", 1440);
    const events = card(page, EVENTS);
    await expect(events).toContainText("Tag d. Dt. Einheit", { timeout: 30_000 });
    // The calendar's event stays; the built-in one for the same day goes.
    await expect(events.locator('[data-holiday="true"]')).toHaveCount(1);
    await expect(events.locator('[data-holiday="true"]')).toContainText("Herbstferien");
    await expect(events).not.toContainText(unityDay("de"));
  } finally {
    psql(`DELETE FROM events WHERE calendar_id = '${calendarId}'`);
    psql(`DELETE FROM calendars WHERE id = '${calendarId}'`);
  }
});

test("with Holidays switched off, nothing is listed and school holidays are not fetched", async ({ page }) => {
  put("calendar_display", { showHolidays: false, showTasks: false, tasksAsEvents: false });
  try {
    let schoolReads = 0;
    page.on("request", (req) => {
      if (/\/rest\/v1\/school_holidays\b/.test(req.url())) schoolReads++;
    });
    let settingsReads = 0;
    await page.route(/\/rest\/v1\/settings\?.*key=eq\.calendar_display/, (route) => {
      settingsReads++;
      return route.continue();
    });
    await open(page, "de", "off", 1440);
    const events = card(page, EVENTS);
    await expect(events).toBeVisible({ timeout: 30_000 });
    await expect(card(page, WEEK)).toBeVisible({ timeout: 30_000 });
    // The switch was read, so its answer is what is on screen.
    await expect.poll(() => settingsReads, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1_500);
    await expect(page.locator("[data-holiday]")).toHaveCount(0);
    expect(schoolReads).toBe(0);
  } finally {
    put("calendar_display", { showHolidays: true, showTasks: false, tasksAsEvents: false });
  }
});
