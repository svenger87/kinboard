import { test, expect } from "@playwright/test";
import {
  applyDailyAccrual,
  accrueDailyInterestMicros,
  MICROS_PER_CENT,
} from "../src/lib/pocket-money/interest";

/**
 * Interest used to floor the daily amount to whole cents and discard the
 * fraction. At the default 10% APR the daily figure only reaches one cent
 * at a balance of €36.50, so every realistic child's balance earned
 * nothing at all — permanently — while the settings screen advertised
 * "10.0%".
 *
 * These simulate a year of daily accrual, which is the only way to show
 * the difference: a single day still rounds to zero, and that was exactly
 * why the bug was invisible.
 */

const APR = 1000; // 10%, the default
const NO_CAP = Number.MAX_SAFE_INTEGER;

/** Run `days` of accrual and return the whole cents credited. */
function accrueOver(days: number, balanceCents: number, aprBps = APR): number {
  let carry = 0;
  let cents = 0;
  for (let d = 0; d < days; d++) {
    const r = applyDailyAccrual({
      balanceCents,
      maxBalanceEligibleCents: NO_CAP,
      aprBps,
      carryMicros: carry,
    });
    cents += r.addCents;
    carry = r.carryMicros;
  }
  return cents;
}

test.describe("small balances now earn interest", () => {
  test("a €5 balance earns its first cent instead of never", () => {
    // 5.00 × 10% / 365 = 0.137 cents a day. Flooring gave 0, every day,
    // forever. Carried, it crosses one cent in about eight days.
    expect(accrueOver(7, 500)).toBe(0);
    expect(accrueOver(8, 500)).toBe(1);
    // €0.49 rather than an exact €0.50: the micro figure is itself
    // floored each day, which loses about 0.3 millionths of a cent a day.
    // That is a 2% shortfall against the ideal, where the old behaviour
    // was a 100% one, and it keeps the guarantee that the account is
    // never credited interest that hasn't accrued.
    expect(accrueOver(365, 500)).toBe(49);
  });

  test("balances below the old €36.50 cliff all accrue", () => {
    for (const balance of [100, 500, 1000, 2000, 3000, 3649]) {
      const year = accrueOver(365, balance);
      expect(year, `${balance} cents`).toBeGreaterThan(0);
    }
  });
});

test.describe("the rounding loss on larger balances is gone", () => {
  test("€100 earns about €10 a year, not €7.30", () => {
    // Old behaviour: floor(2.74) = 2 cents/day × 365 = 730 cents.
    const year = accrueOver(365, 10_000);
    expect(year).toBeGreaterThanOrEqual(999);
    expect(year).toBeLessThanOrEqual(1000);
  });

  test("€50 earns about €5 a year, not €3.65", () => {
    const year = accrueOver(365, 5_000);
    expect(year).toBeGreaterThanOrEqual(499);
    expect(year).toBeLessThanOrEqual(500);
  });
});

test.describe("the carry itself", () => {
  test("never credits more than has accrued", () => {
    // Whatever is handed back as carry must be a genuine fraction of a
    // cent — a carry at or above one cent means a cent was withheld.
    let carry = 0;
    for (let d = 0; d < 400; d++) {
      const r = applyDailyAccrual({
        balanceCents: 1234,
        maxBalanceEligibleCents: NO_CAP,
        aprBps: APR,
        carryMicros: carry,
      });
      carry = r.carryMicros;
      expect(carry).toBeGreaterThanOrEqual(0);
      expect(carry).toBeLessThan(MICROS_PER_CENT);
    }
  });

  test("zero balance and zero APR accrue nothing", () => {
    expect(accrueDailyInterestMicros({ balanceCents: 0, maxBalanceEligibleCents: NO_CAP, aprBps: APR })).toBe(0);
    expect(accrueDailyInterestMicros({ balanceCents: 5000, maxBalanceEligibleCents: NO_CAP, aprBps: 0 })).toBe(0);
    expect(accrueOver(365, 0)).toBe(0);
  });

  test("a negative balance accrues nothing rather than debiting", () => {
    expect(accrueDailyInterestMicros({ balanceCents: -500, maxBalanceEligibleCents: NO_CAP, aprBps: APR })).toBe(0);
  });

  test("the eligibility cap still applies", () => {
    // Above the cap, accrual is computed on the cap, so two very
    // different balances earn the same.
    const capped = applyDailyAccrual({
      balanceCents: 1_000_000,
      maxBalanceEligibleCents: 10_000,
      aprBps: APR,
      carryMicros: 0,
    });
    const atCap = applyDailyAccrual({
      balanceCents: 10_000,
      maxBalanceEligibleCents: 10_000,
      aprBps: APR,
      carryMicros: 0,
    });
    expect(capped).toEqual(atCap);
  });
});
