import { TIER_THRESHOLDS_CENTS, type AvatarTier } from "./types";

/**
 * Daily interest accrual.
 *
 * Math: balance_eligible × (apr_bps / 10000) / 365
 * Where balance_eligible = min(balance_cents, max_balance_eligible_cents)
 *
 * APR is in basis points (1000 = 10%). Returns the cents to add to
 * pending_interest_cents. Always non-negative; rounds DOWN (banker's
 * floor) so the platform never overpays.
 */
export function accrueDailyInterest(args: {
  balanceCents: number;
  maxBalanceEligibleCents: number;
  aprBps: number;
}): number {
  const { balanceCents, maxBalanceEligibleCents, aprBps } = args;
  if (balanceCents <= 0 || aprBps <= 0) return 0;
  const eligible = Math.min(balanceCents, maxBalanceEligibleCents);
  const accrued = (eligible * aprBps) / (10_000 * 365);
  return Math.floor(accrued);
}

/**
 * Returns the avatar tier (1..5) for a given lifetime-saved amount.
 * Withdrawals don't reduce lifetime_saved_cents, so this is monotonic
 * over time.
 */
export function tierFromLifetimeSaved(lifetimeSavedCents: number): AvatarTier {
  let tier: AvatarTier = 1;
  for (let i = 0; i < TIER_THRESHOLDS_CENTS.length; i++) {
    if (lifetimeSavedCents >= TIER_THRESHOLDS_CENTS[i]) {
      tier = (i + 1) as AvatarTier;
    }
  }
  return tier;
}

/**
 * Returns the next-tier threshold in cents, or null when the avatar is
 * already at the top tier. Used to show "next stage at €X" hints in
 * the kid view so a kid (and parent) can see what to save toward.
 */
export function nextTierThreshold(lifetimeSavedCents: number): number | null {
  for (let i = 0; i < TIER_THRESHOLDS_CENTS.length; i++) {
    if (lifetimeSavedCents < TIER_THRESHOLDS_CENTS[i]) {
      return TIER_THRESHOLDS_CENTS[i];
    }
  }
  return null;
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
