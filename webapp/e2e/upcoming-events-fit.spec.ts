import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { establishSession } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";

/**
 * The Events widget on Home shows three events, each under its day. On a
 * phone its list was capped at 160px and scrolled inside the widget, so the
 * third event of three different days was cut off, and anything past three
 * is on the "more" link anyway. Every event the widget lists has to be shown
 * whole, with nothing to scroll inside it.
 *
 * In a family of its own, removed afterwards. Needs a running stack.
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE and a running stack");

const P = "claude-events-fit-";
let famId = "";
let code = "";

function purge(where: string) {
  for (const id of psql(`SELECT string_agg(id::text, ',') FROM families WHERE ${where}`).split(",").filter(Boolean)) {
    psql(`DELETE FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE family_id = ${sqlText(id)})`);
    psql(`DELETE FROM calendars WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM devices WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM settings WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM families WHERE id = ${sqlText(id)}`);
  }
}

test.beforeAll(() => {
  // Leftovers of a run that died, never a family another worker is using right now.
  purge(`name LIKE '${P}%' AND created_at < now() - interval '10 minutes'`);
  code = `EF${randomBytes(4).toString("hex").toUpperCase()}`;
  famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);
  const cal = psqlRow(`INSERT INTO calendars (family_id, name) VALUES ('${famId}', '${P}calendar') RETURNING id`);
  // Four events on four days from tomorrow: three listed, each under its own day, one on "more".
  for (let day = 1; day <= 4; day++) {
    psql(
      `INSERT INTO events (calendar_id, title, start_at, end_at) VALUES ('${cal}', 'Probe event ${day}', ` +
        `date_trunc('day', now()) + interval '${day} day 10 hours', date_trunc('day', now()) + interval '${day} day 11 hours')`,
    );
  }
});

test.afterAll(() => {
  purge(`id = ${sqlText(famId)}`);
  expect(psql(`SELECT count(*) FROM families WHERE id = ${sqlText(famId)}`)).toBe("0");
});

test("the Events widget shows its three events whole, without scrolling inside it", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await establishSession(page, code, `${P}device-${testInfo.project.name}`);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const third = page.getByText("Probe event 3", { exact: true });
  await expect(third).toBeAttached({ timeout: 30_000 });
  await expect(page.getByText("Probe event 4", { exact: true })).toHaveCount(0);
  // Bring the widget into view by scrolling the page only, never the list in it.
  await page.getByRole("heading", { name: "Events", exact: true }).scrollIntoViewIfNeeded();

  // Whole: each event inside every box that could clip it, and no box between it and the page scrolls.
  // Checked once the events have finished sliding in: mid-animation the list is a few pixels taller
  // than its box for a moment, while a cap on its height never settles.
  const check = () => page.evaluate(() => {
    const problems: string[] = [];
    for (const n of [1, 2, 3]) {
      const el = Array.from(document.querySelectorAll("body *")).find(
        (e) => e.childElementCount === 0 && e.textContent === `Probe event ${n}`,
      ) as HTMLElement | undefined;
      if (!el) {
        problems.push(`Probe event ${n} missing`);
        continue;
      }
      const r = el.getBoundingClientRect();
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (!/(auto|scroll|hidden|clip)/.test(cs.overflowY)) continue;
        const box = p.getBoundingClientRect();
        if (r.bottom > box.bottom + 0.5 || r.top < box.top - 0.5) problems.push(`event ${n} clipped by ${p.className.toString().slice(0, 60)}`);
        if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1)
          problems.push(`event ${n} sits in a box that scrolls: ${p.className.toString().slice(0, 60)}`);
      }
    }
    return [...new Set(problems)];
  });
  await expect.poll(check, { timeout: 5_000 }).toEqual([]);
  await third.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("events-widget.png") });
});
