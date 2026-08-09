import { test, expect } from "@playwright/test";

/**
 * /api/health is the webapp container's healthcheck, so its contract is not
 * just "does it answer" — it is *which* failures are allowed to produce a
 * non-200.
 *
 * A non-200 gets the webapp restarted. That can fix a lost database
 * connection and does nothing at all for a stopped cron container or a wedged
 * realtime, so those must report `degraded` with a 200. Getting this wrong
 * trades one broken component for a restart loop across two, and the restart
 * loop is much harder to diagnose than the thing that started it.
 */
test.describe("health endpoint", () => {
  test("reports on the database, realtime and the worker", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(["ok", "degraded"]).toContain(body.status);
    expect(body.db).toBe(true);
    expect(typeof body.version).toBe("string");

    // Each subsystem is present, and tri-state: true, false, or null for
    // "could not determine". `null` matters — a fresh install whose worker has
    // not run yet is not a fault, and must not read as one.
    expect(body).toHaveProperty("realtime");
    expect(body).toHaveProperty("worker");
    for (const value of [body.realtime, body.worker]) {
      expect([true, false, null]).toContain(value);
    }
  });

  test("a subsystem being down does not fail the container's healthcheck", async ({
    request,
  }) => {
    const response = await request.get("/api/health");
    const body = await response.json();

    // Whatever realtime and the worker are doing right now, as long as the
    // database is reachable this has to stay 200.
    if (body.db === true) {
      expect(response.status()).toBe(200);
    }
    if (body.realtime === false || body.worker === false) {
      expect(body.status).toBe("degraded");
    }
  });

  test("leaks no family or user data", async ({ request }) => {
    // Unauthenticated, so the response body is world-readable by anything that
    // can reach the port.
    const body = await (await request.get("/api/health")).json();
    expect(Object.keys(body).sort()).toEqual(
      ["db", "realtime", "status", "version", "worker"].sort()
    );
  });
});
