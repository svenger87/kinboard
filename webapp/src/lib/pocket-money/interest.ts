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
