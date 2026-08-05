import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hitLimit, clientIp } from "../src/lib/rate-limit";

/**
 * Pentest 2026-08-05, finding F1: POST /api/session/join was unmetered — 30
 * external attempts processed in 4.5s, none throttled, and each valid join
 * created a device + session row. Brute-force plus resource exhaustion.
 */

test.describe("the limiter", () => {
  test("allows up to the limit, then blocks", () => {
    const key = `t-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(hitLimit(key, 5, 60_000).limited, `attempt ${i + 1}`).toBe(false);
    }
    expect(hitLimit(key, 5, 60_000).limited).toBe(true);
  });

  test("keys are independent — one attacker can't block another user", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    for (let i = 0; i < 5; i++) hitLimit(a, 5, 60_000);
    expect(hitLimit(a, 5, 60_000).limited).toBe(true);
    expect(hitLimit(b, 5, 60_000).limited).toBe(false);
  });

  test("a blocked response carries a retry-after in the future", () => {
    const key = `r-${Math.random()}`;
    for (let i = 0; i < 3; i++) hitLimit(key, 3, 60_000);
    const r = hitLimit(key, 3, 60_000);
    expect(r.limited).toBe(true);
    expect(r.retryAfterMs).toBeGreaterThan(0);
    expect(r.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  test("counts only hits inside the window", async () => {
    const key = `w-${Math.random()}`;
    // Fill the limit, then wait out a short window and confirm it clears.
    for (let i = 0; i < 3; i++) hitLimit(key, 3, 40);
    expect(hitLimit(key, 3, 40).limited).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    expect(hitLimit(key, 3, 40).limited).toBe(false);
  });
});

test.describe("client IP", () => {
  const req = (headers: Record<string, string>) =>
    ({ headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as never;

  test("takes the left-most x-forwarded-for entry", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  test("falls back to x-real-ip, then a sentinel", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
    expect(clientIp(req({}))).toBe("unknown");
  });
});

test("both endpoints wire the limiter in before doing any work", () => {
  const joinSrc = readFileSync(join(__dirname, "..", "src", "app", "api", "session", "join", "route.ts"), "utf8");
  const createSrc = readFileSync(join(__dirname, "..", "src", "app", "api", "session", "create", "route.ts"), "utf8");

  // Join caps on IP *and* hardware id, since x-forwarded-for is spoofable.
  expect(joinSrc).toContain('hitLimit(`join:ip:');
  expect(joinSrc).toContain('hitLimit(`join:hw:');
  // Both must reject before touching the database.
  for (const [name, src] of [["join", joinSrc], ["create", createSrc]] as const) {
    const guard = src.indexOf("status: 429");
    const db = src.indexOf("createAdminClient()");
    expect(guard, name).toBeGreaterThan(-1);
    expect(guard, `${name}: 429 before db`).toBeLessThan(db);
  }
});
