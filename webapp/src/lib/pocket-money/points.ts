/**
 * Points mode (discussion #349): the creature grows with task points, and
 * points buy rewards from the family's catalogue. Per child since RFC-017: a
 * child's points are theirs, with or without a pocket-money account. The
 * database is the authority -- point_person_totals() in
 * docker/migration_zzzzzzzzz_point_purchases.sql, and decide_point_redemption()
 * in docker/migration_zzzzzzzz_pocket_money_creatures_out.sql -- and this file
 * is its mirror for the screens.
 */

import {
  TIER_THRESHOLDS_CENTS,
  TIER_THRESHOLDS_POINTS,
  type AvatarTier,
  type RewardMode,
} from "./types";
import { effectiveBestTier, nextTierThreshold, tierFromBalance } from "./interest";

export interface RedemptionLike {
  cost_points: number;
  status: "pending" | "approved" | "denied";
}

/** A shop purchase (point_purchases): what it cost. */
export interface PurchaseLike {
  cost: number;
}

export interface PointTotals {
  /** Every point the child's tasks have awarded, all time. */
  earned: number;
  /** The cost of every approved redemption. */
  spent: number;
  /** The cost of everything bought in the shop (RFC-017 §5). */
  purchased: number;
  /** The cost of every redemption still waiting for a parent. */
  pending: number;
  /** earned - spent - purchased, never below zero. */
  balance: number;
  /**
   * spent + purchased - earned when a task was un-ticked after its points were spent:
   * paid back from the next points earned before any can be spent.
   */
  owed: number;
  /** What a new request may still use: the balance less what is waiting. */
  available: number;
}

/**
 * A child's points. The balance is earned minus approved redemptions minus
 * shop purchases, and never goes below zero -- it could only try to after a
 * task was un-ticked whose points were already spent. Pending requests are
 * held: `available` is what a new request or a purchase may still use.
 */
export function pointTotals(
  earned: number,
  redemptions: readonly RedemptionLike[],
  purchases: readonly PurchaseLike[] = [],
): PointTotals {
  let spent = 0;
  let pending = 0;
  for (const r of redemptions) {
    if (r.status === "approved") spent += r.cost_points;
    else if (r.status === "pending") pending += r.cost_points;
  }
  const purchased = purchases.reduce((sum, p) => sum + p.cost, 0);
  const balance = Math.max(0, earned - spent - purchased);
  return {
    earned,
    spent,
    purchased,
    pending,
    balance,
    owed: Math.max(0, spent + purchased - earned),
    available: Math.max(0, balance - pending),
  };
}

/** The stage a number of earned points reaches. */
export function tierFromPoints(earnedPoints: number): AvatarTier {
  let tier: AvatarTier = 1;
  for (let i = 0; i < TIER_THRESHOLDS_POINTS.length; i++) {
    if (earnedPoints >= TIER_THRESHOLDS_POINTS[i]) tier = (i + 1) as AvatarTier;
  }
  return tier;
}

export interface AvatarStage {
  mode: RewardMode;
  /** The stage the avatar shows. */
  tier: AvatarTier;
  /** The highest stage ever reached, at least `tier`. */
  best: AvatarTier;
  /** The next stage's threshold in the mode's unit (cents or points), or null at the top. */
  next: { tier: AvatarTier; at: number } | null;
  /** Each stage's threshold, in the mode's unit. */
  thresholds: ReadonlyArray<number>;
}

/**
 * What the avatar shows, in either mode.
 *
 * Money: the stage follows the balance, falls when money is spent, and
 * best_tier remembers the highest one (unchanged from before).
 *
 * Points: the stage follows the points EARNED, so a reward bought never
 * shrinks it, and a task un-ticked takes it back down -- and it never shows
 * less than best_tier, which only money mode writes (pointsStageWrites), so a
 * stage reached with money stays reached after the switch. A child who was at stage 5 with
 * money starts points mode at stage 5 and grows once their points pass stage
 * 6's threshold; going back to an egg for switching would be a punishment for
 * nothing.
 */
export function avatarStage(args: {
  mode: RewardMode | string | null | undefined;
  balanceCents: number;
  earnedPoints: number;
  storedBestTier: number | null | undefined;
}): AvatarStage {
  const stored = Math.min(8, Math.max(1, Math.floor(args.storedBestTier ?? 1))) as AvatarTier;
  if (args.mode === "points") {
    const tier = Math.max(tierFromPoints(args.earnedPoints), stored) as AvatarTier;
    const next = tier < 8 ? { tier: (tier + 1) as AvatarTier, at: TIER_THRESHOLDS_POINTS[tier] } : null;
    return { mode: "points", tier, best: tier, next, thresholds: TIER_THRESHOLDS_POINTS };
  }
  const tier = tierFromBalance(args.balanceCents);
  const nextCents = nextTierThreshold(args.balanceCents);
  return {
    mode: "money",
    tier,
    best: effectiveBestTier(args.balanceCents, stored),
    next: nextCents === null ? null : { tier: tierFromBalance(nextCents), at: nextCents },
    thresholds: TIER_THRESHOLDS_CENTS,
  };
}

/** How far a balance is toward a reward, 0..100. */
export function rewardProgress(balance: number, cost: number): number {
  if (cost <= 0) return 100;
  return Math.min(100, Math.floor((Math.max(0, balance) * 100) / cost));
}

export const REWARD_COST_MIN = 1;
export const REWARD_COST_MAX = 10_000;
export const REWARD_TITLE_MAX = 80;
/**
 * point_rewards.icon's database check, in code points. The icon is one emoji
 * now (lib/emoji/validate.ts); the longest the picker offers has 10, which
 * e2e/emoji-picker.spec.ts holds under this.
 */
export const REWARD_ICON_MAX = 16;

/**
 * What the pocket-money page records after showing a stage, and whether it
 * celebrates. last_seen_tier follows the shown stage both ways (so a stage
 * reached again is celebrated again); best_tier is written in money mode only.
 * In points mode the stage is the points' own, so writing it into best_tier
 * would freeze it: tick, hatch, un-tick, and the chick would stay. A switch to
 * points that only brings back a stage reached with money is not celebrated.
 */
export function pointsStageWrites(args: {
  stage: AvatarStage;
  lastSeenTier: number;
  storedBestTier: number | null | undefined;
}): { celebrate: boolean; update: { last_seen_tier?: number; best_tier?: number } } {
  const { stage, lastSeenTier } = args;
  const storedBest = args.storedBestTier ?? 1;
  const update: { last_seen_tier?: number; best_tier?: number } = {};
  let celebrate = false;
  if (stage.tier > lastSeenTier) {
    celebrate = !(stage.mode === "points" && stage.tier <= storedBest);
    update.last_seen_tier = stage.tier;
  } else if (stage.tier < lastSeenTier) {
    update.last_seen_tier = stage.tier;
  }
  if (stage.mode === "money" && stage.tier > storedBest) update.best_tier = stage.tier;
  return { celebrate, update };
}
