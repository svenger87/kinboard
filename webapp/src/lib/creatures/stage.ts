/**
 * The stage a child's creature shows (RFC-017), from where its data now
 * lives: the creature row says what it grows with and holds best_tier; the
 * pocket-money account, when there is one, holds the money.
 *
 *   grows_with 'points'  the task points the child has earned, all time
 *   grows_with 'money'   the account's balance, with best_tier as before --
 *                        but only while there is an account to read it from.
 *                        Without one (deleted since) the creature grows with
 *                        points, rather than freezing on an empty balance.
 *
 * The arithmetic is avatarStage() in lib/pocket-money/points.ts, unchanged:
 * a family's creatures look and grow exactly as they did on the account.
 */

import { avatarStage, type AvatarStage } from "@/lib/pocket-money/points";
import type { GrowsWith } from "./rules";

export interface CreatureLike {
  grows_with: GrowsWith | string;
  best_tier: number | null | undefined;
}

export interface AccountLike {
  balance_cents: number;
}

/** What the creature actually grows with now: money needs an account. */
export function effectiveGrowsWith(creature: CreatureLike, account: AccountLike | null | undefined): GrowsWith {
  return creature.grows_with === "money" && account ? "money" : "points";
}

export function creatureStage(args: {
  creature: CreatureLike;
  account: AccountLike | null | undefined;
  earnedPoints: number;
}): AvatarStage {
  const mode = effectiveGrowsWith(args.creature, args.account);
  return avatarStage({
    mode,
    balanceCents: args.account?.balance_cents ?? 0,
    earnedPoints: args.earnedPoints,
    storedBestTier: args.creature.best_tier,
  });
}
