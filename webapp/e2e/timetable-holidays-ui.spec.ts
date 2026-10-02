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
 * The timetable widget on a day off, rendered (#330). It went by the weekday
 * alone: Monday's lessons on the first Monday of the autumn break, and in the
 * evening a "next school day" that only ever skipped Saturday and Sunday.
 *
 * A throwaway family in Lower Saxony with one child, who has a different
 * first lesson every weekday (so the screen says which day's lessons it
 * shows). Herbstferien typed in from 12 to 23 October 2026, a holiday
 * calendar with a Brückentag on Monday 26 October, and Christmas Day on a
 * Friday. Settings → Calendar → Holidays is OFF for this family on purpose:
 * whether there is school is not a display preference, and the widget
 * answers it anyway, as the server does.
 *
 * Run with --project=webkit (1440 and, resized, 390) as well as Chromium.
 * Needs FAMILY_CODE (a running stack).
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");

// The PWA service worker answers fetches before page.route sees them.
test.use({ serviceWorkers: "block", timezoneId: "Europe/Berlin" });
test.describe.configure({ mode: "serial" });

/** Per project: Chromium and WebKit run in parallel workers, each cleaning up only its own. */
let P = "";
const DEVICE = () => `claude-timetable-${P.split("-").at(-2)}-`;
const SHOTS = process.env.TIMETABLE_SHOTS ?? "";

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

/** First lesson per weekday, 1 = Monday. */
const FIRST = { 1: "Mathe", 2: "Deutsch", 3: "Englisch", 4: "Physik", 5: "Kunst" } as const;

function purge() {
  const stale = psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`);
  for (const id of stale.split(",").filter(Boolean)) {
    psql(`DELETE FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE family_id = '${id}')`);
    psql(`DELETE FROM calendars WHERE family_id = '${id}'`);
    psql(`DELETE FROM schedules WHERE family_id = '${id}'`);
    // people has a soft-delete trigger: a plain DELETE would only bin them.
    psql(`SET kinboard.hard_delete = 'on'; DELETE FROM people WHERE family_id = '${id}'`);
    psql(`DELETE FROM families WHERE id = '${id}'`, "supabase_admin");
  }
  psql(`DELETE FROM devices WHERE hardware_id LIKE 'e2e-${DEVICE()}%'`);
}

test.beforeAll(({}, testInfo) => {
  P = `e2e-claude-timetable-${testInfo.project.name}-`;
  purge();
  joinCode = `TT${randomBytes(4).toString("hex").toUpperCase()}`;
  familyId = psql(
    `INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${joinCode}', true) RETURNING id`,
  );
  put("holiday_region", { code: "DE-NI", chosen: true });
  put("school_holiday_sync", { enabled: false, region: null, group: null, pending: null, last_success_at: null, last_error_at: null, last_error: null });
  // Off: the widget must not depend on it (see the header).
  put("calendar_display", { showHolidays: false, showTasks: false, tasksAsEvents: false });
  put("widget_visibility", { schedule: true });
  put("schedule_widget", { perChild: false, equalSize: false, tomorrowFrom: "17:00" });
  const child = psql(
    `INSERT INTO people (family_id, name, color, is_child) VALUES ('${familyId}', 'Mara', '#a855f7', true) RETURNING id`,
  );
  for (const [dow, first] of Object.entries(FIRST)) {
    const slots = [
      { period: 1, start: "08:00", end: "08:45", subject: first },
      { period: 2, start: "08:50", end: "09:35", subject: "Sport" },
      { period: 3, start: "09:55", end: "10:40", subject: "Musik" },
    ];
    psql(
      `INSERT INTO schedules (family_id, person_id, day_of_week, time_slots)
       VALUES ('${familyId}', '${child}', ${dow}, ${quote(JSON.stringify(slots))}::jsonb)`,
    );
  }
  psql(
    `INSERT INTO school_holidays (family_id, name, starts_on, ends_on) VALUES
       ('${familyId}', 'Herbstferien', '2026-10-12', '2026-10-23')`,
  );
  const calendarId = psql(
    `INSERT INTO calendars (family_id, name, color, is_holidays) VALUES ('${familyId}', '${P}Schulkalender', '#22c55e', true) RETURNING id`,
  );
  // Stored as Google sync stores an all-day event: 12:00 UTC of the day.
  psql(
    `INSERT INTO events (calendar_id, title, start_at, end_at, all_day) VALUES
       ('${calendarId}', 'Brückentag', '2026-10-26T12:00:00Z', '2026-10-26T12:00:00Z', true)`,
  );
});

test.afterAll(() => {
  if (!familyId) return;
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM school_holidays WHERE family_id = '${familyId}'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM people WHERE family_id = '${familyId}'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM devices WHERE hardware_id LIKE 'e2e-${DEVICE()}%'`)).toBe("0");
});

type Locale = "de" | "fr";
const messages = (locale: Locale) =>
  JSON.parse(readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8")) as Record<string, Record<string, string>>;

/** Christmas Day 2026 as the page names it in `locale`. */
function christmas(locale: Locale): string {
  const holidays = messages(locale).holidays;
  const t = Object.assign((key: string) => holidays[key], { has: (key: string) => key in holidays });
  const day = getHolidays("DE-NI", 2026, locale).find((h) => h.date.getMonth() === 11 && h.date.getDate() === 25)!;
  return holidayLabel(day, t);
}

/** Counts the widget's reads of what decides a day off; each is let through. */
async function countReads(page: Page) {
  const hits = { schoolHolidays: 0, holidayCalendars: 0 };
  await page.route(/\/rest\/v1\/school_holidays\?/, (route) => {
    hits.schoolHolidays++;
    return route.continue();
  });
  await page.route(/\/rest\/v1\/events\?.*calendar\.is_holidays=eq\.true/, (route) => {
    hits.holidayCalendars++;
    return route.continue();
  });
  return hits;
}

async function open(page: Page, locale: Locale, device: string, width: number, at: string) {
  await page.setViewportSize({ width, height: width < 500 ? 844 : 810 });
  await page.clock.setFixedTime(new Date(at));
  const base = test.info().project.use.baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
  await establishSession(page, joinCode, `${DEVICE()}${device}`);
  put("locale", locale);
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

const TITLE = /^(Stundenplan|Emploi du temps)$/;
const card = (page: Page) =>
  page.getByRole("heading", { name: TITLE }).locator("xpath=ancestor::*[contains(@class,'accent-border-top')][1]");

/** Faded in (framer-motion starts the card at opacity 0 and scale 0.95). */
async function settle(page: Page, locator: ReturnType<Page["locator"]>) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect
    .poll(() => locator.evaluate((el) => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        if (Number(getComputedStyle(node).opacity) < 1) return false;
      }
      return true;
    }), { timeout: 15_000 })
    .toBe(true);
}

async function shot(locator: ReturnType<Page["locator"]>, testInfo: TestInfo, name: string) {
  const file = `timetable-${name}-${testInfo.project.name}.png`;
  await locator.screenshot({ path: SHOTS ? join(SHOTS, file) : testInfo.outputPath(file) });
}

const NO_SCHOOL = { de: "Heute keine Schule", fr: "Pas d’école aujourd’hui" } as const;

for (const locale of ["de", "fr"] as const) {
  for (const width of [1440, 390]) {
    test(`${locale} ${width}: a day in the autumn break shows the break, not Monday's lessons`, async ({ page }, testInfo) => {
      const hits = await countReads(page);
      // Monday 12 October 2026, 09:00: first day of the Herbstferien.
      await open(page, locale, `break-${locale}-${width}`, width, "2026-10-12T09:00:00+02:00");
      const widget = card(page);
      const dayOff = widget.locator("[data-day-off]");
      await expect(dayOff).toBeVisible({ timeout: 30_000 });
      await expect(dayOff).toHaveAttribute("data-day-off", "2026-10-12");
      await expect(dayOff).toContainText("Herbstferien");
      await expect(dayOff).toContainText(NO_SCHOOL[locale]);
      await expect(widget).not.toContainText(FIRST[1]);
      expect(hits.schoolHolidays, "the school holidays were never read").toBeGreaterThan(0);
      expect(hits.holidayCalendars, "the holiday calendars were never read").toBeGreaterThan(0);
      const fits = await widget.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(fits, "the card overflows sideways").toBe(true);
      await settle(page, widget);
      await shot(widget, testInfo, `break-${locale}-${width}`);
    });

    test(`${locale} ${width}: a public holiday on a weekday is named`, async ({ page }, testInfo) => {
      // Friday 25 December 2026, 09:00.
      await open(page, locale, `xmas-${locale}-${width}`, width, "2026-12-25T09:00:00+01:00");
      const widget = card(page);
      const dayOff = widget.locator("[data-day-off]");
      await expect(dayOff).toBeVisible({ timeout: 30_000 });
      await expect(dayOff).toContainText(christmas(locale));
      await expect(widget).not.toContainText(FIRST[5]);
      await settle(page, widget);
      await shot(widget, testInfo, `holiday-${locale}-${width}`);
    });

    test(`${locale} ${width}: Friday evening before the break previews the first day back, past the Brückentag`, async ({ page }, testInfo) => {
      const hits = await countReads(page);
      // Friday 9 October 2026, 18:00, after the 17:00 switch to tomorrow.
      // Monday 12 is in the break, the break runs to Friday 23, Monday 26 is
      // a Brückentag on the holiday calendar: Tuesday 27 is the next school day.
      await open(page, locale, `next-${locale}-${width}`, width, "2026-10-09T18:00:00+02:00");
      const widget = card(page);
      const label = widget.locator("[data-next-school-day]");
      await expect(label).toBeVisible({ timeout: 30_000 });
      await expect(label).toHaveAttribute("data-next-school-day", "2026-10-27");
      await expect(label).toContainText(locale === "de" ? "Nächster Schultag: Di. 27. Okt." : "Prochain jour d’école : mar. 27 oct.");
      // Tuesday's lessons, not Monday's.
      await expect(widget).toContainText(FIRST[2]);
      await expect(widget).not.toContainText(FIRST[1]);
      expect(hits.holidayCalendars).toBeGreaterThan(0);
      await settle(page, widget);
      await shot(widget, testInfo, `next-${locale}-${width}`);
    });
  }
}
