import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "child_process";
import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";
import { getHolidays } from "../src/lib/holidays";
import { holidayLabel } from "../src/lib/holidays/label";

/**
 * The /schedule page on a day off, rendered: the follow-up to the timetable
 * widget's fix for #330. The page went by the weekday alone, so on the first
 * Monday of the autumn break it highlighted Monday's lessons as today's, and
 * on the Friday evening before it asked the children to pack for a Monday
 * nobody would be at school.
 *
 * The same throwaway family as e2e/timetable-holidays-ui.spec.ts: Lower
 * Saxony, one child with a different first lesson every weekday, Herbstferien
 * typed in from 12 to 23 October 2026, a holiday calendar with a Brückentag
 * on Monday 26 October, Christmas Day on a Friday. Settings → Calendar →
 * Holidays is OFF on purpose: whether there is school is not a display
 * preference, and the page answers it as the widget and the server do.
 *
 * Run with --project=webkit (1440 and, resized, 390) as well as Chromium.
 * Needs FAMILY_CODE (a running stack).
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");

// The PWA service worker answers fetches before page.route sees them.
test.use({ serviceWorkers: "block", timezoneId: "Europe/Berlin" });
// The first visit can wait on a dev server compiling the session routes.
test.describe.configure({ mode: "serial", timeout: 120_000 });

/** Per project: Chromium and WebKit run in parallel workers, each cleaning up only its own. */
let P = "";
const DEVICE = () => `claude-schedpage-${P.split("-").at(-2)}-`;
const SHOTS = process.env.SCHEDULE_PAGE_SHOTS ?? "";

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

/** First lesson per weekday, 1 = Monday. Sport and Musik follow, so every day has a pack list. */
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
  P = `e2e-claude-schedpage-${testInfo.project.name}-`;
  purge();
  joinCode = `SP${randomBytes(4).toString("hex").toUpperCase()}`;
  familyId = psql(
    `INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${joinCode}', true) RETURNING id`,
  );
  put("holiday_region", { code: "DE-NI", chosen: true });
  put("school_holiday_sync", { enabled: false, region: null, group: null, pending: null, last_success_at: null, last_error_at: null, last_error: null });
  // Off: the page must not depend on it (see the header).
  put("calendar_display", { showHolidays: false, showTasks: false, tasksAsEvents: false });
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
  expect(psql(`SELECT count(*) FROM schedules WHERE family_id = '${familyId}'`)).toBe("0");
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

/** Counts the page's reads of what decides a day off; each is let through. */
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
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await page.clock.setFixedTime(new Date(at));
  const base = test.info().project.use.baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
  await establishSession(page, joinCode, `${DEVICE()}${device}`);
  put("locale", locale);
  await page.goto("/schedule", { waitUntil: "domcontentloaded" });
  // The grid is there once the page has its lessons and its holidays.
  await expect(page.locator("[data-week-day]:visible").first()).toBeVisible({ timeout: 60_000 });
}

/** The week view in use at this width: the table's headers, or the day cards on a phone. */
const weekDays = (page: Page) => page.locator("[data-week-day]:visible");

/** The card a heading sits in. */
const cardOf = (heading: Locator) => heading.locator("xpath=ancestor::*[contains(@class,'rounded-2xl')][1]");

/** Faded in (framer-motion starts the cards at opacity 0). */
async function settle(locator: Locator) {
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

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const file = `schedule-page-${name}-${testInfo.project.name}.png`;
  await page.evaluate(() => window.scrollTo(0, 0));
  // Let every staggered card finish fading in before the full-page capture.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOTS ? join(SHOTS, file) : testInfo.outputPath(file), fullPage: true });
}

async function fitsSideways(page: Page) {
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(fits, "the page scrolls sideways").toBe(true);
}

const NO_SCHOOL = { de: "Heute keine Schule", fr: "Pas d’école aujourd’hui" } as const;
const NOW = { de: "Jetzt", fr: "Maintenant" } as const;
const PACK_27 = { de: "Für Di. 27. Okt. einpacken", fr: "À préparer pour mar. 27 oct." } as const;
const NEXT_27 = { de: "Nächster Schultag: Di. 27. Okt.", fr: "Prochain jour d’école : mar. 27 oct." } as const;

for (const locale of ["de", "fr"] as const) {
  for (const width of [1440, 390]) {
    test(`${locale} ${width}: a day in the autumn break is a day off, not Monday's lessons now`, async ({ page }, testInfo) => {
      const hits = await countReads(page);
      // Monday 12 October 2026, 08:10: first day of the Herbstferien, in the
      // middle of what would be the first lesson.
      await open(page, locale, `break-${locale}-${width}`, width, "2026-10-12T08:10:00+02:00");
      const dayOff = page.locator("[data-day-off]");
      await expect(dayOff).toBeVisible();
      await expect(dayOff).toHaveAttribute("data-day-off", "2026-10-12");
      await expect(dayOff).toContainText("Herbstferien");
      await expect(dayOff).toContainText(NO_SCHOOL[locale]);
      // Nothing is "now", there is no progress through today's lessons, no today column.
      await expect(page.getByText(NOW[locale], { exact: true })).toHaveCount(0);
      await expect(page.getByRole("progressbar")).toHaveCount(0);
      // The whole visible week is the break, and says so.
      const days = weekDays(page);
      await expect(days).toHaveCount(5);
      await expect(days.first()).toHaveAttribute("data-week-day", "2026-10-12");
      await expect(page.locator("[data-week-day][data-week-day-off]:visible")).toHaveCount(5);
      await expect(days.first()).toContainText("Herbstferien");
      // The pack list is for the first day back, past the Brückentag.
      await expect(page.locator("[data-pack-for]")).toHaveAttribute("data-pack-for", "2026-10-27");
      await expect(page.locator("[data-pack-for]")).toHaveText(PACK_27[locale]);
      expect(hits.schoolHolidays, "the school holidays were never read").toBeGreaterThan(0);
      expect(hits.holidayCalendars, "the holiday calendars were never read").toBeGreaterThan(0);
      await fitsSideways(page);
      await settle(dayOff);
      await shot(page, testInfo, `break-${locale}-${width}`);
    });

    test(`${locale} ${width}: a public holiday on a weekday is named, and only its day is off`, async ({ page }, testInfo) => {
      // Friday 25 December 2026, 08:10.
      await open(page, locale, `xmas-${locale}-${width}`, width, "2026-12-25T08:10:00+01:00");
      const dayOff = page.locator("[data-day-off]");
      await expect(dayOff).toBeVisible();
      await expect(dayOff).toHaveAttribute("data-day-off", "2026-12-25");
      await expect(dayOff).toContainText(christmas(locale));
      await expect(page.getByText(NOW[locale], { exact: true })).toHaveCount(0);
      // Monday to Thursday that week are school days (no Weihnachtsferien typed in); Friday is not.
      const off = page.locator("[data-week-day][data-week-day-off]:visible");
      await expect(off).toHaveCount(1);
      await expect(off).toHaveAttribute("data-week-day", "2026-12-25");
      await expect(off).toContainText(christmas(locale));
      // Over the weekend to Monday 28th, which is named as before.
      await expect(page.locator("[data-pack-for]")).toHaveAttribute("data-pack-for", "2026-12-28");
      await fitsSideways(page);
      await settle(dayOff);
      await shot(page, testInfo, `holiday-${locale}-${width}`);
    });

    test(`${locale} ${width}: the evening before the break packs for the first day back`, async ({ page }, testInfo) => {
      const hits = await countReads(page);
      // Friday 9 October 2026, 18:00. Monday 12 is in the break, the break
      // runs to Friday 23, Monday 26 is a Brückentag on the holiday calendar:
      // Tuesday 27 is the next school day, as the widget's preview says.
      await open(page, locale, `eve-${locale}-${width}`, width, "2026-10-09T18:00:00+02:00");
      // Today is an ordinary school day: no day-off note, this week has none off.
      await expect(page.locator("[data-day-off]")).toHaveCount(0);
      await expect(page.locator("[data-week-day][data-week-day-off]:visible")).toHaveCount(0);
      const pack = page.locator("[data-pack-for]");
      await expect(pack).toHaveAttribute("data-pack-for", "2026-10-27");
      await expect(pack).toHaveText(PACK_27[locale]);
      const preview = page.locator("[data-next-school-day]");
      await expect(preview).toHaveAttribute("data-next-school-day", "2026-10-27");
      await expect(preview).toHaveText(NEXT_27[locale]);
      // Tuesday's lessons in the preview, not Monday's.
      const previewCard = cardOf(preview);
      await expect(previewCard).toContainText(FIRST[2]);
      await expect(previewCard).not.toContainText(FIRST[1]);
      expect(hits.schoolHolidays).toBeGreaterThan(0);
      expect(hits.holidayCalendars).toBeGreaterThan(0);
      await fitsSideways(page);
      await settle(pack);
      await shot(page, testInfo, `eve-${locale}-${width}`);
    });
  }
}
