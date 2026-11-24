import { defineConfig } from "@playwright/test";
import { exactly, splitSpecs } from "./e2e/spec-projects";

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

// Specs that never touch a browser run once, in `unit`; the rest run in
// desktop, mobile and webkit. The rule is in e2e/spec-projects.ts, and
// e2e/spec-projects.spec.ts checks it.
const UNIT_SPECS = exactly(splitSpecs(`${__dirname}/e2e`).unit);

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
    /*
      Plain Node tests: source assertions, pure functions, and the specs that
      talk to the database or PostgREST without a browser. About three in four
      spec files. Run once — a viewport or an engine means nothing to them.

      No browser can start here: the executable is a path that does not
      exist, so a spec put here by mistake fails loudly on its first `page`
      instead of passing without the coverage it was written for.
    */
    {
      name: "unit",
      testMatch: UNIT_SPECS,
      use: {
        browserName: "chromium",
        launchOptions: { executablePath: "/the-unit-project-has-no-browser--see-e2e/spec-projects.ts" },
      },
    },
    {
      name: "desktop",
      testIgnore: UNIT_SPECS,
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile",
      testIgnore: UNIT_SPECS,
      use: { viewport: { width: 390, height: 844 } },
    },
    /*
      Safari, which is not optional for this project.

      Both projects above are Chromium, so a rule that Chromium honours and
      WebKit ignores passed everything and shipped. `min-height: min-content`
      against a `max-height` is exactly that: it fixed the dashboard hero
      overlap in Chromium (#231) and did nothing at all in WebKit, so the
      Today strip stayed underneath the widget grid on every Mac and iPad —
      52px of overlap on a MacBook Air, found only when a user reported it
      from Safari.

      1440x810 is a MacBook Air at its default scaling with Safari's chrome
      taking its cut, i.e. the machine the report came from — and the widest
      gap between the two engines in that measurement.

      Specs that read source files rather than drive a browser are in `unit`
      instead. CI points this project (`--project=webkit`) at the specs that
      actually render something.
    */
    {
      name: "webkit",
      testIgnore: UNIT_SPECS,
      use: { browserName: "webkit", viewport: { width: 1440, height: 810 } },
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
