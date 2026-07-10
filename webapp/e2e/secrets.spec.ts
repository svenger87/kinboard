/**
 * Milestone A security suite — asserts integration credentials never leak
 * to the browser or to an anon PostgREST caller.
 *
 * Context: Milestone A moved integration credentials out of the
 * anon-readable `settings` table into a server-only `integration_secrets`
 * table (REVOKEd from anon/authenticated, absent from the realtime
 * publication). `GET /api/settings` masks every secret path with the
 * sentinel string `"__secret_stored__"` (see src/lib/integration-secrets.ts,
 * SECRET_SENTINEL). The demo seed (webapp/docker/seed-demo.sql) creates
 * family id 00000000-0000-0000-0000-000000000001 (join code DEMO01) with a
 * Home Assistant `access_token` of `demo-token-not-real` stored ONLY in
 * `integration_secrets`; the corresponding `settings.home_assistant` row
 * carries the non-secret fields (e.g. `url`) but no token.
 *
 * Primarily API-level (Playwright `request` fixture) — no browser needed
 * except for the page-traffic test, which follows smoke.spec.ts's rule of
 * never using `waitForLoadState("networkidle")` (Supabase Realtime keeps a
 * WebSocket open, so the network never goes idle) in favor of a fixed
 * `waitForTimeout` after `goto()`.
 *
 * Env contract:
 *   PLAYWRIGHT_BASE_URL  — Kinboard webapp origin, e.g. http://100.82.86.114:3001
 *   SUPABASE_URL         — Kong gateway origin, e.g. http://100.82.86.114:8100
 *   SUPABASE_ANON_KEY    — anon key for direct PostgREST calls via Kong
 *   FAMILY_CODE          — join code on the target stack, e.g. DEMO01
 *
 * Tests 2 and 3 require SUPABASE_URL + SUPABASE_ANON_KEY and skip
 * gracefully when unset, so this spec doesn't hard-fail on stacks that only
 * set PLAYWRIGHT_BASE_URL.
 *
 * Usage:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 \
 *   SUPABASE_URL=http://localhost:8100 \
 *   SUPABASE_ANON_KEY=... \
 *   FAMILY_CODE=DEMO01 \
 *     npx playwright test e2e/secrets.spec.ts --project=desktop
 */

import { test, expect } from "@playwright/test";
import { joinFamilyViaUI } from "./helpers";

const FAMILY_ID = "00000000-0000-0000-0000-000000000001";
const FAMILY_CODE = process.env.FAMILY_CODE ?? "";
const DEVICE_NAME = process.env.PLAYWRIGHT_DEVICE_NAME ?? "Secrets Test Device";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";

const SECRET_SENTINEL = "__secret_stored__";
const RAW_TOKEN = "demo-token-not-real";

test.describe("Settings API secret masking", () => {
  test("GET /api/settings masks the HA access_token", async ({ request }) => {
    const response = await request.get(
      `/api/settings?family_id=${FAMILY_ID}&key=home_assistant`,
    );
    expect(response.status(), "GET /api/settings?key=home_assistant").toBe(200);

    const body = await response.json();
    expect(body.value?.access_token, "value.access_token is masked").toBe(SECRET_SENTINEL);
    expect(body.value?.url, "value.url (non-secret) survives").toBeTruthy();

    const raw = JSON.stringify(body);
    expect(raw, "raw token must not appear anywhere in the response body").not.toContain(
      RAW_TOKEN,
    );
  });
});

test.describe("PostgREST anon-key boundary", () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY,
    "SUPABASE_URL / SUPABASE_ANON_KEY not set — skipping direct PostgREST checks",
  );

  test("settings.home_assistant has no access_token via anon PostgREST", async ({ request }) => {
    const response = await request.get(
      `${SUPABASE_URL}/rest/v1/settings?family_id=eq.${FAMILY_ID}&key=eq.home_assistant&select=value`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      },
    );
    expect(response.status(), "GET settings via PostgREST").toBe(200);

    const rows = await response.json();
    const raw = JSON.stringify(rows);
    expect(raw, "raw token must not appear in settings row").not.toContain(RAW_TOKEN);

    const value = rows?.[0]?.value;
    expect(
      value && typeof value === "object" ? Object.keys(value) : [],
      "settings.home_assistant.value must not carry an access_token key",
    ).not.toContain("access_token");
  });

  test("integration_secrets is unreadable with the anon key", async ({ request }) => {
    const response = await request.get(`${SUPABASE_URL}/rest/v1/integration_secrets?select=*`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    // PostgREST's response for a revoked table varies by version (401,
    // 403, or a 404-shaped error body) — accept any non-2xx and assert
    // the raw token never leaks in whatever body comes back.
    expect(
      response.status(),
      `expected a non-2xx (permission failure) status, got ${response.status()}`,
    ).toBeGreaterThanOrEqual(400);

    const text = await response.text();
    expect(text, "raw token must not appear in the error response").not.toContain(RAW_TOKEN);
  });
});

test.describe("No secret leakage in page traffic", () => {
  test.skip(!FAMILY_CODE, "FAMILY_CODE env var not set — skipping browser traffic capture");

  test("join + dashboard traffic never carries the raw HA token", async ({ page, baseURL }) => {
    const bodies: string[] = [];
    const supabaseOrigin = SUPABASE_URL ? new URL(SUPABASE_URL).origin : "";
    const appOrigin = baseURL ? new URL(baseURL).origin : "";

    page.on("response", (response) => {
      const url = response.url();
      const sameOrigin = appOrigin && url.startsWith(appOrigin);
      const supabase = supabaseOrigin && url.startsWith(supabaseOrigin);
      if (!sameOrigin && !supabase) return;

      const contentType = response.headers()["content-type"] ?? "";
      if (!/json|text/.test(contentType)) return;

      response
        .text()
        .then((body) => bodies.push(body))
        .catch(() => {
          // Body unavailable (e.g. redirected, aborted, or streaming
          // response) — nothing to inspect, skip it.
        });
    });

    await joinFamilyViaUI(page, FAMILY_CODE, DEVICE_NAME);

    // `networkidle` is unreliable here — Supabase Realtime keeps a
    // WebSocket open per subscription, so the network never goes idle.
    // Fixed settle for hydration + initial fetches instead.
    await page.waitForTimeout(2500);

    const leaked = bodies.filter((b) => b.includes(RAW_TOKEN));
    expect(
      leaked.length,
      `raw HA token found in ${leaked.length} response body/bodies`,
    ).toBe(0);
  });
});
