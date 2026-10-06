/**
 * Rewards bought with task points (discussion #349; core since RFC-017, so
 * per child and with no pocket-money account needed): the catalogue's input
 * rules, and the two database calls -- a child's request and a parent's
 * decision -- turned into HTTP answers. The rules themselves are in
 * docker/migration_zzzzzzzz_pocket_money_creatures_out.sql; the client comes
 * in as a parameter so a spec can hand it the real admin client or a fake.
 */

import { UUID } from "@/lib/home/action-requests";
import type { RpcClient } from "./booking";
import { REWARD_COST_MAX, REWARD_COST_MIN, REWARD_TITLE_MAX } from "./points";
import { canonicalEmoji } from "@/lib/emoji/validate";

export interface RewardInput {
  title?: unknown;
  cost_points?: unknown;
  icon?: unknown;
  active?: unknown;
}

export interface RewardFields {
  title?: string;
  cost_points?: number;
  icon?: string | null;
  active?: boolean;
}

/**
 * A reward's fields, checked. `partial` for an edit: only what is present is
 * checked and returned. Returns the fields or the reason they were refused.
 */
export function parseReward(
  body: RewardInput, partial: boolean,
  /** An edit: the reward's icon as stored, accepted back unchanged whatever it is. */
  keep: { storedIcon?: string | null } = {},
): { ok: true; fields: RewardFields } | { ok: false; error: string } {
  const fields: RewardFields = {};
  if (body.title !== undefined || !partial) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 1 || title.length > REWARD_TITLE_MAX) {
      return { ok: false, error: `title must be 1-${REWARD_TITLE_MAX} characters` };
    }
    fields.title = title;
  }
  if (body.cost_points !== undefined || !partial) {
    const cost = body.cost_points;
    if (typeof cost !== "number" || !Number.isInteger(cost) || cost < REWARD_COST_MIN || cost > REWARD_COST_MAX) {
      return { ok: false, error: `cost_points must be a whole number from ${REWARD_COST_MIN} to ${REWARD_COST_MAX}` };
    }
    fields.cost_points = cost;
  }
  if (body.icon !== undefined) {
    // One emoji from the picker's set (lib/emoji/validate.ts). The icon used
    // to be a free text field, so a reward may hold an icon that is not one:
    // sent back unchanged with an edit, it is kept, never refused.
    const icon = typeof body.icon === "string" ? body.icon.trim() : body.icon;
    if (icon === null || icon === "") fields.icon = null;
    else if (typeof icon === "string" && canonicalEmoji(icon)) fields.icon = canonicalEmoji(icon);
    else if (typeof icon === "string" && keep.storedIcon != null && icon === keep.storedIcon) {
      fields.icon = icon;
    } else {
      return { ok: false, error: "icon must be a single emoji (flags excepted)" };
    }
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return { ok: false, error: "active must be true or false" };
    fields.active = body.active;
  }
  if (partial && Object.keys(fields).length === 0) return { ok: false, error: "no updatable fields provided" };
  return { ok: true, fields };
}

type Answer = { status: number; body: Record<string, unknown> };

/** A redemption as request_person_point_redemption returns it (to_jsonb of the row). */
export interface RedemptionRow {
  id: string;
  family_id: string;
  person_id: string;
  reward_id: string | null;
  title: string;
  icon: string | null;
  cost_points: number;
  created_at: string;
}

/**
 * Who hears about a request and a decision: the parents' phones when a child
 * asks, the child's own device when a parent answers
 * (lib/notifications/rewards.ts queues both). Required, not optional, on both
 * calls below, so no caller -- the child's screen, the Integration API, an
 * assistant -- can ask or decide without it. Must not throw; a push that
 * cannot be queued never undoes the request.
 */
export interface RewardNotifier {
  requested: (redemption: RedemptionRow, sourceDeviceId: string | null) => Promise<void>;
  decided: (familyId: string, redemptionId: string, status: "approved" | "denied") => Promise<void>;
}

/** For a caller that must not notify anyone: a spec, or a backfill. */
export const silentRewardNotifier: RewardNotifier = {
  requested: async () => {},
  decided: async () => {},
};

/** A child asks for a reward: request_person_point_redemption, as an HTTP answer. */
export async function requestRedemption(
  client: RpcClient,
  input: { familyId: string; personId: string; rewardId: string; deviceId: string | null },
  notifier: RewardNotifier,
): Promise<Answer> {
  if (!UUID.test(input.personId)) return { status: 404, body: { error: "not found" } };
  if (!UUID.test(input.rewardId)) return { status: 404, body: { error: "no_reward" } };
  const { data, error } = await client.rpc("request_person_point_redemption", {
    p_family_id: input.familyId,
    p_person_id: input.personId,
    p_reward_id: input.rewardId,
    p_device_id: input.deviceId,
  });
  if (error) return { status: 500, body: { error: error.message } };
  const answer = data as { ok?: unknown; error?: unknown; redemption?: unknown; balance?: unknown; pending?: unknown } | null;
  if (answer?.ok === true) {
    await notifier.requested(answer.redemption as RedemptionRow, input.deviceId).catch((err) => {
      console.error("[rewards] could not queue the request's push:", err);
    });
    return { status: 201, body: { redemption: answer.redemption } };
  }
  switch (answer?.error) {
    case "not_found": return { status: 404, body: { error: "not found" } };
    case "no_reward": return { status: 404, body: { error: "no_reward" } };
    case "no_creature": return { status: 409, body: { error: "no_creature" } };
    case "insufficient_points":
      return { status: 409, body: { error: "insufficient_points", balance: answer.balance, pending: answer.pending } };
    default: return { status: 500, body: { error: "unexpected answer from request_person_point_redemption" } };
  }
}

/** A parent decides: decide_point_redemption, as an HTTP answer. */
export async function decideRedemption(
  client: RpcClient,
  input: { familyId: string; redemptionId: string; decision: "approved" | "denied"; deviceId: string | null },
  notifier: RewardNotifier,
): Promise<Answer> {
  if (!UUID.test(input.redemptionId)) return { status: 404, body: { error: "not found" } };
  const { data, error } = await client.rpc("decide_point_redemption", {
    p_family_id: input.familyId,
    p_redemption_id: input.redemptionId,
    p_decision: input.decision,
    p_device_id: input.deviceId,
  });
  if (error) return { status: 500, body: { error: error.message } };
  const answer = data as { ok?: unknown; error?: unknown; status?: unknown; balance?: unknown } | null;
  if (answer?.ok === true) {
    if (answer.status === "approved" || answer.status === "denied") {
      await notifier.decided(input.familyId, input.redemptionId, answer.status).catch((err) => {
        console.error("[rewards] could not queue the decision's push:", err);
      });
    }
    return { status: 200, body: { ok: true, status: answer.status, balance: answer.balance ?? null } };
  }
  switch (answer?.error) {
    case "not_found": return { status: 404, body: { error: "not found" } };
    case "already_decided": return { status: 409, body: { error: "already_decided" } };
    case "insufficient_points": return { status: 409, body: { error: "insufficient_points", balance: answer.balance } };
    default: return { status: 500, body: { error: "unexpected answer from decide_point_redemption" } };
  }
}
