import { test, expect, type Browser, type Page, type WebSocket } from "@playwright/test";

/**
 * RFC-018 §6, against a running stack with Kong as the front door: one stack,
 * opened from two addresses at once — say the LAN address on the kitchen
 * tablet and the domain on a phone — and both load their data and get live
 * updates, with every API call going to the address the page came from and
 * no CORS error anywhere.
 *
 * SAME_ORIGIN_URLS lists the two addresses, comma-separated, e.g.
 *   http://localhost:3001,http://127.0.0.1:3001
 * (two origins as far as a browser is concerned). FAMILY_CODE joins them.
 * Skipped unless both are set.
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";
const URLS = (process.env.SAME_ORIGIN_URLS ?? "").split(",").map((u) => u.trim().replace(/\/+$/, "")).filter(Boolean);

const API = /^\/(rest|auth|storage|realtime)\/v1\//;

interface Screen {
  page: Page;
  origin: string;
  apiRequests: string[];
  failures: string[];
  corsErrors: string[];
  sockets: WebSocket[];
  frames: string[];
  close: () => Promise<void>;
}

async function screenAt(browser: Browser, base: string, name: string): Promise<Screen> {
  // serviceWorkers blocked: nothing here should be answered from a cache.
  const context = await browser.newContext({ baseURL: base, serviceWorkers: "block" });
  const page = await context.newPage();
  const screen: Screen = {
    page,
    origin: new URL(base).origin,
    apiRequests: [],
    failures: [],
    corsErrors: [],
    sockets: [],
    frames: [],
    close: () => context.close(),
  };
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (API.test(u.pathname)) screen.apiRequests.push(r.url());
  });
  page.on("requestfailed", (r) => {
    if (API.test(new URL(r.url()).pathname)) screen.failures.push(`${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("console", (m) => {
    if (/cors|access-control-allow-origin/i.test(m.text())) screen.corsErrors.push(m.text());
  });
  page.on("websocket", (ws) => {
    screen.sockets.push(ws);
    ws.on("framereceived", (f) => {
      if (typeof f.payload === "string") screen.frames.push(f.payload);
    });
  });

  await page.goto("/join", { waitUntil: "domcontentloaded" });
  const res = await page.request.post("/api/session/join", {
    data: { joinCode: FAMILY_CODE, hardwareId: `e2e-same-origin-${name}`, deviceName: `e2e-same-origin-${name}` },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const joined = await res.json();
  const state = { state: { family: joined.family, device: joined.device }, version: 0 };
  await context.addCookies([
    { name: "family-calendar-storage", value: encodeURIComponent(JSON.stringify(state)), url: base },
  ]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".hero-block", { timeout: 30_000 });
  return screen;
}

test.describe("one stack, two addresses (RFC-018)", () => {
  test.skip(!FAMILY_CODE || URLS.length < 2, "needs FAMILY_CODE and two SAME_ORIGIN_URLS");

  test("each address loads its data from itself and gets live updates, without CORS", async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const tag = `${testInfo.project.name}-${Date.now().toString(36)}`;
    const a = await screenAt(browser, URLS[0], `a-${tag}`);
    const b = await screenAt(browser, URLS[1], `b-${tag}`);
    try {
      for (const s of [a, b]) {
        // The page told the client to use its own origin...
        const env = await s.page.evaluate(() => (window as unknown as { __ENV: Record<string, string> }).__ENV);
        expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("same-origin");
        // ...and it did: data was loaded, all of it from the page's own address.
        await expect.poll(() => s.apiRequests.filter((u) => u.includes("/rest/v1/")).length, { timeout: 20_000 }).toBeGreaterThan(0);
        for (const u of s.apiRequests) expect(new URL(u).origin, u).toBe(s.origin);
        // The realtime socket too.
        await expect.poll(() => s.sockets.map((w) => w.url()).find((u) => u.includes("/realtime/v1/websocket")) ?? "", { timeout: 20_000 }).toContain(
          s.origin.replace(/^http/, "ws"),
        );
      }

      // A message sent on screen A arrives on screen B over B's own socket.
      const body = `same-origin-${tag}`;
      await a.page.evaluate(async (text) => {
        const raw = decodeURIComponent(document.cookie.split("; ").find((c) => c.startsWith("family-calendar-storage="))!.split("=")[1]);
        const familyId = JSON.parse(raw).state.family.id;
        const res = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ family_id: familyId, body: text }),
        });
        if (!res.ok) throw new Error(`send failed: ${res.status}`);
      }, body);
      await expect.poll(() => b.frames.some((f) => f.includes(body) && f.includes("postgres_changes")), { timeout: 30_000 }).toBe(true);

      for (const s of [a, b]) {
        expect(s.failures, s.origin).toEqual([]);
        expect(s.corsErrors, s.origin).toEqual([]);
      }
    } finally {
      await a.close();
      await b.close();
    }
  });
});
