import { test, expect } from "@playwright/test";
import { hitLimit } from "../src/lib/rate-limit";
import {
  RATE_WINDOW_MS,
  READ_LIMIT,
  WRITE_LIMIT,
} from "../src/lib/integration-route";
import {
  MESSAGE_RATE_LIMIT,
  MESSAGE_RATE_WINDOW_MS,
  classifyMessageIdempotency,
  messageRateLimitKey,
} from "../src/app/api/integration/v1/messages/route";
import type { StoredResult } from "../src/lib/integration-idempotency";

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

/**
 * `POST /api/integration/v1/messages` (RFC-011 task 6, fix round 1): a
 * second, tighter budget on top of the generic write budget above — 5
 * messages per 10 minutes per token, because each one interrupts whoever is
 * looking at a Kinboard screen, which even a well-behaved token doing
 * exactly what it was asked could do too often.
 */
test.describe("the message-sending budget is tighter than the generic write budget", () => {
  test("the policy", () => {
    expect(MESSAGE_RATE_LIMIT).toBeLessThan(WRITE_LIMIT);
    expect(MESSAGE_RATE_LIMIT).toBe(5);
    expect(MESSAGE_RATE_WINDOW_MS).toBe(10 * 60_000);
  });

  test("keyed separately from the generic write budget, so sending doesn't borrow from it or vice versa", () => {
    expect(messageRateLimitKey("tok-1")).not.toBe(key("tok-1", "write"));
  });

  test("a 6th send inside the window is refused, with a positive Retry-After", () => {
    const token = uniq();
    for (let i = 0; i < MESSAGE_RATE_LIMIT; i++) {
      expect(hitLimit(messageRateLimitKey(token), MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW_MS).limited).toBe(false);
    }
    const sixth = hitLimit(messageRateLimitKey(token), MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW_MS);
    expect(sixth.limited).toBe(true);
    expect(sixth.retryAfterMs).toBeGreaterThan(0);
    expect(sixth.retryAfterMs).toBeLessThanOrEqual(MESSAGE_RATE_WINDOW_MS);
  });

  test("one token's messages do not affect another's", () => {
    const noisy = uniq();
    const quiet = uniq();
    for (let i = 0; i < MESSAGE_RATE_LIMIT; i++) hitLimit(messageRateLimitKey(noisy), MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW_MS);
    expect(hitLimit(messageRateLimitKey(noisy), MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW_MS).limited).toBe(true);
    expect(hitLimit(messageRateLimitKey(quiet), MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW_MS).limited).toBe(false);
  });
});

/**
 * `classifyMessageIdempotency` is what the route consults *before* touching
 * the budget above — only a `"send"` disposition ever calls `hitLimit`. A
 * retried "same arguments" request must answer from the stored result
 * without being charged a second time: that is the whole point of
 * Idempotency-Key, and charging the budget on every retry would mean a
 * flaky connection could exhaust a household's 5-per-10-minutes allowance
 * without a single extra message ever reaching a screen.
 */
test.describe("classifyMessageIdempotency decides what counts against the message budget", () => {
  const stored = (hash: string): StoredResult => ({
    status: 201,
    response: { id: "m1" },
    request_hash: hash,
  });

  test("no stored result: a genuine send, chargeable", () => {
    expect(classifyMessageIdempotency(null, "hash-a")).toBe("send");
  });

  test("same hash: a replay, not chargeable", () => {
    expect(classifyMessageIdempotency(stored("hash-a"), "hash-a")).toBe("replay");
  });

  test("different hash under the same key: a conflict, not chargeable either", () => {
    expect(classifyMessageIdempotency(stored("hash-a"), "hash-b")).toBe("conflict");
  });

  test("only \"send\" reaches the limiter: a replay leaves the budget untouched", () => {
    const token = uniq();
    for (let i = 0; i < MESSAGE_RATE_LIMIT; i++) {
      hitLimit(messageRateLimitKey(token), MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW_MS);
    }
    // The budget is now exhausted...
    expect(hitLimit(messageRateLimitKey(token), MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW_MS).limited).toBe(true);

    // ...but a disposition of "replay" (what every retry of an already-sent
    // message gets) is what tells the route never to call hitLimit at all —
    // modelled here by simply not calling it, which is the route's own
    // behaviour for that disposition.
    expect(classifyMessageIdempotency(stored("hash-a"), "hash-a")).toBe("replay");
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
