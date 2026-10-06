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
import { REWARD_COST_MAX, REWARD_COST_MIN, REWARD_ICON_MAX, REWARD_TITLE_MAX } from "./points";

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
    if (body.icon === null || body.icon === "") fields.icon = null;
    else if (typeof body.icon === "string" && body.icon.trim().length > 0 && body.icon.trim().length <= REWARD_ICON_MAX) {
      fields.icon = body.icon.trim();
    } else {
      return { ok: false, error: `icon must be at most ${REWARD_ICON_MAX} characters` };
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

/** A child asks for a reward: request_person_point_redemption, as an HTTP answer. */
export async function requestRedemption(
  client: RpcClient,
  input: { familyId: string; personId: string; rewardId: string; deviceId: string | null },
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
  if (answer?.ok === true) return { status: 201, body: { redemption: answer.redemption } };
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
  if (answer?.ok === true) return { status: 200, body: { ok: true, status: answer.status, balance: answer.balance ?? null } };
  switch (answer?.error) {
    case "not_found": return { status: 404, body: { error: "not found" } };
    case "already_decided": return { status: 409, body: { error: "already_decided" } };
    case "insufficient_points": return { status: 409, body: { error: "insufficient_points", balance: answer.balance } };
    default: return { status: 500, body: { error: "unexpected answer from decide_point_redemption" } };
  }
}
