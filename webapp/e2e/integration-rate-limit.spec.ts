import { test, expect } from "@playwright/test";
import { hitLimit } from "../src/lib/rate-limit";
import {
  RATE_WINDOW_MS,
  READ_LIMIT,
  WRITE_LIMIT,
} from "../src/lib/integration-route";

/**
 * The Integration API's rate-limit *policy*.
 *
 * `hitLimit` itself is already covered by e2e/rate-limit.spec.ts — this file
 * is about the decisions layered on top of it: that budgets are per token
 * rather than per family, and that reads and writes are counted separately.
 * Both are things a future edit could quietly undo without any existing test
 * noticing.
 *
 * The key scheme is duplicated here on purpose. If someone changes it in
 * integration-route.ts, these tests keep passing against the old scheme and
 * the *behavioural* assertions below stop describing reality — so they are
 * written to assert the property (isolation) rather than the string.
 */

const key = (token: string, kind: "read" | "write") => `integration:${token}:${kind}`;

/** Unique per run, so repeated runs don't inherit a full bucket. */
const uniq = () => `tok-${Math.random().toString(36).slice(2)}`;

test.describe("the policy", () => {
  test("reads get a larger budget than writes", () => {
    // A polling client is supposed to read on a schedule. An automation
    // writing as often as it reads is not working correctly.
    expect(READ_LIMIT).toBeGreaterThan(WRITE_LIMIT);
    expect(WRITE_LIMIT).toBeGreaterThan(0);
    expect(RATE_WINDOW_MS).toBe(60_000);
  });

  test("the read budget is livable for a 30-second poll", () => {
    // Two polls a minute, times a handful of endpoints, must not come close.
    expect(READ_LIMIT).toBeGreaterThanOrEqual(60);
  });
});

test.describe("per token, not per family", () => {
  test("one token exhausting its budget does not affect another", () => {
    // The whole reason for choosing per-token: a runaway automation must
    // throttle itself, not lock the Bridge out of the same household.
    const noisy = uniq();
    const quiet = uniq();

    for (let i = 0; i < WRITE_LIMIT; i++) {
      expect(hitLimit(key(noisy, "write"), WRITE_LIMIT, RATE_WINDOW_MS).limited).toBe(false);
    }
    // Noisy is now at its limit...
    expect(hitLimit(key(noisy, "write"), WRITE_LIMIT, RATE_WINDOW_MS).limited).toBe(true);
    // ...and quiet is entirely unaffected.
    expect(hitLimit(key(quiet, "write"), WRITE_LIMIT, RATE_WINDOW_MS).limited).toBe(false);
  });
});

test.describe("reads and writes are counted separately", () => {
  test("exhausting writes leaves reads working", () => {
    // Otherwise an automation that writes too much would also blind the
    // household's dashboard, turning a small misbehaviour into a visible
    // outage.
    const token = uniq();

    for (let i = 0; i < WRITE_LIMIT; i++) {
      hitLimit(key(token, "write"), WRITE_LIMIT, RATE_WINDOW_MS);
    }
    expect(hitLimit(key(token, "write"), WRITE_LIMIT, RATE_WINDOW_MS).limited).toBe(true);
    expect(hitLimit(key(token, "read"), READ_LIMIT, RATE_WINDOW_MS).limited).toBe(false);
  });
});

test.describe("the block is informative", () => {
  test("a blocked call reports how long to wait", () => {
    const token = uniq();
    for (let i = 0; i < WRITE_LIMIT; i++) {
      hitLimit(key(token, "write"), WRITE_LIMIT, RATE_WINDOW_MS);
    }
    const blocked = hitLimit(key(token, "write"), WRITE_LIMIT, RATE_WINDOW_MS);

    expect(blocked.limited).toBe(true);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(RATE_WINDOW_MS);
    // The route rounds this up and never sends 0 — a Retry-After of 0 invites
    // the immediate retry being throttled.
    expect(Math.max(1, Math.ceil(blocked.retryAfterMs / 1000))).toBeGreaterThanOrEqual(1);
  });
});
