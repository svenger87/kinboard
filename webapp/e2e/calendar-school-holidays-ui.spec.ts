import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "child_process";
import { randomBytes } from "crypto";
import { join } from "path";
import { format } from "date-fns";
import { de, fr } from "date-fns/locale";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * School holidays on the calendar page, rendered. The calendar drew the
 * region's public holidays and nothing else: a family with its school
 * holidays typed in or synced saw them in the widgets (#329) and not on
 * /calendar -- "don't the school holidays appear in the calendar?"
 *
 * A throwaway family in Lower Saxony, the browser clock fixed at noon on
 * Thursday 15 October 2026, these breaks:
 *
 *   Brückenferien             Fri 2 -- Sat 3 Oct   (3 Oct is a public holiday)
 *   Studientag                Wed 14 Oct           (one day)
 *   Vacances de la Toussaint  Mon 19 -- Wed 21 Oct (a long name)
 *   Herbstferien              Mon 26 Oct -- Fri 6 Nov (across the month's end)
 *   Versteckte Ferien         Thu 8 Oct, synced and hidden: never shown
 *
 * and five people with a task due on 19 October, so the task dots share a
 * cell with a break's band and name. Run with --project=webkit as well as
 * Chromium. Needs FAMILY_CODE (a running stack).
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");

// The PWA service worker answers fetches before page.route sees them.
test.use({ serviceWorkers: "block", timezoneId: "Europe/Berlin" });
// One family, one set of rows: the tests change its settings in turn.
test.describe.configure({ mode: "serial" });

let P = "";
const DEVICE = () => `claude-calschool-${P.split("-").at(-2)}-`;
const NOW = new Date("2026-10-15T12:00:00+02:00");
const SHOTS = process.env.CALENDAR_SCHOOL_SHOTS ?? "";

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

const DISPLAY_ON = { showHolidays: true, showTasks: true, tasksAsEvents: false };
const TOUSSAINT = "Vacances de la Toussaint";

function purge() {
  const stale = psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`);
  for (const id of stale.split(",").filter(Boolean)) {
    psql(`DELETE FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE family_id = '${id}')`);
    psql(`DELETE FROM calendars WHERE family_id = '${id}'`);
    // todos and people soft-delete, a family delete's cascade included: it
    // leaves them behind with deleted_at set. Hard-delete them first.
    psql(
      `BEGIN; SET LOCAL kinboard.hard_delete = 'on';
       DELETE FROM todos WHERE family_id = '${id}'; DELETE FROM people WHERE family_id = '${id}'; COMMIT;`,
      "supabase_admin",
    );
    psql(`DELETE FROM families WHERE id = '${id}'`, "supabase_admin");
  }
  psql(`DELETE FROM devices WHERE hardware_id LIKE 'e2e-${DEVICE()}%'`);
}

test.beforeAll(({}, testInfo) => {
  P = `e2e-claude-calschool-${testInfo.project.name}-`;
  purge();
  joinCode = `CS${randomBytes(4).toString("hex").toUpperCase()}`;
  familyId = psql(
    `INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${joinCode}', true) RETURNING id`,
  );
  put("holiday_region", { code: "DE-NI", chosen: true });
  // No sync: the rows below are the whole story, and a cron run must not replace them.
  put("school_holiday_sync", { enabled: false, region: null, group: null, pending: null, last_success_at: null, last_error_at: null, last_error: null });
  put("calendar_display", DISPLAY_ON);
  put("screensaver", { screensaverTimeout: 0 });
  psql(
    `INSERT INTO school_holidays (family_id, name, starts_on, ends_on) VALUES
       ('${familyId}', 'Brückenferien', '2026-10-02', '2026-10-03'),
       ('${familyId}', 'Studientag', '2026-10-14', '2026-10-14'),
       ('${familyId}', ${quote(TOUSSAINT)}, '2026-10-19', '2026-10-21'),
       ('${familyId}', 'Herbstferien', '2026-10-26', '2026-11-06')`,
  );
  // A synced row the family hid: written as the service role would.
  psql(
    `INSERT INTO school_holidays (family_id, name, starts_on, ends_on, source, external_id, hidden, synced_at) VALUES
       ('${familyId}', 'Versteckte Ferien', '2026-10-08', '2026-10-08', 'openholidays', '${P}hidden', true, now())`,
    "supabase_admin",
  );
  const colors = ["#ef4444", "#3b82f6", "#22c55e", "#a855f7", "#f97316"];
  for (const [i, color] of colors.entries()) {
    const personId = psql(
      `INSERT INTO people (family_id, name, color) VALUES ('${familyId}', 'Kind ${i + 1}', '${color}') RETURNING id`,
    );
    psql(
      `INSERT INTO todos (family_id, person_id, title, due_date) VALUES ('${familyId}', '${personId}', 'Aufgabe ${i + 1}', '2026-10-19')`,
    );
  }
});

test.afterAll(() => {
  if (!familyId) return;
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM school_holidays WHERE family_id = '${familyId}'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM todos WHERE family_id = '${familyId}'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM people WHERE family_id = '${familyId}'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM devices WHERE hardware_id LIKE 'e2e-${DEVICE()}%'`)).toBe("0");
});

type Locale = "de" | "fr";
const DATE_LOCALES = { de, fr };

/**
 * One device for the whole spec, joined once per worker and its cookies
 * replayed (establishSession caches them by name). Joining is limited to ten
 * a minute per IP and the CI WebKit step joins every spec from one: with a
 * device per test this spec alone took 14, and the specs after it sat out
 * the limit on /join.
 */
const SPEC_DEVICE = () => `${DEVICE()}screen`;

async function open(page: Page, locale: Locale, _device: string, width: number, date = "2026-10-15") {
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  const base = test.info().project.use.baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  await establishSession(page, joinCode, SPEC_DEVICE());
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
  // The clock goes on after the join, never before. establishSession can sit
  // on /join for up to a minute waiting out the join rate limit, and a fake
  // clock installed before that wait starts the next page's performance.now()
  // that far ahead of WebKit's animation timeline: framer-motion then schedules
  // the route fade-in a minute into the future, and the page stays at opacity 0.
  await page.clock.setFixedTime(NOW);
  put("locale", locale);
  await page.goto(`/calendar?date=${date}`, { waitUntil: "domcontentloaded" });
}

/** The month grid's day-selection button for a day: its label starts with the full date. */
function dayButton(page: Page, locale: Locale, day: string): Locator {
  const label = format(new Date(`${day}T12:00:00`), "PPPP", { locale: DATE_LOCALES[locale] });
  return page.locator(`button[aria-label^=${JSON.stringify(label)}]`);
}
/** The day's cell: the button's parent. */
const cellOf = (button: Locator) => button.locator("xpath=..");

async function shot(locator: Locator, testInfo: TestInfo, name: string) {
  const file = `calendar-school-${name}-${testInfo.project.name}.png`;
  await locator.screenshot({ path: SHOTS ? join(SHOTS, file) : testInfo.outputPath(file), animations: "disabled" });
}

/** Every element under `root` that sticks out of its month cell, sideways or below. */
async function overflowing(root: Locator): Promise<string[]> {
  return root.evaluate((grid) => {
    const out: string[] = [];
    for (const button of grid.querySelectorAll<HTMLButtonElement>("button[aria-label]")) {
      const cell = button.parentElement!;
      const c = cell.getBoundingClientRect();
      if (cell.scrollWidth > cell.clientWidth + 1) out.push(`${button.getAttribute("aria-label")}: cell scrolls sideways`);
      for (const el of cell.querySelectorAll<HTMLElement>("[data-school-break-band], [data-school-break-name], [role=img]")) {
        if (getComputedStyle(el).display === "none" || getComputedStyle(el.parentElement!).display === "none") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5) {
          out.push(`${button.getAttribute("aria-label")}: ${el.outerHTML.slice(0, 80)} outside its cell`);
        }
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push("the page scrolls sideways");
    return out;
  });
}

/** The month-or-week switch's "Week". */
const weekToggle = (page: Page, locale: Locale) => {
  const name = locale === "de" ? "Woche" : "Semaine";
  return page.getByRole("radio", { name, exact: true }).or(page.getByRole("button", { name, exact: true })).first();
};

/** Switch to the week view -- again until it takes: a click before hydration does nothing. */
async function toWeekView(page: Page, locale: Locale) {
  const toggle = weekToggle(page, locale);
  await expect(async () => {
    await toggle.click();
    await expect(toggle).toHaveAttribute("data-state", "on", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

const monthGrid = (page: Page) => page.locator("div.border-t").filter({ has: page.locator("button[aria-label]") }).first();

for (const locale of ["de", "fr"] as const) {
  for (const width of [320, 390, 768, 1280]) {
    test(`${locale} ${width}: the month grid bands each break, names it from sm up, and keeps the dots in their cells`, async ({ page }, testInfo) => {
      let schoolReads = 0;
      await page.route(/\/rest\/v1\/school_holidays\b/, (route) => {
        schoolReads++;
        return route.continue();
      });
      await open(page, locale, `${locale}-${width}`, width);
      const grid = monthGrid(page);
      await expect(grid.locator("[data-school-break-band]").first()).toBeAttached({ timeout: 30_000 });
      expect(schoolReads, "the rows came from the school_holidays read").toBeGreaterThan(0);

      // Bands: 2 + 1 + 3 + 7 (Herbstferien as far as the grid goes, Sunday 1 Nov).
      await expect(grid.locator("[data-school-break-band]")).toHaveCount(13);
      await expect(cellOf(dayButton(page, locale, "2026-10-08")).locator("[data-school-break-band]")).toHaveCount(0);
      await expect(cellOf(dayButton(page, locale, "2026-11-01")).locator("[data-school-break-band]")).toHaveCount(1);
      await expect(page.getByText("Versteckte Ferien")).toHaveCount(0);

      // Names: where a break begins, on a line of their own; not again on 3 Oct.
      const names = grid.locator("[data-school-break-name]");
      await expect(names).toHaveCount(4);
      const wide = width >= 640;
      for (const [day, name] of [
        ["2026-10-02", "Brückenferien"],
        ["2026-10-14", "Studientag"],
        ["2026-10-19", TOUSSAINT],
        ["2026-10-26", "Herbstferien"],
      ] as const) {
        const label = cellOf(dayButton(page, locale, day)).locator("[data-school-break-name]");
        await expect(label).toHaveAttribute("data-school-break-name", name);
        if (wide) await expect(label).toBeVisible();
        else await expect(label).toBeHidden();
      }
      await expect(cellOf(dayButton(page, locale, "2026-10-03")).locator("[data-school-break-name]")).toHaveCount(0);

      // The day button's label and title name the break, next to the public holiday.
      const oct3 = dayButton(page, locale, "2026-10-03");
      const oct3Label = (await oct3.getAttribute("aria-label"))!;
      expect(oct3Label).toContain(locale === "de" ? "Tag der Deutschen Einheit" : "Jour de l'unité allemande");
      expect(oct3Label).toContain("Brückenferien");
      expect(oct3Label.split("Brückenferien")).toHaveLength(2);
      await expect(oct3).toHaveAttribute("title", oct3Label);
      await expect(dayButton(page, locale, "2026-10-27")).toHaveAttribute("aria-label", /Herbstferien/);
      await expect(dayButton(page, locale, "2026-10-08")).not.toHaveAttribute("aria-label", /Versteckte/);
      await expect(dayButton(page, locale, "2026-10-13")).not.toHaveAttribute("aria-label", /Studientag/);

      // 19 Oct: the long name, the band and five people's task dots in one cell.
      const oct19 = cellOf(dayButton(page, locale, "2026-10-19"));
      await expect(oct19.locator("[role=img]").locator("visible=true").first()).toBeVisible();
      if (wide) {
        const lines = await oct19.locator("[data-school-break-name] > span").evaluate((el) =>
          Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
        );
        expect(lines, "the long name keeps to two lines").toBeLessThanOrEqual(2);
      }
      await page.waitForTimeout(800);
      expect(await overflowing(grid)).toEqual([]);
      await shot(grid, testInfo, `month-${locale}-${width}`);

      // November: the same break from the other side of the month's end,
      // named where it begins and again where it carries into a new week row.
      await page.goto("/calendar?date=2026-11-10", { waitUntil: "domcontentloaded" });
      await expect(dayButton(page, locale, "2026-11-04")).toHaveAttribute("title", /Herbstferien/, { timeout: 30_000 });
      await expect(grid.locator("[data-school-break-band]")).toHaveCount(12);
      await expect(cellOf(dayButton(page, locale, "2026-11-07")).locator("[data-school-break-band]")).toHaveCount(0);
      await expect(grid.locator('[data-school-break-name="Herbstferien"]')).toHaveCount(2);
      await expect(cellOf(dayButton(page, locale, "2026-11-02")).locator("[data-school-break-name]")).toHaveCount(1);
      await page.waitForTimeout(800);
      expect(await overflowing(grid)).toEqual([]);
      await shot(grid, testInfo, `month-nov-${locale}-${width}`);
    });
  }

  test(`${locale}: the week view runs the break across its days as an all-day strip`, async ({ page }, testInfo) => {
    await open(page, locale, `week-${locale}`, 1280, "2026-10-28");
    await toWeekView(page, locale);
    const strips = page.locator("[data-school-break]");
    // Herbstferien covers all seven days of 26 Oct -- 1 Nov, named once.
    await expect(strips).toHaveCount(7, { timeout: 30_000 });
    await expect(strips.first()).toContainText("Herbstferien");
    await expect(strips.first()).toHaveAttribute("title", /^Herbstferien · /);
    for (let i = 1; i < 7; i++) await expect(strips.nth(i)).not.toContainText("Herbstferien");
    const card = strips.first().locator("xpath=ancestor::*[contains(@class,'overflow-hidden')][1]");
    await shot(card, testInfo, `week-${locale}-1280`);

    // The next week: it carries on, named again on Monday, ends Friday.
    await page.getByRole("button", { name: locale === "de" ? "Weiter" : "Suivant", exact: true }).click();
    await expect(strips).toHaveCount(5);
    await expect(strips.first()).toContainText("Herbstferien");

    // The week of 12 Oct: the one-day break, one strip.
    await page.goto("/calendar?date=2026-10-14", { waitUntil: "domcontentloaded" });
    await toWeekView(page, locale);
    await expect(strips).toHaveCount(1, { timeout: 30_000 });
    await expect(strips.first()).toContainText("Studientag");

    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(strips).toHaveCount(1);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      expect(fits, `the week view scrolls sideways at ${width}`).toBe(true);
      const box = (await strips.first().boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
      await shot(strips.first().locator("xpath=ancestor::*[contains(@class,'overflow-hidden')][1]"), testInfo, `week-${locale}-${width}`);
    }
  });

  test(`${locale}: the day panel lists the break with its days next to the public holiday`, async ({ page }, testInfo) => {
    await open(page, locale, `panel-${locale}`, 1280);
    await expect(page.locator("[data-school-break-band]").first()).toBeAttached({ timeout: 30_000 });

    await dayButton(page, locale, "2026-10-27").click();
    const badge = page.locator("[data-school-break]");
    await expect(badge).toHaveCount(1);
    await expect(badge).toContainText(
      // Intl's range separator is spaced with thin or plain spaces, by engine.
      locale === "de" ? /Herbstferien · 26\. Okt\.\s*–\s*6\. Nov\.$/ : /Herbstferien · 26\s*oct\.\s*–\s*6\s*nov\.$/,
    );

    await dayButton(page, locale, "2026-10-03").click();
    await expect(badge).toHaveCount(1);
    await expect(badge).toContainText(locale === "de" ? /Brückenferien · 2\.\s*–\s*3\. Okt\.$/ : /Brückenferien · 2\s*–\s*3\s*oct\.$/);
    const panel = badge.locator("xpath=ancestor::*[contains(@class,'h-full')][1]");
    await expect(panel).toContainText(locale === "de" ? "Tag der Deutschen Einheit" : "Jour de l'unité allemande");
    await shot(panel, testInfo, `panel-${locale}-1280`);

    await dayButton(page, locale, "2026-10-08").click();
    await expect(badge).toHaveCount(0);
  });
}

test("a hidden row is never drawn, whatever the fetch returns", async ({ page }) => {
  // The rows stubbed: a visible break and a hidden one, both on 21 -- 22 Oct.
  let hits = 0;
  await page.route(/\/rest\/v1\/school_holidays\b/, (route) => {
    hits++;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "00000000-0000-4000-8000-000000000001", family_id: familyId, name: "Gezeigt", starts_on: "2026-10-21", ends_on: "2026-10-22", hidden: false, source: "manual" },
        { id: "00000000-0000-4000-8000-000000000002", family_id: familyId, name: "Verborgen", starts_on: "2026-10-21", ends_on: "2026-10-22", hidden: true, source: "openholidays" },
      ]),
    });
  });
  await open(page, "de", "stub", 1280);
  await expect(page.locator("[data-school-break-band]")).toHaveCount(2, { timeout: 30_000 });
  expect(hits).toBeGreaterThan(0);
  await expect(page.locator("[data-school-break-name]")).toHaveCount(1);
  await expect(page.locator("[data-school-break-name]")).toHaveAttribute("data-school-break-name", "Gezeigt");
  await expect(dayButton(page, "de", "2026-10-21")).not.toHaveAttribute("aria-label", /Verborgen/);
  await expect(page.getByText("Verborgen")).toHaveCount(0);
});

test("a holiday calendar that has the break already is not doubled", async ({ page }) => {
  const calendarId = psql(
    `INSERT INTO calendars (family_id, name, color, is_holidays) VALUES ('${familyId}', '${P}Ferien', '#22c55e', true) RETURNING id`,
  );
  psql(
    `INSERT INTO events (calendar_id, title, start_at, end_at, all_day) VALUES
       ('${calendarId}', 'Herbstferien', '2026-10-26T00:00:00+01:00', '2026-11-07T00:00:00+01:00', true)`,
  );
  try {
    await open(page, "de", "dedupe", 1280);
    // The calendar's own event stays, as a chip; the built-in band goes.
    await expect(page.locator("[data-school-break-band]").first()).toBeAttached({ timeout: 30_000 });
    await expect(cellOf(dayButton(page, "de", "2026-10-26")).getByText("Herbstferien").first()).toBeVisible();
    await expect(page.locator('[data-school-break-band*="Herbstferien"]')).toHaveCount(0);
    await expect(page.locator('[data-school-break-name="Herbstferien"]')).toHaveCount(0);
    // The others are untouched.
    await expect(page.locator("[data-school-break-band]")).toHaveCount(6);
    const label = (await dayButton(page, "de", "2026-10-26").getAttribute("aria-label"))!;
    expect(label.split("Herbstferien")).toHaveLength(2);
  } finally {
    psql(`DELETE FROM events WHERE calendar_id = '${calendarId}'`);
    psql(`DELETE FROM calendars WHERE id = '${calendarId}'`);
  }
});

test("a break added while the calendar is open appears without a reload", async ({ page }) => {
  await open(page, "de", "live", 1280);
  await expect(page.locator("[data-school-break-band]")).toHaveCount(13, { timeout: 30_000 });
  // Give the realtime channel time to join before the change.
  await page.waitForTimeout(3_000);
  // What a sync does: rows, then the school_holiday_sync setting in the same go.
  psql(
    `BEGIN;
     INSERT INTO school_holidays (family_id, name, starts_on, ends_on) VALUES ('${familyId}', 'Neue Ferien', '2026-10-09', '2026-10-09');
     UPDATE settings SET value = value || '{"last_success_at":"2026-10-15T10:00:00Z"}'::jsonb WHERE family_id = '${familyId}' AND key = 'school_holiday_sync';
     COMMIT;`,
  );
  try {
    await expect(page.locator('[data-school-break-name="Neue Ferien"]')).toHaveCount(1, { timeout: 20_000 });
  } finally {
    psql(`DELETE FROM school_holidays WHERE family_id = '${familyId}' AND name = 'Neue Ferien'`);
  }
});

test("with Holidays switched off, no break is drawn and school holidays are not fetched", async ({ page }) => {
  put("calendar_display", { ...DISPLAY_ON, showHolidays: false });
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
    await open(page, "de", "off", 1280);
    await expect(dayButton(page, "de", "2026-10-27")).toBeVisible({ timeout: 30_000 });
    // The switch was read, so its answer is what is on screen.
    await expect.poll(() => settingsReads, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1_500);
    await expect(page.locator("[data-school-break-band], [data-school-break-name], [data-school-break]")).toHaveCount(0);
    await expect(dayButton(page, "de", "2026-10-27")).not.toHaveAttribute("aria-label", /Herbstferien/);
    await dayButton(page, "de", "2026-10-27").click();
    await expect(page.locator("[data-school-break]")).toHaveCount(0);
    expect(schoolReads).toBe(0);
  } finally {
    put("calendar_display", DISPLAY_ON);
  }
});
