/**
 * An assistant asking for a parent's decision on a child's reward request:
 * "approve Mira's 30 minutes of tablet time".
 *
 * ASKING, NOT DECIDING. Nothing here decides a reward request, and nothing
 * here can: no file a token reaches names the database function that decides
 * one (e2e/integration-rewards.spec.ts walks them all and says so). `POST /rewards/requests/{id}/decision` checks the request and
 * stores it as a `reward_decision` confirmation request
 * (lib/home/action-requests.ts) — the same settings PIN, deny, two-minute
 * expiry, token re-check and per-assistant limits as a door unlock or a
 * pocket-money booking — and answers 202. Only a family member allowing it on
 * a Kinboard screen with the PIN decides the reward, on the server, through
 * the function the rewards page's own Approve and Deny use.
 *
 * What can be asked about: a reward request of the token's family that is
 * still pending, of a child not in the recycle bin. Another family's id is
 * the same 404 as one that does not exist. An approval the child's points do
 * not cover now is refused at once rather than after someone typed the PIN;
 * the decision checks again, atomically, when it runs.
 *
 * Takes its I/O as dependencies, so every refusal — and "nothing was stored
 * or pushed" — is tested against fakes (e2e/reward-decisions.spec.ts); the
 * live ones are below.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { familyHasPin } from "@/lib/settings-pin";
import { retryAfterSeconds, type Budget } from "@/lib/integration-limits";
import {
  UUID, createActionRequest, rewardDecisionFrom, type CreateKindRequestInput, type RewardDecision,
} from "@/lib/home/action-requests";
import { liveActionStore, liveConfirmationBudget, pushActionRequest } from "@/lib/home/action-requests-live";

const db = () => createAdminClient() as any;

/** A reward request as this file reads it. */
export interface RewardRequestNow {
  id: string;
  person_id: string;
  child_name: string;
  title: string;
  cost_points: number;
  status: string;
}

export interface RewardDecisionRequestDeps {
  /** One reward request of this family whose child is not in the recycle bin, or null. Throws when unreadable. */
  lookupRedemption: (familyId: string, redemptionId: string) => Promise<RewardRequestNow | null>;
  /** The child's spendable points (point_person_totals' balance). Throws when unreadable. */
  pointBalance: (familyId: string, personId: string) => Promise<number>;
  /** Whether a decision on this reward request is already waiting for a family member. Throws when unreadable. */
  decisionPending: (familyId: string, redemptionId: string) => Promise<boolean>;
  familyHasPin: (familyId: string) => Promise<boolean>;
  /** `liveConfirmationBudget`: spends the budget when it says yes; throws when unreadable. */
  confirmationBudget: (familyId: string, tokenId: string) => Promise<Budget>;
  createRequest: (input: CreateKindRequestInput) => Promise<{ id: string; expiresAt: string }>;
}

export interface RewardDecisionRequestInput {
  familyId: string;
  tokenId: string;
  clientName: string;
  /** The reward request's id, from the path. */
  redemptionId: string;
  body: unknown;
}

export interface RewardDecisionRequestResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): RewardDecisionRequestResult =>
  ({ status, body: { error, code, ...extra } });

/** The body: `{ decision: "approve" | "decline" }`, nothing else. */
export function parseRewardDecisionBody(body: unknown):
  | { ok: true; decision: "approve" | "decline" }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "A JSON object body is required" };
  const b = body as Record<string, unknown>;
  if (b.decision !== "approve" && b.decision !== "decline") return { ok: false, error: "decision must be approve or decline" };
  return { ok: true, decision: b.decision };
}

/**
 * Ask a family member to confirm a decision on a reward request. Nothing is
 * decided here: the answer is 202 `pending_confirmation` with the request to
 * follow at `GET /actions/{id}`, or a refusal, after which nothing was stored
 * or pushed.
 */
export async function requestRewardDecision(
  input: RewardDecisionRequestInput,
  deps: RewardDecisionRequestDeps,
): Promise<RewardDecisionRequestResult> {
  const parsed = parseRewardDecisionBody(input.body);
  if (!parsed.ok) return fail(400, "invalid_request", parsed.error);
  const notFound = () => fail(404, "not_found", "No such reward request in this family (get_rewards lists the ones waiting). Nothing was asked.");
  if (!UUID.test(input.redemptionId)) return notFound();

  const request = await deps.lookupRedemption(input.familyId, input.redemptionId);
  if (!request) return notFound();
  if (request.status !== "pending") {
    return fail(409, "conflict", `This reward request has already been ${request.status === "approved" ? "approved" : "declined"} in Kinboard. Nothing was asked.`, {
      reason: "already_decided", status: request.status === "approved" ? "approved" : "declined",
    });
  }

  // Said now rather than after a family member typed the PIN. The decision
  // checks again, under the child's lock, when it runs.
  if (parsed.decision === "approve") {
    const balance = await deps.pointBalance(input.familyId, request.person_id);
    if (balance < request.cost_points) {
      return fail(409, "conflict", "This child does not have enough points for that reward any more, so it cannot be approved. Nothing was asked.", {
        reason: "insufficient_points", balance, cost_points: request.cost_points,
      });
    }
  }

  const data: RewardDecision = {
    redemption_id: request.id,
    decision: parsed.decision,
    person_id: request.person_id,
    child_name: request.child_name,
    reward_title: request.title,
    cost_points: request.cost_points,
  };
  // Exactly what the handler accepts when it runs: a request it would refuse
  // after a family member typed the PIN is refused now instead.
  if (!rewardDecisionFrom({ ...data })) {
    return fail(400, "invalid_request", "This reward request cannot be shown for confirmation as it is (its title or the child's name is unusable). Nothing was asked.");
  }

  if (await deps.decisionPending(input.familyId, request.id)) {
    return fail(409, "conflict", "A decision on this reward request is already waiting for a family member on Kinboard. Wait for it, then check get_rewards. Nothing was asked.", {
      reason: "already_asked",
    });
  }

  let hasPin: boolean;
  try {
    hasPin = await deps.familyHasPin(input.familyId);
  } catch {
    return fail(503, "unavailable", "Kinboard could not check whether this decision can be confirmed, so nothing was asked");
  }
  if (!hasPin) {
    return fail(
      403,
      "forbidden",
      "A decision on a reward request needs a parent to confirm it on a Kinboard screen with the settings PIN, and this family has none. Set a settings PIN in Kinboard to allow this. Nothing was asked.",
      { reason: "pin_required" },
    );
  }

  let budget: Budget;
  try {
    budget = await deps.confirmationBudget(input.familyId, input.tokenId);
  } catch {
    return fail(503, "unavailable", "Kinboard could not check this assistant's pending requests, so nothing was asked");
  }
  if (!budget.ok) {
    return {
      ...fail(
        429,
        "rate_limited",
        "This assistant already has requests waiting for confirmation, or has asked too often. Wait for a family member to answer, then try again. Nothing was asked.",
      ),
      headers: { "retry-after": String(retryAfterSeconds(budget.retryAfterMs)) },
    };
  }

  const pending = await deps.createRequest({
    kind: "reward_decision",
    familyId: input.familyId,
    tokenId: input.tokenId,
    clientName: input.clientName,
    data: { ...data },
  });
  return {
    status: 202,
    body: {
      status: "pending_confirmation",
      request_id: pending.id,
      expires_at: pending.expiresAt,
      decision: parsed.decision,
      reward_request: {
        id: request.id, person_id: request.person_id, child_name: request.child_name,
        title: request.title, cost_points: request.cost_points,
      },
    },
  };
}

// ── live ─────────────────────────────────────────────────────────────────────

async function liveLookupRedemption(familyId: string, redemptionId: string): Promise<RewardRequestNow | null> {
  const { data, error } = await db()
    .from("point_redemptions")
    .select("id, person_id, title, cost_points, status, people!inner(name, deleted_at)")
    .eq("id", redemptionId)
    .eq("family_id", familyId)
    .is("people.deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`Failed to read the reward request: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id, person_id: data.person_id, child_name: data.people.name,
    title: data.title, cost_points: data.cost_points, status: data.status,
  };
}

async function livePointBalance(familyId: string, personId: string): Promise<number> {
  const { data, error } = await db().rpc("point_person_totals", { p_family_id: familyId, p_person_id: personId });
  if (error) throw new Error(`Failed to read points: ${error.message}`);
  return Number((data as { balance?: unknown } | null)?.balance ?? 0);
}

async function liveDecisionPending(familyId: string, redemptionId: string): Promise<boolean> {
  const { data, error } = await db()
    .from("assistant_action_requests")
    .select("id")
    .eq("family_id", familyId)
    .eq("kind", "reward_decision")
    .eq("status", "pending")
    .eq("data->>redemption_id", redemptionId)
    .gt("expires_at", new Date().toISOString())
    .limit(1);
  if (error) throw new Error(`Failed to read pending decisions: ${error.message}`);
  return (data ?? []).length > 0;
}

export const liveRewardDecisionDeps: RewardDecisionRequestDeps = {
  lookupRedemption: liveLookupRedemption,
  pointBalance: livePointBalance,
  decisionPending: liveDecisionPending,
  familyHasPin: (familyId) => familyHasPin(familyId),
  confirmationBudget: liveConfirmationBudget,
  createRequest: (input) => createActionRequest(input, { store: liveActionStore, push: pushActionRequest }),
};
