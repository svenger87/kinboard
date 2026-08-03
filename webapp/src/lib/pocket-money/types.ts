/**
 * Avatar species id — anything that exists in the catalog
 * (`webapp/src/plugins/pocket-money/catalog/avatars.json`).
 *
 * Kept as `string` so adding a species is a one-step config change
 * (drop SVGs + add catalog entry + i18n keys). API routes validate
 * against the catalog at runtime; the DB no longer enforces a CHECK.
 */
export type AvatarSpecies = string;

/** Stage 1 (start) → Stage 8 (max). Computed from the current balance. */
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
 * Balance thresholds (in cents) that promote the avatar to the next
 * stage. The stage reflects what is in the account *now*, so spending
 * moves it down and saving moves it back up — see
 * `migration_pocket_money_best_tier.sql` for why that replaced the old
 * lifetime-earnings model, and `best_tier` for how the achievement is
 * preserved when a kid spends.
 *
 * Retuned for balances rather than lifetime totals. The old top stage
 * was €1000 of lifetime earnings, which as a *balance* no child on
 * €2.50–€5 a week will ever hold — the top half of the progression
 * would have been dead. These are reachable: the first stages land
 * within a few weeks so progress is visible, and the top is an
 * ambitious-but-real savings target.
 *
 * Kept in sync with the backfill CASE in
 * webapp/docker/migration_pocket_money_best_tier.sql.
 */
export const TIER_THRESHOLDS_CENTS: ReadonlyArray<number> = [
  0,        // stage 1: starting out
  200,      // stage 2: €2
  500,      // stage 3: €5
  1_000,    // stage 4: €10
  2_500,    // stage 5: €25
  5_000,    // stage 6: €50
  10_000,   // stage 7: €100
  20_000,   // stage 8: €200
];
