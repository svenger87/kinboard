import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { homeMin } from "../src/lib/layouts/home-size";

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
test.describe.configure({ timeout: 900_000 });

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
  // Measured in one pass in the page: on a busy machine a locator call per target took minutes.
  const r = await page.getByTestId(`home-widget-${widget}`).evaluate((section) => {
    const rect = (el: Element) => el.getBoundingClientRect();
    const box = rect(section);
    const root = section.querySelector<HTMLElement>("[data-list-shown]")!;
    const shown = Number(root.dataset.listShown);
    const more = Number(root.dataset.listMore);
    const visible = root.querySelector("[data-list-visible]");
    const rows = visible ? [...visible.children].filter((c) => (c as HTMLElement).dataset.testid !== "list-more") : [];
    const moreLine = visible?.querySelector<HTMLElement>("[data-testid=list-more]") ?? null;
    const moreShown = !!moreLine && moreLine.checkVisibility();
    const seen = (el: Element) => (el as HTMLElement).checkVisibility({ visibilityProperty: true }) && rect(el).height > 0;
    const targets = [...section.querySelectorAll("a, button, [data-list-visible] label")]
      .filter(seen)
      // A checkbox's own label sits inside the row's label, which is the target.
      .filter((el) => !(el.tagName === "LABEL" && el.querySelector("input")))
      .map((el) => ({ what: `${el.tagName} ${(el.textContent ?? "").trim().slice(0, 30)}`, w: rect(el).width, h: rect(el).height }));
    return {
      shown,
      more,
      rowCount: rows.length,
      rowsPastBottom: rows.filter((row) => rect(row).bottom > box.bottom + 0.5).length,
      moreShown,
      moreText: moreLine?.textContent ?? "",
      morePastBottom: moreShown ? rect(moreLine!).bottom > box.bottom + 0.5 : false,
      moreHref: moreLine?.querySelector("a")?.getAttribute("href") ?? null,
      titleHref: section.querySelector("[data-home-list-title]")?.getAttribute("href") ?? null,
      targets,
    };
  });
  expect(r.rowCount, `${widget}: rows drawn`).toBe(r.shown);
  // Whole entries only: nothing drawn past the box's bottom edge.
  expect(r.rowsPastBottom, `${widget}: an entry runs past its box`).toBe(0);
  // "+n" is the rest, and leads to the widget's page (when shown at all).
  if (r.more > 0 && r.shown > 0) {
    expect(r.moreShown, `${widget}: "+n" shown`).toBe(true);
    expect(r.moreText).toContain(`+${r.more}`);
    expect(r.morePastBottom, `${widget}: "+n" runs past its box`).toBe(false);
    expect(r.moreHref, `${widget}: "+n" link`).toBe(PAGES[widget]);
  } else {
    expect(r.moreShown, `${widget}: "+n" hidden`).toBe(false);
  }
  expect(r.titleHref, `${widget}: title link`).toBe(PAGES[widget]);
  // Touch targets: 48px at least, whatever the text size.
  for (const s of r.targets) {
    expect(s.h, `${widget}: ${s.what} is ${s.h}px tall`).toBeGreaterThanOrEqual(47.5);
    expect(s.w, `${widget}: ${s.what} is ${s.w}px wide`).toBeGreaterThanOrEqual(47.5);
  }
  return { shown: r.shown, more: r.more, targets: r.targets.length, minTarget: Math.min(...r.targets.map((s) => Math.min(s.w, s.h))) };
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
  ["4:3", 1024, 768], ["ultrawide", 2560, 1080],
];
const PROBED = [...WIDGETS, "upcomingEvents", "todayStrip"];
/** Entries a box at its minimum must show: the lists ticked off show two. */
const NEED: Record<string, number> = { tasks: 2, shopping: 2 };

/** The Home area of a screen: its height less the navigation bar, as drawn. */
async function areaOf(page: Page, width: number, height: number): Promise<{ sw: number; sh: number; navH: number }> {
  await page.setViewportSize({ width, height });
  await page.goto("/dev/home-lists?widgets=tasks", { waitUntil: "domcontentloaded" });
  const nav = page.locator("nav:visible").last();
  await expect(nav).toBeVisible({ timeout: 90_000 });
  const navH = Math.round((await nav.boundingBox())!.height);
  return { sw: width, sh: height - navH, navH };
}

/**
 * Minimums follow pixels (home-size.ts), so one rule holds on every screen,
 * portrait included: at its minimum for the screen and text size, a list
 * shows its title, its entries (two for tasks and shopping) and "+n", and
 * cuts nothing. Measured at S, M and XL; the first height that holds them
 * is logged, for the record.
 */
for (const text of ["S", "M", "XL"] as const) {
  test(`every list's minimum holds its entries and "+n" at text ${text} on every screen`, async ({ page, browserName }) => {
    test.setTimeout(900_000);
    await signIn(page, "light", browserName);
    const measured: Record<string, Record<string, number | null>> = {};
    const failures: string[] = [];
    for (const [id, width, height] of SCREENS) {
      const { sw, sh, navH } = await areaOf(page, width, height);
      const mins = Object.fromEntries(PROBED.map((w) => [w, homeMin(w as never, text, sw, sh).h]));
      // Beyond the minimums, so the first height that holds is found even where a minimum is short.
      const max = Math.ceil(Math.max(...Object.values(mins)) * 1.6) + 2;
      await page.goto(`/dev/home-lists?probe=1&sw=${sw}&sh=${sh}&text=${text}&from=2&max=${max}&widgets=${PROBED.join(",")}`, { waitUntil: "domcontentloaded" });
      measured[id] = { navH, areaH: sh };
      for (const widget of PROBED) {
        const tallest = page.locator(`[data-probe="${widget}"][data-probe-min]`).locator("[data-list-shown]").first();
        await expect
          .poll(async () => Number(await tallest.getAttribute("data-list-shown").catch(() => 0)) + Number(await tallest.getAttribute("data-list-more").catch(() => 0)), { timeout: 90_000, message: `${id} ${widget} never loaded` })
          .toBeGreaterThan(NEED[widget] ?? 1);
      }
      await page.waitForTimeout(1500);
      for (const widget of PROBED) {
        const r = await page.evaluate(
          ({ widget, need }) => {
            const boxes = [...document.querySelectorAll<HTMLElement>(`[data-probe="${widget}"]`)];
            const holds = (box: HTMLElement) => {
              const root = box.querySelector<HTMLElement>("[data-list-shown]");
              return !!root && Number(root.dataset.listShown) >= need && Number(root.dataset.listMore) > 0;
            };
            const first = boxes.find(holds);
            const atMin = boxes.find((b) => b.dataset.probeMin !== undefined)!;
            const bottom = atMin.getBoundingClientRect().bottom + 0.5;
            const cut = [...atMin.querySelectorAll<HTMLElement>("a, button, p, span, label")]
              .filter((c) => c.checkVisibility({ visibilityProperty: true }) && c.getBoundingClientRect().height > 0)
              .filter((c) => c.getBoundingClientRect().top < bottom - 0.5 && c.getBoundingClientRect().bottom > bottom)
              .map((c) => c.textContent?.slice(0, 30));
            return { first: first ? Number(first.dataset.probeH) : null, holds: holds(atMin), min: Number(atMin.dataset.probeH), cut };
          },
          { widget, need: NEED[widget] ?? 1 },
        );
        measured[id][widget] = r.first;
        // The today strip has no title and no entries to count: one pill, or its "+n", is what it must hold.
        if (!r.holds) failures.push(`${id} ${widget}: its minimum (${r.min} steps) does not hold ${NEED[widget] ?? 1} entr(ies) and "+n"; ${r.first ?? "nothing up to it"} does`);
        if (r.cut.length) failures.push(`${id} ${widget}: cut by its box at its minimum: ${r.cut.join(" | ")}`);
      }
      console.log(`${browserName} ${text} ${id}`, JSON.stringify(measured[id]));
    }
    if (process.env.HOME_LISTS_MEASURE) writeFileSync(`${process.env.HOME_LISTS_MEASURE}.${text}.${browserName}.json`, JSON.stringify(measured, null, 2));
    expect(failures).toEqual([]);
  });
}

/**
 * The clock block's pieces and the fixed cards at their minimum, full width
 * (as the clock block sits) or at their minimum width: each drawn at its
 * text size, not shrunk to fit: the date with its week badge, the greeting,
 * the members stacked with names and status lines; a fixed card in an
 * arrangement of its own, without its last-resort shrink (CapFit).
 */
const HEAD = ["date", "greeting", "familyMembers"];
const FIXED = ["weather", "weekOverview", "schedule", "vehicles", "stonks", "pocketMoney", "creatures", "photos", "timers", "media"];
for (const text of ["S", "M", "XL"] as const) {
  test(`the clock block and the fixed cards are whole at their minimum, text ${text}, on every screen`, async ({ page, browserName }) => {
    test.setTimeout(900_000);
    await signIn(page, "light", browserName);
    const failures: string[] = [];
    for (const [id, width, height] of SCREENS) {
      const { sw, sh } = await areaOf(page, width, height);
      for (const [keys, full] of [[HEAD, true], [FIXED, false]] as const) {
        const max = Math.max(...keys.map((w) => homeMin(w as never, text, sw, sh).h));
        // Only the boxes at their minimum matter here: start a little below it.
        await page.goto(`/dev/home-lists?probe=1&sw=${sw}&sh=${sh}&text=${text}&from=1&max=${max}&full=${full ? 1 : 0}&widgets=${keys.join(",")}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(4000);
        const found = await page.evaluate((keys) => keys.map((widget) => {
          const box = document.querySelector<HTMLElement>(`[data-probe="${widget}"][data-probe-min]`);
          if (!box) return `${widget}: no box at its minimum`;
          const fit = box.querySelector<HTMLElement>("[data-fit]")?.dataset.fit;
          if (fit && fit !== "full") return `${widget}: drawn smaller than its text size (${fit})`;
          if (box.querySelector("[data-cap-fit]")) return `${widget}: shrunk to fit (CapFit)`;
          const r = box.getBoundingClientRect();
          const out = [...box.querySelectorAll<HTMLElement>("*")]
            .filter((c) => c.checkVisibility({ visibilityProperty: true }) && c.getBoundingClientRect().height > 0)
            .find((c) => { const b = c.getBoundingClientRect(); return b.bottom > r.bottom + 1 || b.right > r.right + 1; });
          return out ? `${widget}: ${out.tagName.toLowerCase()} "${(out.textContent ?? "").slice(0, 20)}" past its box` : null;
        }), [...keys]);
        for (const f of found) if (f) failures.push(`${id} ${text}: ${f}`);
      }
    }
    expect(failures).toEqual([]);
  });
}

// Last: it ticks entries off, and the measurements above need the family as seeded.
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
