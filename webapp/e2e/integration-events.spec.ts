import { test, expect } from "@playwright/test";
import {
  DEFAULT_EVENT_LIMIT,
  MAX_EVENT_LIMIT,
  parseAfter,
  parseLimit,
} from "../src/app/api/integration/v1/events/route";

/**
 * The cursor and limit parsing, tested as pure functions.
 *
 * These two are worth testing precisely because they look trivial. `after` is
 * caller-controlled and goes into a `>` comparison against a BIGSERIAL, and
 * `limit` decides how much of the retention window one request can pull. A
 * coercion bug in either is a way to ask the database for everything, or to
 * silently skip events — and silently skipping events is invisible, because
 * the consumer just never sees them.
 */

test.describe("after (the cursor)", () => {
  test("absent means 'from the beginning'", () => {
    expect(parseAfter(null)).toEqual({ ok: true, value: null });
    expect(parseAfter("")).toEqual({ ok: true, value: null });
  });

  test("accepts a plain integer, including zero", () => {
    expect(parseAfter("0")).toEqual({ ok: true, value: 0 });
    expect(parseAfter("4711")).toEqual({ ok: true, value: 4711 });
  });

  test("rejects rather than coerces", () => {
    // Number("12abc") is NaN, Number(" 12 ") is 12, Number("1e3") is 1000.
    // Each of those would be a different query than the caller asked for, so
    // none of them are accepted.
    for (const bad of ["-1", "1.5", "1e3", " 12 ", "12abc", "abc", "0x10", "+5", "NaN", "Infinity"]) {
      expect(parseAfter(bad), `should reject ${JSON.stringify(bad)}`).toEqual({ ok: false });
    }
  });

  test("rejects a value beyond safe integer range", () => {
    // Past 2^53 the comparison stops meaning what it says.
    expect(parseAfter("9007199254740993")).toEqual({ ok: false });
  });
});

test.describe("limit", () => {
  test("defaults when absent or unusable", () => {
    expect(parseLimit(null)).toBe(DEFAULT_EVENT_LIMIT);
    expect(parseLimit("")).toBe(DEFAULT_EVENT_LIMIT);
    expect(parseLimit("abc")).toBe(DEFAULT_EVENT_LIMIT);
    expect(parseLimit("-5")).toBe(DEFAULT_EVENT_LIMIT);
    expect(parseLimit("0")).toBe(DEFAULT_EVENT_LIMIT);
  });

  test("honours a smaller request", () => {
    expect(parseLimit("10")).toBe(10);
    expect(parseLimit("1")).toBe(1);
  });

  test("caps a larger one instead of obeying it", () => {
    // The cap is the whole point: without it one request can ask for the
    // entire retention window.
    expect(parseLimit("100000")).toBe(MAX_EVENT_LIMIT);
    expect(parseLimit(String(MAX_EVENT_LIMIT + 1))).toBe(MAX_EVENT_LIMIT);
    expect(parseLimit(String(MAX_EVENT_LIMIT))).toBe(MAX_EVENT_LIMIT);
  });

  test("the cap is a real bound, not a formality", () => {
    expect(MAX_EVENT_LIMIT).toBeGreaterThan(DEFAULT_EVENT_LIMIT - 1);
    expect(MAX_EVENT_LIMIT).toBeLessThanOrEqual(1000);
  });
});
