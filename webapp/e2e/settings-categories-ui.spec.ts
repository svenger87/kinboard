import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";
import { SETTINGS_CATEGORIES, SETTINGS_ENTRIES } from "../src/lib/settings-search/registry";

/**
 * The settings index as collapsible categories, rendered against a running
 * stack: closed on a plain visit, one open at a time, every `/settings#…` the
 * registry knows opens the right category with its card in view, a search hit
 * opens its category, the notices stay above everything closed, the install's
 * own category is for its operator only, Back returns to the open category,
 * and the rows are buttons a keyboard can drive. Needs FAMILY_CODE; the
 * mapping itself is checked without a browser in settings-search.spec.ts.
 *
 * The install's status endpoints are stubbed where a test needs them, with
 * the service worker blocked (it would otherwise answer first) and each stub
 * counted, so a route that never fired can't be why a test is green.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
test.use({ serviceWorkers: "block" });
// One device for the file, joined once (session.ts explains the join limit).
test.describe.configure({ mode: "serial" });
const DEVICE = "claude-settings-categories-ui";

test.afterAll(() => {
  if (!familyCode) return;
  execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c",
      `DELETE FROM devices WHERE hardware_id LIKE 'e2e-${DEVICE}%'`],
    { encoding: "utf8" },
  );
});

const INDEX_ANCHORS = SETTINGS_ENTRIES.filter((e) => e.href === "/settings").map((e) => ({
  anchor: e.anchor!,
  category: e.category,
}));

const failingBackup = {
  scheduledBackup: {
    config: { frequency: "daily", time: "03:00", day: 0, keep: 7, source: "settings", error: null },
    timeZone: "Europe/Berlin",
    location: { dir: "/data/backups/scheduled", source: "data", sameDiskAsData: true },
    lastSuccess: null,
    lastAttempt: {
      startedAt: "2026-11-28T02:00:00Z",
      finishedAt: "2026-11-28T02:00:30Z",
      ok: false,
      error: "No space left on device",
      trigger: "schedule",
    },
    failing: true,
    failingSince: "2026-11-28T02:00:30Z",
    running: false,
    nextRunAt: "2026-11-29T02:00:00Z",
    newest: null,
    count: 0,
  },
};

type Stubs = { operator?: boolean; notices?: boolean; backup?: boolean };

/** Stubs what the test asks for; returns a counter of the stubs that answered. */
async function stub(page: Page, { operator, notices, backup }: Stubs) {
  const hits: Record<string, number> = {};
  const hit = (k: string) => (hits[k] = (hits[k] ?? 0) + 1);
  if (operator !== undefined) {
    await page.route("**/api/setup/instance", (r) => {
      if (r.request().method() !== "GET") return r.fallback();
      hit("instance");
      return r.fulfill({
        json: operator
          ? { operator: true, siteUrl: { value: null, source: "none" }, pushContact: { value: null, source: "none" } }
          : { operator: false },
      });
    });
  }
  if (notices) {
    await page.route("**/api/compose-revision", (r) => {
      hit("compose");
      return r.fulfill({ json: { revision: { declared: 2, required: 3, latest: 3, outdated: true, changes: [] } } });
    });
    await page.route("**/api/old-database", (r) => {
      hit("oldDb");
      return r.fulfill({
        json: {
          oldDatabase: {
            fromMajor: "16", toMajor: "17", upgradedAt: "2026-11-20T10:00:00Z", sizeBytes: 812000000,
            rollbackOpen: false, rollbackUntil: null, previousVersion: "1.17.0", interrupted: false,
          },
        },
      });
    });
  }
  if (backup) {
    await page.route("**/api/scheduled-backup", (r) => {
      if (r.request().method() !== "GET") return r.fallback();
      hit("backup");
      return r.fulfill({ json: failingBackup });
    });
  }
  return hits;
}

async function openSettings(page: Page, path = "/settings", stubs: Stubs = { operator: true }) {
  await establishSession(page, familyCode!, DEVICE);
  const base = test.info().project.use.baseURL!;
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: base }]);
  await page.addInitScript(() => sessionStorage.removeItem("kinboard_settings_search"));
  const hits = await stub(page, stubs);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  // A dev server compiles the page on its first visit.
  await expect(page.locator("[data-settings-category=family]")).toBeVisible({ timeout: 60_000 });
  return hits;
}

const row = (page: Page, id: string) => page.locator(`#settings-category-${id}`);
const openIds = (page: Page) =>
  page.locator("[data-settings-category][data-open]").evaluateAll((els) => els.map((e) => e.getAttribute("data-settings-category")));

test("a plain visit shows every category closed, in the approved order", async ({ page }) => {
  await openSettings(page);
  // The install's row arrives with the operator check.
  await expect(row(page, "install")).toBeVisible();
  const ids = await page.locator("[data-settings-category]").evaluateAll((els) => els.map((e) => e.getAttribute("data-settings-category")));
  expect(ids).toEqual(SETTINGS_CATEGORIES.map((c) => c.id));
  expect(await openIds(page)).toEqual([]);
  for (const id of ids) await expect(row(page, id!)).toHaveAttribute("aria-expanded", "false");
  // The family code is readable without opening anything.
  await expect(page.locator("[data-settings-category=family] [data-testid=settings-category-summary]")).toContainText(/[A-Z0-9]{4,}/);
});

test("one category is open at a time, and the hash follows without new history entries", async ({ page }) => {
  await openSettings(page);
  const before = await page.evaluate(() => history.length);

  await row(page, "family").click();
  expect(await openIds(page)).toEqual(["family"]);
  await expect(page).toHaveURL(/\/settings#family$/);

  await row(page, "board").click();
  expect(await openIds(page)).toEqual(["board"]);
  await expect(row(page, "family")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#settings-category-family-panel")).toBeHidden();
  await expect(page.locator('a[href="/settings/widgets"]')).toBeVisible();
  await expect(page).toHaveURL(/\/settings#board$/);

  await row(page, "board").click();
  expect(await openIds(page)).toEqual([]);
  await expect(page).toHaveURL(/\/settings$/);
  expect(await page.evaluate(() => history.length)).toBe(before);
});

for (const { anchor, category } of INDEX_ANCHORS) {
  test(`/settings#${anchor} opens "${category}" with the card in view`, async ({ page }) => {
    // The scheduled backups exist only on the all-in-one image; stubbed here.
    await openSettings(page, `/settings#${anchor}`, { operator: true, backup: anchor === "scheduled-backup" });
    await expect.poll(() => openIds(page), { timeout: 10_000 }).toEqual([category]);
    const card = page.locator(`[data-setting="${anchor}"]`);
    await expect(card).toBeVisible();
    // The ring lasts two seconds from when the card is found; check it first.
    await expect(card).toHaveClass(/settings-anchor-highlight/, { timeout: 10_000 });
    await expect(card).toBeInViewport({ timeout: 10_000 });
  });
}

for (const c of SETTINGS_CATEGORIES) {
  test(`/settings#${c.id} opens that category, row in view`, async ({ page }) => {
    await openSettings(page, `/settings#${c.id}`);
    await expect.poll(() => openIds(page), { timeout: 10_000 }).toEqual([c.id]);
    await expect(row(page, c.id)).toBeInViewport();
    await expect(page.locator(`#settings-category-${c.id}-panel`)).toBeVisible();
  });
}

test("/settings#instance, the install card's id, opens This install", async ({ page }) => {
  await openSettings(page, "/settings#instance");
  await expect.poll(() => openIds(page), { timeout: 10_000 }).toEqual(["install"]);
  await expect(page.getByTestId("instance-card")).toBeInViewport();
});

test("a link to a card while another category is open switches to its category", async ({ page }) => {
  await openSettings(page, "/settings#board");
  await expect.poll(() => openIds(page)).toEqual(["board"]);
  await page.evaluate(() => (window.location.hash = "diagnostics"));
  await expect.poll(() => openIds(page)).toEqual(["about"]);
  await expect(page.locator('[data-setting="diagnostics"]')).toBeInViewport({ timeout: 10_000 });
});

test("a search hit inside a closed category opens it and scrolls to the card", async ({ page }) => {
  await openSettings(page);
  const input = page.getByTestId("settings-search-input");
  await input.fill("feed");
  // "feed" also finds the iCalendar feeds page; the index card is among the hits.
  const hit = page.locator('[data-testid=settings-search-result][href="/settings#calendar-feed"]');
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(/\/settings#calendar-feed$/);
  await expect.poll(() => openIds(page)).toEqual(["calendars"]);
  await expect(page.locator('[data-setting="calendar-feed"]')).toBeInViewport({ timeout: 10_000 });
});

test("notices stay above the categories with everything closed, and dot their category", async ({ page }) => {
  const hits = await openSettings(page, "/settings", { operator: true, notices: true, backup: true });
  await expect(page.getByTestId("compose-revision-notice")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("old-database-notice")).toBeVisible();
  await expect(page.getByTestId("scheduled-backup-notice")).toBeVisible();
  expect(hits.compose).toBeGreaterThan(0);
  expect(hits.oldDb).toBeGreaterThan(0);
  expect(hits.backup).toBeGreaterThan(0);
  expect(await openIds(page)).toEqual([]);

  const firstRowTop = (await page.locator("[data-settings-category]").first().boundingBox())!.y;
  for (const id of ["compose-revision-notice", "old-database-notice", "scheduled-backup-notice"]) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.y + box.height, id).toBeLessThanOrEqual(firstRowTop);
    // Not inside any category.
    expect(await page.getByTestId(id).evaluate((el) => !!el.closest("[data-settings-category]")), id).toBe(false);
  }
  await expect(page.locator("[data-settings-category=install] [data-testid=settings-category-attention]")).toBeVisible();
  await expect(page.locator("[data-settings-category=data] [data-testid=settings-category-attention]")).toHaveAttribute("data-attention", "error");
  // The backup notice's own link opens Data & safety at the backups.
  await page.getByTestId("scheduled-backup-notice").getByRole("link").click();
  await expect.poll(() => openIds(page)).toEqual(["data"]);
  await expect(page.locator('[data-setting="scheduled-backup"]')).toBeInViewport({ timeout: 10_000 });
});

test("This install is not there for a family that does not run the install", async ({ page }) => {
  const hits = await openSettings(page, "/settings#install", { operator: false });
  await expect.poll(() => hits.instance ?? 0).toBeGreaterThan(0);
  await expect(row(page, "about")).toBeVisible();
  await expect(page.locator("[data-settings-category=install]")).toHaveCount(0);
  await expect(page.getByTestId("instance-card")).toHaveCount(0);
  expect(await openIds(page)).toEqual([]);
});

test("Back from a page opened in a category returns to it open", async ({ page }) => {
  await openSettings(page);
  await row(page, "calendars").click();
  await page.locator('a[href="/settings/holidays"]').click();
  await expect(page).toHaveURL(/\/settings\/holidays$/, { timeout: 30_000 });
  // WebKit re-navigates to the same URL shortly after a load (#378): let it settle.
  await page.waitForTimeout(2500);
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/settings#calendars$/);
  await expect.poll(() => openIds(page), { timeout: 10_000 }).toEqual(["calendars"]);
  await expect(page.locator('a[href="/settings/holidays"]')).toBeVisible();
});

test("the page's own back arrow returns to the category the page is in", async ({ page }) => {
  await establishSession(page, familyCode!, DEVICE);
  await page.goto("/settings/recycle-bin", { waitUntil: "domcontentloaded" });
  const back = page.locator('main a[href="/settings#data"]');
  await expect(back).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await back.click();
  await expect(page).toHaveURL(/\/settings#data$/, { timeout: 30_000 });
  await expect.poll(() => openIds(page), { timeout: 10_000 }).toEqual(["data"]);
});

test("rows are buttons with aria-expanded and aria-controls, and a keyboard can drive them", async ({ page }) => {
  await openSettings(page);
  const rows = page.locator("[data-category-row]");
  const count = await rows.count();
  expect(count).toBe(SETTINGS_CATEGORIES.length);
  for (let i = 0; i < count; i++) {
    const r = rows.nth(i);
    expect(await r.evaluate((el) => el.tagName)).toBe("BUTTON");
    expect(await r.evaluate((el) => el.parentElement?.tagName)).toBe("H2");
    const controls = await r.getAttribute("aria-controls");
    const panel = page.locator(`#${controls}`);
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAttribute("role", "region");
    await expect(panel).toHaveAttribute("aria-labelledby", (await r.getAttribute("id"))!);
  }

  // Closed panels are out of the tab order.
  await rows.first().focus();
  await page.keyboard.press("Tab");
  await expect(rows.nth(1)).toBeFocused();

  // Arrows, Home and End move between rows; Enter and Space open and close.
  await page.keyboard.press("ArrowUp");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(rows.nth(1)).toHaveAttribute("aria-expanded", "true");
  await expect(rows.nth(1)).toBeFocused();
  // Into the open panel: its first link is the next stop.
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("#settings-category-calendars-panel"))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press(" ");
  await expect(rows.nth(2)).toHaveAttribute("aria-expanded", "true");
  await expect(rows.nth(1)).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press(" ");
  await expect(rows.nth(2)).toHaveAttribute("aria-expanded", "false");
});
