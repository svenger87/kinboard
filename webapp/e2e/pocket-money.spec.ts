import { test, expect } from "@playwright/test";
import { nextAllowanceDate, daysUntil } from "../src/lib/pocket-money/allowance";
import {
  tierFromBalance,
  nextTierThreshold,
  effectiveBestTier,
} from "../src/lib/pocket-money/interest";

/**
 * Pure-logic regression tests for the pocket-money model.
 *
 * No browser, no stack — Playwright is just the runner. Two behaviours
 * are pinned here because both were user-reported problems:
 *
 *   - the avatar stage must fall when money is spent (it used to track
 *     lifetime earnings and never moved), while the best-ever badge
 *     must not fall with it;
 *   - the next-allowance prediction must agree with the cron, which is
 *     what makes a quiet fortnight legible instead of looking broken.
 */

const iso = (y: number, m: number, d: number, h = 0) =>
  new Date(Date.UTC(y, m - 1, d, h)).toISOString();

test.describe("avatar stage tracks the current balance", () => {
  test("stage rises with the balance", () => {
    expect(tierFromBalance(0)).toBe(1);
    expect(tierFromBalance(199)).toBe(1);
    expect(tierFromBalance(200)).toBe(2);
    expect(tierFromBalance(500)).toBe(3);
    expect(tierFromBalance(1_000)).toBe(4);
    expect(tierFromBalance(2_500)).toBe(5);
    expect(tierFromBalance(5_000)).toBe(6);
    expect(tierFromBalance(10_000)).toBe(7);
    expect(tierFromBalance(20_000)).toBe(8);
    expect(tierFromBalance(999_999)).toBe(8);
  });

  test("stage falls again when money is spent", () => {
    // The reported bug: this used to stay put, because the stage was
    // derived from lifetime earnings.
    const afterSaving = tierFromBalance(5_000);
    const afterSpending = tierFromBalance(1_200);
    expect(afterSaving).toBe(6);
    expect(afterSpending).toBe(4);
    expect(afterSpending).toBeLessThan(afterSaving);
  });

  test("the best-ever badge survives spending", () => {
    const peak = tierFromBalance(5_000); // 6
    expect(effectiveBestTier(1_200, peak)).toBe(6);
    expect(effectiveBestTier(0, peak)).toBe(6);
  });

  test("a new high water mark overtakes a stale stored value", () => {
    // Right after a deposit the client hasn't persisted best_tier yet.
    expect(effectiveBestTier(20_000, 3)).toBe(8);
  });

  test("next threshold points at the next stage, null at the top", () => {
    expect(nextTierThreshold(0)).toBe(200);
    expect(nextTierThreshold(1_455)).toBe(2_500);
    expect(nextTierThreshold(20_000)).toBeNull();
  });
});

test.describe("next allowance prediction", () => {
  // Real values from a live account: €5 every 14 days, Fridays
  // (getUTCDay 5), last paid Friday 24 July 2026. This is the account
  // whose "missing" allowance turned out to be simply not due yet.
  const LIVE = {
    lastAllowanceAt: "2026-07-24T00:00:00.183Z",
    intervalDays: 14,
    dayOfWeek: 5,
  };

  test("predicts the real account's next payment", () => {
    const next = nextAllowanceDate({ ...LIVE, now: new Date(iso(2026, 8, 3)) });
    // 24 Jul + 14 days = 7 Aug, which is a Friday.
    expect(next?.toISOString().slice(0, 10)).toBe("2026-08-07");
  });

  test("a fortnight in, the payment is still 4 days out", () => {
    const now = new Date(iso(2026, 8, 3));
    const next = nextAllowanceDate({ ...LIVE, now })!;
    expect(daysUntil(next, now)).toBe(4);
  });

  test("does not pay on the intervening Friday", () => {
    // 31 July is a Friday but only 7 days after the last payment, so
    // the cron skips it. The prediction must skip it too, or a
    // fortnightly allowance would look weekly.
    const now = new Date(iso(2026, 7, 31));
    const next = nextAllowanceDate({ ...LIVE, now })!;
    expect(next.toISOString().slice(0, 10)).toBe("2026-08-07");
  });

  test("weekly lands on the following configured weekday", () => {
    const next = nextAllowanceDate({
      lastAllowanceAt: "2026-07-24T00:00:00Z",
      intervalDays: 7,
      dayOfWeek: 5,
      now: new Date(iso(2026, 7, 27)),
    })!;
    expect(next.toISOString().slice(0, 10)).toBe("2026-07-31");
  });

  test("an interval that isn't a multiple of 7 waits for the weekday", () => {
    // 10 days after Friday 24 Jul is Monday 3 Aug, but the cron only
    // pays on Fridays — so the real date is Friday 7 Aug.
    const next = nextAllowanceDate({
      lastAllowanceAt: "2026-07-24T00:00:00Z",
      intervalDays: 10,
      dayOfWeek: 5,
      now: new Date(iso(2026, 8, 1)),
    })!;
    expect(next.toISOString().slice(0, 10)).toBe("2026-08-07");
    expect(next.getUTCDay()).toBe(5);
  });

  test("a never-paid account gets the next matching weekday", () => {
    const next = nextAllowanceDate({
      lastAllowanceAt: null,
      intervalDays: 14,
      dayOfWeek: 5,
      now: new Date(iso(2026, 8, 3)), // Monday
    })!;
    expect(next.toISOString().slice(0, 10)).toBe("2026-08-07");
  });

  test("an overdue allowance is due now, not in the past", () => {
    // Cron was down for a month. The answer must never be historical.
    const now = new Date(iso(2026, 9, 4)); // a Friday
    const next = nextAllowanceDate({ ...LIVE, now })!;
    expect(next.getTime()).toBeGreaterThanOrEqual(
      new Date(iso(2026, 9, 4)).getTime(),
    );
    expect(daysUntil(next, now)).toBe(0);
  });

  test("payment day itself reads as 0 days", () => {
    const now = new Date(iso(2026, 8, 7, 9));
    const next = nextAllowanceDate({ ...LIVE, now })!;
    expect(daysUntil(next, now)).toBe(0);
  });

  test("an invalid weekday yields no prediction rather than a wrong one", () => {
    expect(
      nextAllowanceDate({ ...LIVE, dayOfWeek: 9, now: new Date(iso(2026, 8, 3)) }),
    ).toBeNull();
  });
});
