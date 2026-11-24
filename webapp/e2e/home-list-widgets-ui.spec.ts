import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOME_WIDGETS } from "../src/lib/layouts/widgets";

/**
 * Home's list widgets in boxes (RFC-022 step 4), on the dev page
 * /dev/home-lists: each at its minimum box and in a large one, at text
 * sizes S and XL, in the light and the dark theme. Every entry shown is
 * whole and inside its box, "+n" is the rest of the list and links to the
 * widget's page, and every touch target is at least 48px. In a box that
 * fits two tasks, a task is still ticked off in one tap.
 *
 * Needs a running dev server (PLAYWRIGHT_BASE_URL) and the join code of a
 * throwaway family with data (HOME_LISTS_CODE) and its screensaver off: the
 * tick-off test changes it. HOME_LISTS_SHOTS=<dir> saves a screenshot of every combination.
 */
const CODE = process.env.HOME_LISTS_CODE;
const SHOTS = process.env.HOME_LISTS_SHOTS;
test.skip(!process.env.PLAYWRIGHT_BASE_URL || !CODE, "needs PLAYWRIGHT_BASE_URL and HOME_LISTS_CODE");
test.use({ serviceWorkers: "block", viewport: { width: 1080, height: 1920 } });
test.describe.configure({ timeout: 420_000 });

const WIDGETS = ["tasks", "shopping", "mealPlan", "notes", "messages", "birthday", "holidays", "wasteCollection", "countdown"];
/** Where "+n" and the title lead; messages and countdowns have no page. */
const PAGES: Record<string, string | null> = {
  tasks: "/todos",
  shopping: "/shopping",
  mealPlan: "/meals",
  notes: "/notes",
  messages: null,
  birthday: "/birthdays",
  holidays: "/calendar",
  wasteCollection: "/calendar",
  countdown: null,
};

async function signIn(page: Page, theme: "light" | "dark", browserName: string) {
  const base = process.env.PLAYWRIGHT_BASE_URL!;
  const hw = `claude-rfc022-s4l-${browserName}`;
  const joined = await (await page.request.post(`${base}/api/session/join`, { data: { joinCode: CODE, deviceName: hw, hardwareId: hw } })).json();
  expect(joined.device, JSON.stringify(joined)).toBeTruthy();
  await page.context().addCookies([
    {
      name: "family-calendar-storage",
      value: encodeURIComponent(JSON.stringify({ state: { family: joined.family, device: joined.device }, version: 0 })),
      url: base,
    },
    { name: "NEXT_LOCALE", value: "en", url: base },
  ]);
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("theme", t);
    } catch {}
  }, theme);
}

async function open(page: Page, query: string) {
  await page.goto(`/dev/home-lists?${query}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("home-lists")).toBeVisible({ timeout: 90_000 });
  // Every widget has measured: a list root with a count, or its empty line.
  // The family has entries in every list: wait until each list has them, not its empty line.
  for (const w of query.includes("widgets=") ? new URLSearchParams(query).get("widgets")!.split(",") : WIDGETS) {
    const root = page.getByTestId(`home-widget-${w}`).locator("[data-list-shown]").first();
    await expect
      .poll(async () => Number(await root.getAttribute("data-list-shown").catch(() => 0)) + Number(await root.getAttribute("data-list-more").catch(() => 0)), { timeout: 60_000, message: `${w} never loaded` })
      .toBeGreaterThan(0);
  }
  await page.waitForTimeout(800);
}

/** Every visible entry, "+n" and target of one widget, checked against its box. */
async function checkWidget(page: Page, widget: string) {
  const section = page.getByTestId(`home-widget-${widget}`);
  const box = (await section.boundingBox())!;
  const root = section.locator("[data-list-shown]").first();
  const shown = Number(await root.getAttribute("data-list-shown"));
  const more = Number(await root.getAttribute("data-list-more"));
  const visible = root.locator("[data-list-visible]");
  const rows = visible.locator(":scope > div:not([data-testid=list-more])");
  if (await visible.count()) await expect(rows).toHaveCount(shown);

  // Whole entries only: nothing drawn past the box's bottom edge.
  for (const row of await rows.all()) {
    const r = (await row.boundingBox())!;
    expect(r.y + r.height, `${widget}: an entry runs past its box`).toBeLessThanOrEqual(box.y + box.height + 0.5);
  }
  // "+n" is the rest, and leads to the widget's page (when shown at all).
  const moreLine = visible.getByTestId("list-more");
  if (more > 0 && shown > 0) {
    await expect(moreLine).toBeVisible();
    await expect(moreLine).toContainText(`+${more}`);
    const m = (await moreLine.boundingBox())!;
    expect(m.y + m.height, `${widget}: "+n" runs past its box`).toBeLessThanOrEqual(box.y + box.height + 0.5);
    const href = await moreLine.locator("a").getAttribute("href").catch(() => null);
    expect(href, `${widget}: "+n" link`).toBe(PAGES[widget]);
  } else {
    await expect(moreLine).toBeHidden();
  }
  const title = section.locator("[data-home-list-title]");
  expect(await title.getAttribute("href"), `${widget}: title link`).toBe(PAGES[widget]);

  // Touch targets: 48px at least, whatever the text size.
  const targets = section.locator("a:visible, button:visible, [data-list-visible] label:visible");
  const sizes: { what: string; w: number; h: number }[] = [];
  for (const t of await targets.all()) {
    const b = await t.boundingBox();
    if (!b) continue;
    // A checkbox's own label sits inside the row's label, which is the target.
    if (await t.evaluate((el) => el.tagName === "LABEL" && !!el.querySelector("input"))) continue;
    // The row's text label fills the row's height; its width is the row's.
    const tag = await t.evaluate((el) => el.tagName);
    sizes.push({ what: `${tag} ${(await t.innerText()).slice(0, 30)}`, w: b.width, h: b.height });
  }
  for (const s of sizes) {
    expect(s.h, `${widget}: ${s.what} is ${s.h}px tall`).toBeGreaterThanOrEqual(47.5);
    expect(s.w, `${widget}: ${s.what} is ${s.w}px wide`).toBeGreaterThanOrEqual(47.5);
  }
  return { shown, more, targets: sizes.length, minTarget: Math.min(...sizes.map((s) => Math.min(s.w, s.h))) };
}

for (const theme of ["light", "dark"] as const) {
  for (const text of ["S", "XL"] as const) {
    for (const size of ["min", "large"] as const) {
      test(`${size} boxes, text ${text}, ${theme}: whole entries, "+n" to the page, 48px targets`, async ({ page, browserName }) => {
        await signIn(page, theme, browserName);
        // The large boxes take two columns; split them over two pages so each fits the 1080x1920 grid.
        const groups = size === "min" ? [WIDGETS] : [WIDGETS.slice(0, 4), WIDGETS.slice(4)];
        for (const [i, group] of groups.entries()) {
          await open(page, `widgets=${group.join(",")}&size=${size}&text=${text}`);
          const report: Record<string, unknown> = {};
          for (const w of group) report[w] = await checkWidget(page, w);
          console.log(`${browserName} ${theme} ${text} ${size}#${i}`, JSON.stringify(report));
          if (SHOTS) await page.getByTestId("home-lists").screenshot({ path: join(SHOTS, `${browserName}-${theme}-${text}-${size}${groups.length > 1 ? `-${i + 1}` : ""}.png`) });
        }
      });
    }
  }
}

test("a box that fits two tasks: one tap ticks one off, with the card's mutation", async ({ page, browserName }) => {
  await signIn(page, "light", browserName);
  // The smallest height (in steps) at which the tasks box shows exactly two.
  let h = 0;
  for (let steps = 8; steps <= 20; steps++) {
    await open(page, `widgets=tasks,shopping&w=24&h=${steps}&text=M`);
    const shown = Number(await page.getByTestId("home-widget-tasks").locator("[data-list-shown]").first().getAttribute("data-list-shown"));
    if (shown === 2) {
      h = steps;
      break;
    }
  }
  expect(h, "no height shows exactly two tasks").toBeGreaterThan(0);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${browserName}-two-rows-before.png`), clip: { x: 0, y: 0, width: 1080, height: 400 } });

  for (const widget of ["tasks", "shopping"]) {
    const section = page.getByTestId(`home-widget-${widget}`);
    const root = section.locator("[data-list-shown]").first();
    const total = Number(await root.getAttribute("data-list-shown")) + Number(await root.getAttribute("data-list-more"));
    const first = root.locator("[data-list-visible] > div").first();
    const label = (await first.innerText()).split("\n").map((l) => l.trim()).filter((l) => l && !/^(today|upcoming)$/i.test(l))[0];
    const table = widget === "tasks" ? "todos" : "shopping_items";
    const write = page.waitForResponse((r) => r.url().includes(`/rest/v1/${table}`) && r.request().method() === "PATCH");
    const b = (await first.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(47.5);
    // One tap on the row's text, not the little box: the whole row is the target.
    await first.locator("label").last().click();
    expect((await write).ok(), `${widget}: the tick was not saved`).toBe(true);
    await expect(section.getByText(label, { exact: true })).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(async () => Number(await root.getAttribute("data-list-shown")) + Number(await root.getAttribute("data-list-more"))).toBe(total - 1);
  }
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${browserName}-two-rows-after.png`), clip: { x: 0, y: 0, width: 1080, height: 400 } });
});

test("dialogs open over the page, not inside the box", async ({ page, browserName }) => {
  await signIn(page, "dark", browserName);
  await open(page, "widgets=notes,countdown,messages&size=min&text=M");
  for (const [widget, name] of [["notes", /new note/i], ["countdown", /add countdown/i], ["messages", /say something/i]] as const) {
    const section = page.getByTestId(`home-widget-${widget}`);
    await section.getByRole("button", { name }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Portalled to the body, wider than the box it came from.
    expect(await dialog.evaluate((el) => !el.closest("[data-home-list]"))).toBe(true);
    const d = (await dialog.boundingBox())!;
    const s = (await section.boundingBox())!;
    expect(d.width).toBeGreaterThan(s.width);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
});

/** The matrix's screens that hold a grid (the phone does not). */
const SCREENS: [string, number, number][] = [
  ["portrait-1080", 1080, 1920], ["portrait-1080-150", 720, 1280], ["landscape-1080", 1920, 1080],
  ["landscape-1080-150", 1280, 720], ["tablet-landscape", 1280, 800], ["tablet-portrait", 800, 1280], ["desktop-1440", 2560, 1440],
];
const PROBED = [...WIDGETS, "upcomingEvents", "todayStrip"];
/** Entries a box at its minimum must show: the lists ticked off show two. */
const NEED: Record<string, number> = { tasks: 2, shopping: 2 };
/**
 * Landscape screens a minimum is knowingly short of: tasks and the bins are
 * capped at 11 steps so today's Home keeps its row of cards on 1920x1080
 * (measured 12 here). At XL they show fewer entries on these screens.
 */
const SHORT_OF: Record<string, string[]> = {
  tasks: ["landscape-1080-150"],
  wasteCollection: ["tablet-landscape"],
  // Kept at 2 steps so the built-in head leaves 1920x1080 its 11-step row of cards: it may show no pill, and cuts none.
  todayStrip: ["landscape-1080-150", "tablet-landscape"],
};

test("every list's minimum holds its entries and \"+n\" at text XL on every screen", async ({ page, browserName }) => {
  test.setTimeout(900_000);
  await signIn(page, "light", browserName);
  const measured: Record<string, Record<string, number | null>> = {};
  for (const [id, width, height] of SCREENS) {
    await page.setViewportSize({ width, height });
    await page.goto("/dev/home-lists?widgets=tasks", { waitUntil: "domcontentloaded" });
    const nav = page.locator("nav:visible").last();
    await expect(nav).toBeVisible({ timeout: 90_000 });
    const navH = Math.round((await nav.boundingBox())!.height);
    const sh = height - navH;
    await page.goto(`/dev/home-lists?probe=1&sw=${width}&sh=${sh}&text=XL&max=24&widgets=${PROBED.join(",")}`, { waitUntil: "domcontentloaded" });
    measured[id] = { navH, areaH: sh } as Record<string, number>;
    for (const widget of PROBED) {
      const boxes = page.locator(`[data-probe="${widget}"]`);
      const tallest = boxes.last().locator("[data-list-shown]").first();
      await expect
        .poll(async () => Number(await tallest.getAttribute("data-list-shown").catch(() => 0)) + Number(await tallest.getAttribute("data-list-more").catch(() => 0)), { timeout: 90_000, message: `${id} ${widget} never loaded` })
        .toBeGreaterThan(NEED[widget] ?? 1);
    }
    await page.waitForTimeout(1500);
    for (const widget of PROBED) {
      const found = await page.evaluate(
        ({ widget, need }) => {
          for (const box of document.querySelectorAll<HTMLElement>(`[data-probe="${widget}"]`)) {
            const root = box.querySelector<HTMLElement>("[data-list-shown]");
            if (root && Number(root.dataset.listShown) >= need && Number(root.dataset.listMore) > 0) return Number(box.dataset.probeH);
          }
          return null;
        },
        { widget, need: NEED[widget] ?? 1 },
      );
      measured[id][widget] = found;
    }
    console.log(`${browserName} ${id}`, JSON.stringify(measured[id]));
  }
  if (process.env.HOME_LISTS_MEASURE) writeFileSync(`${process.env.HOME_LISTS_MEASURE}.${browserName}.json`, JSON.stringify(measured, null, 2));
  for (const [id, width, height] of SCREENS) {
    for (const widget of PROBED) {
      const min = HOME_WIDGETS[widget as keyof typeof HOME_WIDGETS].min.h;
      const h = measured[id][widget];
      if (width > height && !SHORT_OF[widget]?.includes(id)) {
        // Landscape: the minimum holds its entries and "+n" at XL.
        expect.soft(h, `${id} ${widget}: no height up to 24 steps holds it`).not.toBeNull();
        expect.soft(min, `${id} ${widget}: needs ${h} steps`).toBeGreaterThanOrEqual(h ?? 0);
      } else {
        // Portrait, or a minimum capped below what this screen needs: at its
        // minimum the box keeps its title, a 48px link with the count.
        await page.setViewportSize({ width, height });
        await page.goto(`/dev/home-lists?probe=1&sw=${width}&sh=${height - (measured[id].navH ?? 0)}&text=XL&max=${min}&widgets=${widget}`, { waitUntil: "domcontentloaded" });
        const box = page.locator(`[data-probe="${widget}"][data-probe-h="${min}"]`);
        await expect(box).toBeAttached({ timeout: 60_000 });
        await page.waitForTimeout(1500);
        // Nothing drawn is cut by the box's bottom edge (the strip has no title: it shows what fits, else nothing).
        const cut = await box.evaluate((el) => {
          const bottom = el.getBoundingClientRect().bottom + 0.5;
          return [...el.querySelectorAll<HTMLElement>("a, button, p, span")]
            .filter((c) => c.checkVisibility({ visibilityProperty: true }) && c.getBoundingClientRect().height > 0)
            .filter((c) => c.getBoundingClientRect().top < bottom - 0.5 && c.getBoundingClientRect().bottom > bottom)
            .map((c) => c.textContent?.slice(0, 30));
        });
        expect.soft(cut, `${id} ${widget}: cut by its box`).toEqual([]);
        if (widget === "todayStrip") continue;
        const title = box.locator("a[href], [data-home-list-title]").first();
        await expect(title, `${id} ${widget}`).toBeVisible({ timeout: 60_000 });
        const t = (await title.boundingBox())!;
        const b = (await box.boundingBox())!;
        expect.soft(t.height, `${id} ${widget}: title target`).toBeGreaterThanOrEqual(47.5);
        expect.soft(t.y + t.height, `${id} ${widget}: title inside its box`).toBeLessThanOrEqual(b.y + b.height + 0.5);
      }
    }
  }
});
