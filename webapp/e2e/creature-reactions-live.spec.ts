import { test, expect, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";
import { REACTION_DEDUPE_MS } from "../src/lib/pocket-money/creature-reactions";

/**
 * A child's creature cheers on every screen when their task is ticked off
 * (RFC-016, live reactions), and the screen that ticked cheers once, not
 * again when its own realtime echo comes back. Two browsers, because one
 * cannot see either half.
 *
 * It works in a family of its own, `claude-creature-live`, with the
 * pocket-money and tasks widgets on its dashboard, a child in points mode and
 * two tasks; it is created here and removed with its devices afterwards,
 * whatever an interrupted run left behind. Needs a running stack: FAMILY_CODE
 * says there is one (e2e.yml sets it).
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");
test.describe.configure({ mode: "serial" });

const FAMILY = "c1a0de00-0016-4000-8000-00000000f001";
const CHILD = "c1a0de00-0016-4000-8000-00000000f0a1";
const ACCOUNT = "c1a0de00-0016-4000-8000-00000000f0c1";
const SMALL_TASK = "c1a0de00-0016-4000-8000-00000000f0d1";
const BIG_TASK = "c1a0de00-0016-4000-8000-00000000f0d2";
const JOIN_CODE = "CLAUDECRTR";
const DEVICES = ["claude-creature-a", "claude-creature-b"];

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  ).trim();
}

function purge() {
  psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
    DELETE FROM devices WHERE hardware_id IN (${DEVICES.map((d) => `'e2e-${d}'`).join(", ")});
    DELETE FROM todo_point_awards WHERE family_id = '${FAMILY}';
    DELETE FROM todos WHERE family_id = '${FAMILY}';
    DELETE FROM pocket_money_accounts WHERE family_id = '${FAMILY}';
    DELETE FROM people WHERE family_id = '${FAMILY}';
    DELETE FROM settings WHERE family_id = '${FAMILY}';
    DELETE FROM families WHERE id = '${FAMILY}';`);
}

test.beforeAll(() => {
  purge();
  const widgets = JSON.stringify({
    weather: false, upcomingEvents: false, weekOverview: false, schedule: false, mealPlan: false, timers: false,
    tasks: true, pocketMoney: true,
  });
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES ('${FAMILY}', 'claude-creature-live', '${JOIN_CODE}', true);
    INSERT INTO people (id, family_id, name, is_child, color) VALUES ('${CHILD}', '${FAMILY}', 'claude-creature-kid', true, '#56B6E8');
    INSERT INTO pocket_money_accounts (id, family_id, person_id, balance_cents, reward_mode, avatar_species, avatar_style, best_tier, last_seen_tier)
      VALUES ('${ACCOUNT}', '${FAMILY}', '${CHILD}', 0, 'points', 'dragon', 'gumdrop', 1, 1);
    INSERT INTO todos (id, family_id, title, person_id, recurrence, points)
      VALUES ('${SMALL_TASK}', '${FAMILY}', 'claude-creature feed the cat', '${CHILD}', 'once', 5),
             ('${BIG_TASK}', '${FAMILY}', 'claude-creature tidy the room', '${CHILD}', 'once', 60);
    INSERT INTO settings (family_id, key, value) VALUES ('${FAMILY}', 'widget_visibility', '${widgets}'::jsonb);`);
});

test.afterAll(() => {
  purge();
});

/**
 * Counts what the creatures on this page do, from the moment it loads: each
 * "+N" label that appears, each hop, each compact hatching. A reaction played
 * twice shows up here as two labels, however quickly the second follows.
 */
function recordReactions() {
  const w = window as unknown as { __labels: string[]; __hops: number; __hatches: number };
  w.__labels = [];
  w.__hops = 0;
  w.__hatches = 0;
  const hops = (cls: string | null) => (cls ?? "").split(/\s+/).includes("creature-hop");
  new MutationObserver((records) => {
    records.forEach((r, i) => {
      if (r.type !== "attributes") return;
      const el = r.target as Element;
      if (!el.closest("[data-testid=creature-reaction-host]")) return;
      // A hop starts where the class goes from absent to present. The class
      // after this record is the next record's old value for the same
      // element, or the element's class now.
      const later = records.slice(i + 1).find((x) => x.type === "attributes" && x.target === el);
      if (!hops(r.oldValue) && hops(later ? later.oldValue : el.getAttribute("class"))) w.__hops++;
    });
    for (const r of records) {
      if (r.type === "attributes") continue;
      for (const n of r.addedNodes) {
        if (!(n instanceof Element)) continue;
        for (const el of [n, ...n.querySelectorAll("*")]) {
          if (el.matches("[data-testid=creature-reaction]")) w.__labels.push(el.textContent ?? "");
          if (el.matches("[data-testid=creature-reaction-host] [data-phase]") && el.getAttribute("data-phase") !== "new") w.__hatches++;
        }
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ["class"] });
}

const counts = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __labels: string[]; __hops: number; __hatches: number };
    return { labels: [...w.__labels], hops: w.__hops, hatches: w.__hatches };
  });

async function screen(browser: Browser, device: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await establishSession(page, JOIN_CODE, device);
  await context.addInitScript(recordReactions);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const widget = page.locator("[data-testid=creature-reaction-host]").first();
  await expect(widget).toBeVisible({ timeout: 30_000 });
  // Realtime subscribed: the socket is up once the family channel joins.
  await page.waitForTimeout(3_000);
  return { context, page, widget };
}

test("a tick on one screen: both creatures cheer, each exactly once", async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await screen(browser, DEVICES[0]);
  const b = await screen(browser, DEVICES[1]);
  try {
    // Idle before anything happens: nothing playing, nothing breathing.
    await expect(a.widget.locator(".creature-animated")).toHaveCount(0);
    expect(await counts(a.page)).toEqual({ labels: [], hops: 0, hatches: 0 });

    // B ticks the task off on its tasks widget, as a person would.
    // The checkbox is drawn over its input: tap its label.
    await b.page.getByText(/claude-creature feed the cat/).first().click();

    // The other screen cheers, live, within a second or two.
    await expect(a.widget.getByTestId("creature-reaction")).toHaveText("+5 ⭐", { timeout: 5_000 });
    // Its creature moves for the reaction only.
    await expect(a.widget.locator(".creature-animated")).toHaveCount(1);
    // The ticking screen cheered too.
    await expect.poll(async () => (await counts(b.page)).labels, { timeout: 5_000 }).toEqual(["+5 ⭐"]);

    // Long enough for B's echo to arrive and for any second reaction to play.
    await a.page.waitForTimeout(5_000);
    for (const s of [a, b]) {
      const c = await counts(s.page);
      expect(c.labels, "one label, not two").toEqual(["+5 ⭐"]);
      expect(c.hops, "one hop").toBe(1);
      expect(c.hatches).toBe(0);
    }
    // And still again afterwards.
    await expect(a.widget.locator(".creature-animated")).toHaveCount(0);
    await expect(a.widget.getByTestId("creature-reaction")).toHaveCount(0);

    // Taken back on another phone: no cheer anywhere. Past the window in
    // which a repeat of the tick counts as its echo, or the dedupe would
    // hide an un-tick that cheered.
    await a.page.waitForTimeout(REACTION_DEDUPE_MS);
    psql(`UPDATE todos SET completed = false WHERE id = '${SMALL_TASK}'`);
    await a.page.waitForTimeout(4_000);
    expect((await counts(a.page)).labels).toEqual(["+5 ⭐"]);
    expect((await counts(b.page)).labels).toEqual(["+5 ⭐"]);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("a tick that reaches a new stage hatches in the widget", async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await screen(browser, DEVICES[0]);
  try {
    // 60 points from 0 (the first test's 5 were taken back): the egg hatches.
    psql(`UPDATE todos SET completed = true WHERE id = '${BIG_TASK}'`);
    await expect(a.widget.getByTestId("creature-reaction")).toHaveText("+60 ⭐", { timeout: 5_000 });
    await expect(a.widget.locator("[data-phase]")).toBeVisible();
    await expect.poll(async () => (await counts(a.page)).hatches, { timeout: 5_000 }).toBeGreaterThan(0);
    // Afterwards the widget shows the new stage, standing still.
    await expect(a.widget.locator("svg[data-tier='2']")).toBeVisible({ timeout: 10_000 });
    await expect(a.widget.locator("[data-phase]")).toHaveCount(0);
    await expect(a.widget.locator(".creature-animated")).toHaveCount(0);
  } finally {
    await a.context.close();
  }
});

test("the child's own page cheers too", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await establishSession(page, JOIN_CODE, DEVICES[0]);
    await context.addInitScript(recordReactions);
    await page.goto("/pocket-money", { waitUntil: "domcontentloaded" });
    const creature = page.locator("[data-testid=creature-reaction-host]").first();
    await expect(creature).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3_000);
    psql(`UPDATE todos SET completed = true WHERE id = '${SMALL_TASK}'`);
    await expect(creature.getByTestId("creature-reaction")).toHaveText("+5 ⭐", { timeout: 5_000 });
    await expect.poll(async () => (await counts(page)).hops, { timeout: 5_000 }).toBe(1);
  } finally {
    await context.close();
  }
});
