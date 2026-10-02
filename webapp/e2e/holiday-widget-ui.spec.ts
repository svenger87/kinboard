import { expect, test } from "@playwright/test";
import { execFileSync } from "child_process";
import { establishSession } from "./session";
import { acquireWholeDatabase, dbContainer, releaseWholeDatabase } from "./whole-database";

/**
 * The holiday widget for a family without a region (RFC-014 §4.2), rendered:
 * it shows no holidays and links to Settings → Holidays -- but only when the
 * region is known to be unset. A read that fails must not ask a family that
 * chose one to choose again. Run with --project=webkit as well as Chromium.
 * Needs FAMILY_CODE and a running stack.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");

// The PWA service worker answers fetches before page.route sees them.
test.use({ serviceWorkers: "block" });

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

let familyId = "";
const saved = new Map<string, string>();
const KEYS = ["holiday_region", "widget_visibility"];

function put(key: string, value: string) {
  psql(
    `INSERT INTO settings (family_id, key, value) VALUES ('${familyId}', '${key}', ${quote(value)}::jsonb)
     ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value`,
  );
}

test.beforeEach(async () => {
  familyId = "";
  saved.clear();
  await acquireWholeDatabase();
  familyId = psql(`SELECT id FROM families WHERE join_code = '${familyCode}'`);
  for (const key of KEYS) {
    saved.set(key, psql(`SELECT value::text FROM settings WHERE family_id = '${familyId}' AND key = '${key}'`));
  }
  const visibility = JSON.parse(saved.get("widget_visibility") || "{}");
  put("widget_visibility", JSON.stringify({ ...visibility, holidays: true }));
  put("holiday_region", JSON.stringify({ code: null, chosen: false }));
});

test.afterEach(() => {
  try {
    // Nothing to put back when beforeEach never got the lock.
    if (!familyId) return;
    for (const key of KEYS) {
      const value = saved.get(key);
      if (value) put(key, value);
      else psql(`DELETE FROM settings WHERE family_id = '${familyId}' AND key = '${key}'`);
    }
    // This spec's own devices only: other specs may be mid-run with theirs.
    psql(`DELETE FROM devices WHERE hardware_id LIKE 'e2e-claude-holiday-widget-%'`);
  } finally {
    releaseWholeDatabase();
  }
});

const heading = /^(Holidays|Feiertage|Jours fériés)$/;

test("without a region, the widget links to Settings → Holidays", async ({ page }, testInfo) => {
  // One device name per test: afterEach deletes the device, and with it the
  // session establishSession would otherwise replay for the next test.
  await establishSession(page, familyCode!, "claude-holiday-widget-unset");
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const link = page.locator('a[href="/settings/holidays"]');
  await expect(link).toBeVisible({ timeout: 30_000 });
  await expect(link).toContainText(/Settings → Holidays|Einstellungen → Feiertage|Paramètres → Jours fériés/);
  const card = link.locator("xpath=ancestor::*[contains(@class,'accent-border-top')][1]");
  await expect(card.getByRole("heading", { name: heading })).toBeVisible();
  // No holiday rows, and no "no holidays coming up" next to the link.
  await expect(card.locator(".elev-sm")).toHaveCount(0);
  const box = await link.boundingBox();
  const cardBox = await card.boundingBox();
  expect(box && cardBox && box.x >= cardBox.x && box.x + box.width <= cardBox.x + cardBox.width + 0.5).toBe(true);
  // The card fades in (framer-motion, from opacity 0): wait it out, or the
  // screenshot is of an empty box.
  await expect
    .poll(() =>
      card.evaluate((el) => {
        let opacity = 1;
        for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
        return opacity;
      }),
    )
    .toBe(1);
  // Centred, the way a person scrolls to read it -- not flush with the bottom
  // edge, where an element screenshot would put it, under the fixed nav.
  await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
  // Present is not the same as seen: whatever is painted at the middle of the
  // explanation must be part of this card, not a fixed bar laid over it.
  const hit = await link.locator("p").evaluate((text) => {
    const r = text.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const card = text.closest(".accent-border-top");
    return { inCard: !!top && !!card && card.contains(top), top: top ? `${top.tagName}.${top.className}`.slice(0, 120) : null };
  });
  expect(hit.inCard, `the explanation is covered by ${hit.top}`).toBe(true);
  await card.screenshot({ path: testInfo.outputPath(`widget-noregion-${testInfo.project.name}.png`) });

  await link.click();
  // A dev server compiles the page on first visit; allow for it.
  await expect(page).toHaveURL(/\/settings\/holidays$/, { timeout: 30_000 });
  await expect(page.locator("#holiday-region-country")).toBeVisible({ timeout: 30_000 });
});

test("when the region cannot be read, the widget does not ask for one", async ({ page }) => {
  await establishSession(page, familyCode!, "claude-holiday-widget-error");
  let hits = 0;
  await page.route(/\/rest\/v1\/settings\?.*key=eq\.holiday_region/, (route) => {
    hits++;
    return route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 30_000 });
  // The query retries three times (about 7 s of backoff) before it errors;
  // wait for the last attempt, then give the widget time to render the error.
  await expect.poll(() => hits, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
  await page.waitForTimeout(1_500);
  await expect(page.locator('a[href="/settings/holidays"]')).toHaveCount(0);
});
