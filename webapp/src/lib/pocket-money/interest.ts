import { TIER_THRESHOLDS_CENTS, type AvatarTier } from "./types";

/** One cent, expressed in the carry unit. */
export const MICROS_PER_CENT = 1_000_000;

/**
 * Daily interest accrual.
 *
 * Math: balance_eligible × (apr_bps / 10000) / 365
 * Where balance_eligible = min(balance_cents, max_balance_eligible_cents)
 *
 * This used to floor the daily figure to whole cents and throw the
 * fraction away. At the default 10% APR the daily amount only reaches one
 * cent at a balance of €36.50, so every realistic child's balance earned
 * exactly nothing — permanently — while the settings screen advertised
 * "10.0%". It cost the bigger balances too: €100 earned €7.30 a year
 * rather than €10, because the rounding happened 365 times instead of
 * once.
 *
 * So the fraction is kept. Accrual is returned in millionths of a cent,
 * the caller adds it to the account's carry, and whole cents overflow
 * from there into pending_interest_cents. A €5 balance earns its first
 * cent after about eight days instead of never.
 *
 * Still rounds down, so the account is never credited a fraction that
 * hasn't actually accrued — the difference is that it is now carried
 * rather than discarded.
 */
export function accrueDailyInterestMicros(args: {
  balanceCents: number;
  maxBalanceEligibleCents: number;
  aprBps: number;
}): number {
  const { balanceCents, maxBalanceEligibleCents, aprBps } = args;
  if (balanceCents <= 0 || aprBps <= 0) return 0;
  const eligible = Math.min(balanceCents, maxBalanceEligibleCents);
  // Scale before dividing so the division keeps its precision.
  return Math.floor((eligible * aprBps * MICROS_PER_CENT) / (10_000 * 365));
}

/**
 * Fold a day's accrual into an account's carry.
 *
 * Returns the whole cents to add to `pending_interest_cents` and the
 * remaining sub-cent carry to store back.
 */
export function applyDailyAccrual(args: {
  balanceCents: number;
  maxBalanceEligibleCents: number;
  aprBps: number;
  carryMicros: number;
}): { addCents: number; carryMicros: number } {
  const total =
    (args.carryMicros ?? 0) +
    accrueDailyInterestMicros({
      balanceCents: args.balanceCents,
      maxBalanceEligibleCents: args.maxBalanceEligibleCents,
      aprBps: args.aprBps,
    });
  const addCents = Math.floor(total / MICROS_PER_CENT);
  return { addCents, carryMicros: total - addCents * MICROS_PER_CENT };
}

/**
 * Whole-cent daily accrual.
 *
 * Kept because the forecast card projects with it, where a per-day cent
 * figure is what's wanted. It is NOT what the cron uses — see
 * `applyDailyAccrual`, which carries the fraction.
 */
export function accrueDailyInterest(args: {
  balanceCents: number;
  maxBalanceEligibleCents: number;
  aprBps: number;
}): number {
  return Math.floor(accrueDailyInterestMicros(args) / MICROS_PER_CENT);
}

/**
 * The avatar stage for a given balance.
 *
 * Balance, not lifetime earnings: the stage is meant to answer "how is
 * this account doing right now", so it falls when money is spent and
 * climbs again as it's saved. The achievement isn't lost — the account's
 * `best_tier` high-water mark records the highest stage ever reached and
 * is displayed alongside.
 *
 * A negative balance shouldn't be possible (the transactions route
 * rejects overdrafts) but clamps to stage 1 rather than throwing if one
 * ever appears.
 */
export function tierFromBalance(balanceCents: number): AvatarTier {
  let tier: AvatarTier = 1;
  for (let i = 0; i < TIER_THRESHOLDS_CENTS.length; i++) {
    if (balanceCents >= TIER_THRESHOLDS_CENTS[i]) {
      tier = (i + 1) as AvatarTier;
    }
  }
  return tier;
}

/**
 * The balance at which the next stage unlocks, or null at the top
 * stage. Drives the "next stage at €X" hint, so a kid can see what
 * they're saving toward.
 */
export function nextTierThreshold(balanceCents: number): number | null {
  for (let i = 0; i < TIER_THRESHOLDS_CENTS.length; i++) {
    if (balanceCents < TIER_THRESHOLDS_CENTS[i]) {
      return TIER_THRESHOLDS_CENTS[i];
    }
  }
  return null;
}

/**
 * The stage to display as the high-water mark.
 *
 * Guards against a stored `best_tier` that is behind the current stage —
 * possible for a moment after a deposit, before the client has written
 * the new high-water mark back, and for any row the migration's backfill
 * didn't cover.
 */
export function effectiveBestTier(
  balanceCents: number,
  storedBestTier: number,
): AvatarTier {
  const current = tierFromBalance(balanceCents);
  return Math.max(current, storedBestTier) as AvatarTier;
}

/**
 * Day-by-day projection of balance under current APR + allowance,
 * mirroring the cron path: accrue daily, commit pending → balance
 * daily, drop a fresh allowance on each interval boundary. Used by
 * the settings page to telegraph "if you keep things as-is, here's
 * what the balance looks like in N days."
 *
 * Pure function, no dependencies on cron / DB. Returns balance at each
 * requested day-offset (sorted, deduped) so the caller renders the
 * milestones it cares about.
 */
export function projectBalance(args: {
  balanceCents: number;
  pendingInterestCents: number;
  maxBalanceEligibleCents: number;
  aprBps: number;
  weeklyAllowanceCents: number;
  allowanceIntervalDays: number;
  horizonDays: number;
  milestoneDays: ReadonlyArray<number>;
}): ReadonlyArray<{ day: number; balanceCents: number }> {
  const {
    balanceCents,
    pendingInterestCents,
    maxBalanceEligibleCents,
    aprBps,
    weeklyAllowanceCents,
    allowanceIntervalDays,
    horizonDays,
    milestoneDays,
  } = args;

  let balance = balanceCents;
  let pending = pendingInterestCents;

  const wantedDays = new Set(milestoneDays.filter((d) => d > 0 && d <= horizonDays));
  const snapshots: { day: number; balanceCents: number }[] = [];

  // Allowance interval guard: 0/negative would loop forever; clamp to ≥1.
  const interval = Math.max(1, allowanceIntervalDays);

  for (let day = 1; day <= horizonDays; day++) {
    pending += accrueDailyInterest({
      balanceCents: balance,
      maxBalanceEligibleCents,
      aprBps,
    });
    // Daily commit (mirrors the cron's once-per-day commit cadence).
    balance += pending;
    pending = 0;
    if (day % interval === 0 && weeklyAllowanceCents > 0) {
      balance += weeklyAllowanceCents;
    }
    if (wantedDays.has(day)) {
      snapshots.push({ day, balanceCents: balance + pending });
    }
  }

  return snapshots;
}
