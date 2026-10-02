import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { format } from "date-fns";
import { enUS } from "date-fns/locale";
import en from "../messages/en.json";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * A tap on the top of a day in the month view did nothing. Each day's
 * selection button sits behind the day's content, and the row with the date
 * number -- with the holiday dot beside it -- caught the tap without a handler
 * of its own. On a phone that row is the top 40% of every day, empty or not,
 * so picking a day could take a few tries.
 *
 * Which element a tap lands on is decided by the rendered page, so this
 * clicks the middle of the number with the raw mouse, as a finger would.
 * Playwright's own click() on the number would refuse instead: now that the
 * row lets taps through, the number never receives them -- which is the point.
 */
const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

/** `{count, plural, one {...} other {...}}`, the only ICU shape this file's messages use. */
function pluralMessage(template: string, count: number): string {
  const match = template.match(/\{count, plural, one \{([^}]*)\} other \{([^}]*)\}\}/);
  if (!match) throw new Error(`not a one/other plural message: ${template}`);
  return (count === 1 ? match[1] : match[2]).replace(/#/g, String(count));
}

test.describe("month view", () => {
  // Skipped without a stack, like the other layout specs.
  test.skip(!FAMILY_CODE, "needs a running stack");

  test("tapping a date's number selects that day", async ({ page }, testInfo) => {
    await establishSession(page, FAMILY_CODE, `Day tap ${testInfo.project.name}`);
    await page.goto("/calendar");
    // Today starts out selected, so use a day that is not today. The 15th and
    // the 16th appear once in any month grid: the leading days are the end of
    // the previous month, and the trailing days never get past the 14th.
    const day = new Date().getDate() === 15 ? "16" : "15";
    // In each day, the selection button is followed by the row with the number.
    const number = page.locator("button[aria-label] + div > span").filter({ hasText: new RegExp(`^${day}$`) });
    await expect(number).toHaveCount(1);
    const dayButton = number.locator("xpath=../../button");
    await expect(dayButton).not.toHaveAttribute("aria-pressed", "true");

    await number.scrollIntoViewIfNeeded();
    const box = await number.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(dayButton).toHaveAttribute("aria-pressed", "true");
  });
});

/**
 * #323 left the event chips `pointer-events-auto` so they keep their own
 * click and keyboard handler instead of selecting the day underneath them,
 * but nothing in the suite ever clicked one -- so a chip that quietly lost
 * `pointer-events-auto` (or its onClick) would stay green here forever while
 * every chip in the real app stopped opening. Mutation-tested: deleting
 * `pointer-events-auto` from month-view.tsx's chip wrapper turns this red in
 * both Chromium and WebKit; it is restored before this file is left behind.
 */
test.describe("month view event chips", () => {
  test.skip(!FAMILY_CODE, "needs a running stack");

  const CALENDAR_NAME = "claude-month-tooltips-chip";
  const EVENT_TITLE = "claude-month-tooltips-chip-event";
  let familyId = "";
  let calendarId = "";

  test.beforeAll(() => {
    familyId = psql(`SELECT id FROM families WHERE join_code = '${FAMILY_CODE}'`);
    // In case a previous run was interrupted before its own cleanup ran.
    psql(`DELETE FROM calendars WHERE family_id = '${familyId}' AND name = '${CALENDAR_NAME}'`);
    calendarId = psql(
      `INSERT INTO calendars (family_id, name) VALUES ('${familyId}', '${CALENDAR_NAME}') RETURNING id`,
    );
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    psql(
      `INSERT INTO events (calendar_id, title, start_at, end_at) VALUES ('${calendarId}', '${EVENT_TITLE}', '${start.toISOString()}', '${end.toISOString()}')`,
    );
  });

  test.afterAll(() => {
    // Cascades to the event (events.calendar_id ON DELETE CASCADE).
    if (calendarId) psql(`DELETE FROM calendars WHERE id = '${calendarId}'`);
  });

  test("clicking an event chip opens it", async ({ page }, testInfo) => {
    await establishSession(page, FAMILY_CODE, `claude-month-tooltips-chip-${testInfo.project.name}`);
    await page.goto("/calendar", { waitUntil: "domcontentloaded" });

    // Generous timeout: the calendar's first paint is a skeleton until the
    // events query resolves, which this spec's own insert just raced.
    // `exact: true`: the day panel beside the grid lists the same event with
    // its time appended to the accessible name ("… 12:00 - 13:00"), which a
    // loose name match would also catch.
    const chip = page.getByRole("button", { name: EVENT_TITLE, exact: true });
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.click();
    await expect(page.getByRole("dialog").getByText(EVENT_TITLE)).toBeVisible();
  });
});

/**
 * The day-selection button covers the whole cell and everything drawn over
 * it -- the holiday dot and name, the tasks-due corner -- is
 * pointer-events-none, so a hover or a screen reader only gets what lives on
 * that button's own accessible name. #323's review promised this follow-up:
 * the holiday name and the tasks-due count both land in the same `title`/
 * `aria-label`, appended after the date rather than replacing it.
 *
 * Pinned to year 2026 and English (NEXT_LOCALE cookie) rather than "this
 * month" and the runner's locale, so the assertion stays exact without
 * depending on when or in what language the suite happens to run. October 3
 * is a federal holiday (German Unity Day) in every region Kinboard curates,
 * so it stays stable even if the family's own holiday_region setting
 * changes.
 */
test.describe("month view day button label", () => {
  test.skip(!FAMILY_CODE, "needs a running stack");

  const DAY = "2026-10-03";
  const TASK_TITLES = ["claude-month-tooltips-task-1", "claude-month-tooltips-task-2"];

  let familyId = "";
  let hadCalendarDisplay = false;
  let savedCalendarDisplay = "";

  test.beforeAll(() => {
    familyId = psql(`SELECT id FROM families WHERE join_code = '${FAMILY_CODE}'`);
    psql(`SET kinboard.hard_delete = 'on'; DELETE FROM todos WHERE family_id = '${familyId}' AND title = ANY (ARRAY[${TASK_TITLES.map((t) => `'${t}'`).join(",")}])`);

    savedCalendarDisplay = psql(
      `SELECT value::text FROM settings WHERE family_id = '${familyId}' AND key = 'calendar_display'`,
    );
    hadCalendarDisplay = savedCalendarDisplay.length > 0;
    psql(
      `INSERT INTO settings (family_id, key, value) VALUES ('${familyId}', 'calendar_display', '{"showHolidays":true,"showTasks":true,"tasksAsEvents":false}'::jsonb)
       ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value`,
    );

    const people = psql(`SELECT id FROM people WHERE family_id = '${familyId}' ORDER BY created_at LIMIT 2`)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const [i, title] of TASK_TITLES.entries()) {
      const personId = people[i];
      psql(
        `INSERT INTO todos (family_id, person_id, title, due_date) VALUES ('${familyId}', ${personId ? `'${personId}'` : "NULL"}, '${title}', '${DAY}')`,
      );
    }
  });

  test.afterAll(() => {
    if (!familyId) return;
    psql(`SET kinboard.hard_delete = 'on'; DELETE FROM todos WHERE family_id = '${familyId}' AND title = ANY (ARRAY[${TASK_TITLES.map((t) => `'${t}'`).join(",")}])`);
    if (hadCalendarDisplay) {
      psql(
        `UPDATE settings SET value = '${savedCalendarDisplay.replace(/'/g, "''")}'::jsonb WHERE family_id = '${familyId}' AND key = 'calendar_display'`,
      );
    } else {
      psql(`DELETE FROM settings WHERE family_id = '${familyId}' AND key = 'calendar_display'`);
    }
  });

  test("names the holiday and the tasks due, after the date, in English", async ({ page, baseURL }, testInfo) => {
    await establishSession(page, FAMILY_CODE, `claude-month-tooltips-label-${testInfo.project.name}`);
    await page.context().addCookies([
      { name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" },
    ]);
    await page.goto("/calendar?date=2026-10-01", { waitUntil: "domcontentloaded" });

    // Generous timeout: the calendar's first paint is a skeleton until the
    // holidays/tasks/events queries resolve.
    const number = page.locator("button[aria-label] + div > span").filter({ hasText: /^3$/ });
    await expect(number).toHaveCount(1, { timeout: 15_000 });
    const dayButton = number.locator("xpath=../../button");

    // Read the holiday's own name back from its dot rather than hardcode the
    // curated translation: the dot and the button build it with the same
    // holidayLabel() call, so this still proves they agree.
    const holidayDot = dayButton.locator(
      "xpath=following-sibling::div[1]//span[@role='img' and contains(@class,'bg-amber-400')]",
    );
    await expect(holidayDot, "no holiday dot rendered for October 3, 2026").toHaveCount(1, { timeout: 15_000 });
    const holidayName = await holidayDot.getAttribute("title");

    const expectedDate = format(new Date(2026, 9, 3), "PPPP", { locale: enUS });
    const prefix = `${expectedDate} · ${holidayName} · `;

    // The family may have its own tasks due that day (a daily chore, say), so
    // the count is at least our two rather than exactly two. Read it back and
    // check the text is the right plural for that number.
    await expect(dayButton).toHaveAttribute("aria-label", new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), { timeout: 15_000 });
    const label = (await dayButton.getAttribute("aria-label")) ?? "";
    const due = Number(/(\d+)/.exec(label.slice(prefix.length))?.[1] ?? "0");
    expect(due, label).toBeGreaterThanOrEqual(TASK_TITLES.length);
    const expectedLabel = prefix + pluralMessage(en.calendar.markers.tasksDueCount, due);
    expect(label).toBe(expectedLabel);
    await expect(dayButton).toHaveAttribute("title", expectedLabel);
  });
});

test.afterAll(() => {
  if (!FAMILY_CODE) return;
  try {
    psql("DELETE FROM devices WHERE hardware_id LIKE 'e2e-claude-month-tooltips-%'");
  } catch {
    // Best effort: a device row left behind costs nothing but a little
    // clutter, and must never be what fails this file.
  }
});
