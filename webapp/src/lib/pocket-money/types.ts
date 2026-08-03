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
 * would have been dead. The top is now an ambitious-but-real savings
 * target instead.
 *
 * The early steps are deliberately tiny. A child who saves up and then
 * buys the thing lands on an empty account, and under the first pass at
 * these numbers that meant sitting at stage 1 until they had saved €2
 * again — the longest, flattest stretch of the whole progression landing
 * exactly when they had just done the right thing. Now only a genuinely
 * empty account is stage 1, fifty cents moves off it, and a single €5
 * allowance reaches stage 4. Climbing back is quick; the distance is at
 * the top, where it belongs.
 *
 * Kept in sync with the backfill CASE in
 * webapp/docker/migration_pocket_money_best_tier.sql.
 */
export const TIER_THRESHOLDS_CENTS: ReadonlyArray<number> = [
  0,        // stage 1: empty account
  50,       // stage 2: €0.50
  150,      // stage 3: €1.50
  400,      // stage 4: €4
  1_000,    // stage 5: €10
  3_000,    // stage 6: €30
  8_000,    // stage 7: €80
  20_000,   // stage 8: €200
];
