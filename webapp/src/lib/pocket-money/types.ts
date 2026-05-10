export type AvatarSpecies = "dragon" | "cat" | "astronaut";

/** Stage 1 (start) → Stage 5 (max). Computed from lifetime_saved_cents. */
export type AvatarTier = 1 | 2 | 3 | 4 | 5;

export type TransactionType =
  | "allowance"
  | "manual_deposit"
  | "interest"
  | "withdrawal"
  | "adjustment";

export type GoalStatus = "active" | "ready_to_buy" | "bought" | "abandoned";

export type WithdrawalStatus = "pending" | "approved" | "denied";

/** Lifetime-saved thresholds (in cents) that promote the avatar to the next tier. */
export const TIER_THRESHOLDS_CENTS: ReadonlyArray<number> = [
  0,        // tier 1
  500,      // tier 2: €5
  2_500,    // tier 3: €25
  10_000,   // tier 4: €100
  50_000,   // tier 5: €500
];
