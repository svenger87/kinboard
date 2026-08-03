import { Page, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

// ESM doesn't expose __dirname; reconstruct from import.meta.url.
// Playwright transpiles via tsx which honors import.meta.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Resolved at module-load — read the demo family's join code from postgres. */
export function getDemoJoinCode(): string {
  // Explicit code wins. The capture has to be runnable from inside a
  // container (the Playwright image is the only place a browser will
  // start on a Slackware host like Unraid), and `docker exec` isn't
  // available there without mounting the socket — which is a lot of
  // privilege to hand a screenshot job.
  const fromEnv = process.env.DEMO_JOIN_CODE?.trim();
  if (fromEnv) return fromEnv;

  // Container name is overridable so the capture can run against any
  // seeded stack, not only the one scripts/2-bringup.sh creates — e.g. a
  // throwaway demo stack on a different compose project.
  const container = process.env.DEMO_DB_CONTAINER ?? "kinboard-demo-db";
  const out = execSync(
    `docker exec ${container} psql -U postgres -d postgres -tAc "SELECT join_code FROM public.families LIMIT 1"`,
    { encoding: "utf8" },
  ).trim();
  if (!out) throw new Error("Could not read demo join code from postgres");
  return out;
}

/** Where screenshots land. Resolved relative to playwright/ -> screenshots/ -> docs/wiki/images/. */
export const IMAGES_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "images",
);

export const MOBILE_IMAGES_DIR = path.resolve(IMAGES_DIR, "mobile");

/**
 * Disable animations + smooth scrolling globally so screenshots are
 * deterministic. Inject before each navigation.
 */
export async function killAnimations(page: Page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.id = "__screenshot-anti-animation";
    style.textContent = `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
      }
    `;
    document.documentElement.appendChild(style);
  });
}

/**
 * Force a specific theme via next-themes' localStorage convention. Reads
 * SCREENSHOT_THEME from process.env (set per project in playwright.config.ts).
 * Defaults to "dark" if unset.
 */
export const SCREENSHOT_THEME =
  (process.env.SCREENSHOT_THEME ?? "dark") as "light" | "dark";

/**
 * Pin the page's clock to a Monday at 10:30 AM local time so the demo
 * dashboard shows mid-school-day schedule (instead of "school is out"),
 * "Good morning" greeting, and a believable mid-day timestamp.
 *
 * We pick "next Monday at 10:30" relative to real now — that way the
 * dates seeded for "today" + meal plans still align with the visible
 * day. If today is already a Monday, this is today; otherwise it shifts
 * forward to the next Monday.
 */
export async function pinClockToSchoolDay(page: Page) {
  const now = new Date();
  const target = new Date(now);
  // Walk forward to next Monday (or stay if already Monday)
  while (target.getDay() !== 1) target.setDate(target.getDate() + 1);
  target.setHours(10, 30, 0, 0);
  await page.clock.install({ time: target });
  await page.clock.resume();
}

export async function setTheme(page: Page, theme: "light" | "dark" = SCREENSHOT_THEME) {
  await page.addInitScript((t) => {
    try { window.localStorage.setItem("theme", t); } catch { /* ignore */ }
  }, theme);
}

/**
 * Suffix the filename with the theme so light + dark variants don't
 * overwrite each other. Only applied when SCREENSHOT_THEME is "light";
 * dark stays at the un-suffixed canonical name (matches the wiki's
 * default-dark expectation).
 */
export function themedName(name: string): string {
  if (SCREENSHOT_THEME === "light") {
    return name.replace(/\.png$/, "") + "-light";
  }
  return name;
}

/**
 * Wait for the page to be visually settled — DOM ready + network idle +
 * any in-flight image loads. Catches most "page rendered halfway" cases.
 */
export async function waitForReady(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page
    .evaluate(() =>
      Promise.all(
        Array.from(document.images)
          .filter((img) => !img.complete)
          .map(
            (img) =>
              new Promise((res) => {
                img.addEventListener("load", res, { once: true });
                img.addEventListener("error", res, { once: true });
              }),
          ),
      ),
    )
    .catch(() => {});
  // small extra to let framer-motion settle its first paint
  await page.waitForTimeout(300);
}

/**
 * Take a screenshot of the current page (full viewport, not full page).
 * Path is resolved under docs/wiki/images/ for kiosk shots and
 * docs/wiki/images/mobile/ for mobile shots.
 */
export async function snap(
  page: Page,
  name: string,
  opts: { fullPage?: boolean; mobile?: boolean } = {},
) {
  const dir = opts.mobile ? MOBILE_IMAGES_DIR : IMAGES_DIR;
  const themed = themedName(name);
  const filename = themed.endsWith(".png") ? themed : `${themed}.png`;
  const out = path.join(dir, filename);
  await page.screenshot({
    path: out,
    fullPage: opts.fullPage ?? false,
    omitBackground: false,
  });
  console.log(`  ${path.relative(process.cwd(), out)}`);
}

/**
 * Verify a route returned 200, not the auth-guard redirect. If you see
 * the join page, the storageState bootstrap didn't take.
 */
export async function expectAuthed(page: Page) {
  const url = page.url();
  if (url.includes("/join")) {
    throw new Error(
      `Route redirected to /join — storageState.json missing or stale. Re-run 00-bootstrap.spec.ts.`,
    );
  }
}
