import { defineConfig } from "@playwright/test";

// Two concurrent uses of this config:
//   1. Visual audit (visual-audit.spec.ts) — capture PNGs of every route.
//      Needs FAMILY_CODE pointing at a stack with real data.
//   2. Smoke (smoke.spec.ts) — behavior assertions, FAMILY_CODE optional.
//
// Set PLAYWRIGHT_BASE_URL to point at any reachable Kinboard. Defaults to
// localhost:3000 (the dev server). When PLAYWRIGHT_AUTOSTART_DEV=1, the
// dev server auto-spawns; useful for CI / fresh checkouts. Off by default
// so it doesn't fight an already-running `npm run dev`.

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const AUTOSTART = process.env.PLAYWRIGHT_AUTOSTART_DEV === "1";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/results",
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
  ...(AUTOSTART
    ? {
        webServer: {
          command: "npm run dev",
          url: BASE_URL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }
    : {}),
});
