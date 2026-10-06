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

import { avatarStage, tierFromPoints, type AvatarStage } from "@/lib/pocket-money/points";
import { tierFromBalance } from "@/lib/pocket-money/interest";
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

/**
 * The highest stages the child's own screen may record, from what the
 * creature grows with right now (review of #370: a kid-side write must not be
 * able to raise its own creature).
 *
 *   seen  last_seen_tier: the stage the screens show -- creatureStage() above,
 *         which in points mode never shows less than best_tier
 *   best  best_tier: the stage the growth source itself reaches -- the
 *         balance's money tier, or the lifetime points' tier. best_tier only
 *         records money stages on the screens (pointsStageWrites), but the
 *         same bound holds in points mode, so a write there cannot lift the
 *         floor avatarStage() puts under the points stage.
 */
export function justifiedTiers(args: {
  creature: CreatureLike;
  account: AccountLike | null | undefined;
  earnedPoints: number;
}): { seen: number; best: number } {
  const stage = creatureStage(args);
  const best = stage.mode === "money" ? tierFromBalance(args.account?.balance_cents ?? 0) : tierFromPoints(args.earnedPoints);
  return { seen: stage.tier, best };
}

/**
 * A kid-side stage write held to what the growth source justifies. Clamped,
 * not refused: the page writes what it has just drawn, from data that can be
 * a refetch behind the server (an un-tick on another screen, a balance moved
 * a second ago). Refusing would turn that ordinary race into an error on a
 * child's screen; clamping writes the true value, and best_tier's trigger
 * still never lowers what is stored.
 */
export function clampStageWrites<T extends { best_tier?: number; last_seen_tier?: number }>(
  patch: T,
  justified: { seen: number; best: number },
): T {
  const out = { ...patch };
  if (out.best_tier !== undefined) out.best_tier = Math.min(out.best_tier, justified.best);
  if (out.last_seen_tier !== undefined) out.last_seen_tier = Math.min(out.last_seen_tier, justified.seen);
  return out;
}
