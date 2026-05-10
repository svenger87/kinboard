/**
 * Avatar species id — anything that exists in the catalog
 * (`webapp/src/plugins/pocket-money/catalog/avatars.json`).
 *
 * Kept as `string` so adding a species is a one-step config change
 * (drop SVGs + add catalog entry + i18n keys). API routes validate
 * against the catalog at runtime; the DB no longer enforces a CHECK.
 */
export type AvatarSpecies = string;

/** Stage 1 (start) → Stage 8 (max). Computed from lifetime_saved_cents. */
export type AvatarTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type TransactionType =
  | "allowance"
  | "manual_deposit"
  | "interest"
  | "withdrawal"
  | "adjustment";

export type GoalStatus = "active" | "ready_to_buy" | "bought" | "abandoned";

export type WithdrawalStatus = "pending" | "approved" | "denied";

/**
 * Lifetime-saved thresholds (in cents) that promote the avatar to the
 * next tier. Tuned for a kid getting €2.50–€5/week of allowance — the
 * first 3-4 stages should hit within a couple of months so kids see
 * frequent wins; the top stages take longer and feel earned.
 */
export const TIER_THRESHOLDS_CENTS: ReadonlyArray<number> = [
  0,         // tier 1: starting
  200,       // tier 2: €2
  500,       // tier 3: €5
  1_500,     // tier 4: €15
  4_000,     // tier 5: €40
  10_000,    // tier 6: €100
  30_000,    // tier 7: €300
  100_000,   // tier 8: €1000
];
