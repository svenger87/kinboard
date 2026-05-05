import { defineConfig } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3201";

const KIOSK_VIEWPORT = { width: 1200, height: 1920 };
const KIOSK_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 KinboardKiosk";

const IPHONE_VIEWPORT = { width: 402, height: 874 };
const IPHONE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export default defineConfig({
  testDir: ".",
  fullyParallel: false, // sequential — capturing same data + same family
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  outputDir: "./test-results",

  use: {
    baseURL: BASE_URL,
    trace: "off",
    screenshot: "off", // we explicitly call page.screenshot
    video: "off",
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    // ----------------------------------------------------------------
    // Kiosk-portrait (Mele 4C, 1200×1920) — dark + light variants.
    // The dark variant emits canonical filenames (e.g. dashboard-portrait.png);
    // the light variant suffixes -light (dashboard-portrait-light.png).
    // ----------------------------------------------------------------
    {
      name: "kiosk-portrait",
      use: {
        viewport: KIOSK_VIEWPORT,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: true,
        userAgent: KIOSK_USER_AGENT,
        storageState: "./playwright/storageState.json",
      },
      testMatch: ["**/*.kiosk.spec.ts"],
    },
    {
      name: "kiosk-portrait-light",
      use: {
        viewport: KIOSK_VIEWPORT,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: true,
        userAgent: KIOSK_USER_AGENT,
        storageState: "./playwright/storageState.json",
      },
      testMatch: ["**/*.kiosk.spec.ts"],
      // SCREENSHOT_THEME consumed by helpers.ts → setTheme + themedName.
      // Playwright doesn't expose a per-project env, so we read it from
      // process.env at module load and rely on running this project
      // separately: SCREENSHOT_THEME=light npx playwright test --project=kiosk-portrait-light
    },

    // ----------------------------------------------------------------
    // Mobile (iPhone 17 Pro) — dark + light variants.
    // ----------------------------------------------------------------
    {
      name: "mobile-iphone-17-pro",
      use: {
        viewport: IPHONE_VIEWPORT,
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: IPHONE_USER_AGENT,
        storageState: "./playwright/storageState.json",
      },
      testMatch: ["**/*.mobile.spec.ts"],
    },
    {
      name: "mobile-iphone-17-pro-light",
      use: {
        viewport: IPHONE_VIEWPORT,
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: IPHONE_USER_AGENT,
        storageState: "./playwright/storageState.json",
      },
      testMatch: ["**/*.mobile.spec.ts"],
    },

    // ----------------------------------------------------------------
    // Bootstrap — runs once to join the demo family and write
    // storageState.json. All other projects load from there.
    // ----------------------------------------------------------------
    {
      name: "bootstrap",
      use: {
        viewport: KIOSK_VIEWPORT,
      },
      testMatch: ["00-bootstrap.spec.ts"],
    },
  ],
});
