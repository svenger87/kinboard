/**
 * Points, creatures and rewards through the Integration API (Home Assistant,
 * assistants): reading each child's points and creature stage, the family's
 * rewards and the requests waiting for a parent, and asking for a reward on a
 * child's behalf.
 *
 * WHAT NEVER LEAVES. A creature's look -- its colours, its accessories and
 * the name the child gave it -- stays on the family's own screens
 * (e2e/creature-look.spec.ts). The creature is read here by naming its
 * columns: species, what it grows with and best_tier, never `look`, never a
 * whole row. The child's own name does go out, as everywhere else in this
 * API (`GET /people`).
 *
 * WHERE THE NUMBERS COME FROM. A child's points are point_person_totals(),
 * the database's own answer, and nothing here adds rows up itself: whatever
 * the balance comes to count later (the shop's purchases) is counted here
 * without a change. The stage is creatureStage() (lib/creatures/stage.ts),
 * the same arithmetic the screens draw with.
 *
 * ASKING, NOT APPROVING. `requestReward` makes the same pending request the
 * child's own "Redeem" button makes (request_person_point_redemption), and
 * nothing else: no route under /api/integration decides one. A parent
 * approves or denies it on a Kinboard screen with the settings PIN, as any
 * other. The request reaches the parents' phones through the same queue as
 * the child's own (lib/notifications/rewards.ts).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { getFamilyLocale } from "@/lib/family-locale";
import { getTranslator } from "@/lib/notifications/messages";
import { UUID } from "@/lib/home/action-requests";
import { creatureStage } from "@/lib/creatures/stage";
import { requestRedemption, type RewardNotifier } from "@/lib/pocket-money/rewards";
import type { RpcClient } from "@/lib/pocket-money/booking";

// The admin client is untyped for these tables, as in the other routes.
type Db = any;

const liveDb = (): Db => createAdminClient() as any;

// ── reading ──────────────────────────────────────────────────────────────────

export interface ChildPoints {
  /** What the child may spend: earned − approved rewards − shop purchases, never below zero. */
  balance: number;
  /** Every task point ever awarded. */
  earned: number;
  /** Points spent beyond what was earned (a task un-ticked after its points were spent), paid back first. */
  owed: number;
  /** The cost of the requests waiting for a parent. */
  pending: number;
  /** What a new request may still use: the balance less what is waiting. */
  available: number;
  /**
   * Points spent in the shop, all time. point_person_totals() reports it once
   * the shop exists (#375); before that the key is absent and this is 0.
   */
  purchased: number;
}

export interface NextStage {
  stage: number;
  stage_name: string;
  /** The threshold: points earned, or the balance in currency units for a creature that grows with money. */
  at: number;
  unit: "points" | "money";
  /** The account's currency, for `unit: "money"` only. */
  currency?: string;
}

export interface ChildRewardsView {
  person_id: string;
  name: string;
  points: ChildPoints;
  creature: {
    species: string;
    /** 1 (an egg) to 8. */
    stage: number;
    /** The stage's name in the family's language, as the screens show it. */
    stage_name: string;
    grows_with: "points" | "money";
    /** null at the top stage. */
    next_stage: NextStage | null;
  };
}

export interface RewardView {
  id: string;
  title: string;
  icon: string | null;
  cost_points: number;
}

export interface PendingRedemptionView {
  id: string;
  person_id: string;
  child_name: string;
  reward_id: string | null;
  /** As it was when the child asked: a later edit to the catalogue changes neither. */
  title: string;
  icon: string | null;
  cost_points: number;
  requested_at: string;
}

export interface RewardsView {
  children: ChildRewardsView[];
  rewards: RewardView[];
  pending: PendingRedemptionView[];
  /** The language `stage_name` is in. */
  locale: string;
}

interface PersonRow { id: string; name: string; is_child: boolean | null }
interface CreatureRow { person_id: string; species: string; grows_with: string; best_tier: number | null }
interface AccountRow { person_id: string; balance_cents: number | null; currency: string | null }
interface TotalsRow { earned: number; spent: number; pending: number; balance: number; owed: number; purchased?: number }

function checked<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Failed to read ${what}: ${result.error.message}`);
  return (result.data ?? ([] as unknown)) as T;
}

/** A stage's name in the family's language, the species' own word for it ("Hatchling"). */
export function stageNameFor(locale: string): (species: string, stage: number) => string {
  let missing = false;
  const t = getTranslator(locale, "pocketMoney", () => { missing = true; });
  return (species, stage) => {
    missing = false;
    const name = t(`species.${species}.tier${stage}` as never) as string;
    // A species this release has no words for (a newer backup restored on an
    // older server): the stage number, never the message key.
    return missing || !name || name.includes("species.") ? String(stage) : name;
  };
}

/**
 * Every child with a creature switched on -- people in the recycle bin left
 * out -- in the family's own order, with their points and their creature's
 * stage; the active rewards, cheapest first; and the requests waiting for a
 * parent, oldest first.
 */
export async function listRewards(familyId: string, db: Db = liveDb(), locale?: string): Promise<RewardsView> {
  const [people, creatures, accounts, rewards, pending, familyLocale] = await Promise.all([
    db.from("people").select("id, name, is_child").eq("family_id", familyId).is("deleted_at", null)
      .order("created_at", { ascending: true }),
    // Named columns: never `look`, never `*` (the top of this file).
    db.from("creatures").select("person_id, species, grows_with, best_tier").eq("family_id", familyId).eq("enabled", true),
    db.from("pocket_money_accounts").select("person_id, balance_cents, currency").eq("family_id", familyId),
    db.from("point_rewards").select("id, title, icon, cost_points").eq("family_id", familyId).eq("active", true)
      .order("cost_points", { ascending: true }),
    db.from("point_redemptions").select("id, person_id, reward_id, title, icon, cost_points, created_at")
      .eq("family_id", familyId).eq("status", "pending").order("created_at", { ascending: true }),
    locale ? Promise.resolve(locale) : getFamilyLocale(familyId),
  ]);
  const peopleRows = checked<PersonRow[]>(people, "people");
  const creatureRows = checked<CreatureRow[]>(creatures, "creature stages");
  const accountRows = checked<AccountRow[]>(accounts, "pocket money accounts");
  const rewardRows = checked<RewardView[]>(rewards, "rewards");
  const pendingRows = checked<Array<Omit<PendingRedemptionView, "child_name" | "requested_at"> & { created_at: string }>>(pending, "reward requests");

  const stageName = stageNameFor(familyLocale);
  const nameOf = new Map(peopleRows.map((p) => [p.id, p.name]));

  const children: ChildRewardsView[] = [];
  for (const person of peopleRows) {
    if (person.is_child !== true) continue;
    const creature = creatureRows.find((c) => c.person_id === person.id);
    if (!creature) continue;
    const { data, error } = await db.rpc("point_person_totals", { p_family_id: familyId, p_person_id: person.id });
    if (error) throw new Error(`Failed to read points: ${error.message}`);
    const totals = data as TotalsRow | null;
    if (!totals) continue; // gone between the two reads
    const account = accountRows.find((a) => a.person_id === person.id) ?? null;
    const stage = creatureStage({
      creature: { grows_with: creature.grows_with, best_tier: creature.best_tier },
      account: account ? { balance_cents: account.balance_cents ?? 0 } : null,
      earnedPoints: Number(totals.earned),
    });
    const next: NextStage | null = stage.next === null
      ? null
      : stage.mode === "points"
        ? { stage: stage.next.tier, stage_name: stageName(creature.species, stage.next.tier), at: stage.next.at, unit: "points" }
        : {
            stage: stage.next.tier, stage_name: stageName(creature.species, stage.next.tier),
            at: stage.next.at / 100, unit: "money", currency: account?.currency ?? "EUR",
          };
    const balance = Number(totals.balance);
    const pendingPoints = Number(totals.pending);
    children.push({
      person_id: person.id,
      name: person.name,
      points: {
        balance,
        earned: Number(totals.earned),
        owed: Number(totals.owed),
        pending: pendingPoints,
        available: Math.max(0, balance - pendingPoints),
        purchased: Number(totals.purchased ?? 0),
      },
      creature: {
        species: creature.species,
        stage: stage.tier,
        stage_name: stageName(creature.species, stage.tier),
        grows_with: stage.mode,
        next_stage: next,
      },
    });
  }

  return {
    children,
    rewards: rewardRows.map((r) => ({ id: r.id, title: r.title, icon: r.icon ?? null, cost_points: r.cost_points })),
    // A request of someone in the recycle bin is out of sight with them, as on the screens.
    pending: pendingRows.filter((r) => nameOf.has(r.person_id)).map((r) => ({
      id: r.id,
      person_id: r.person_id,
      child_name: nameOf.get(r.person_id) as string,
      reward_id: r.reward_id ?? null,
      title: r.title,
      icon: r.icon ?? null,
      cost_points: r.cost_points,
      requested_at: r.created_at,
    })),
    locale: familyLocale,
  };
}

// ── asking for a reward ─────────────────────────────────────────────────────

export interface RewardRequestResult {
  status: number;
  body: Record<string, unknown>;
}

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): RewardRequestResult =>
  ({ status, body: { error, code, ...extra } });

/** Text compared the way a person would: trimmed, case and composition ignored. */
const fold = (s: string) => s.normalize("NFC").trim().toLocaleLowerCase();

export const REWARD_REF_MAX = 200;

/** The body: `{ child, reward }`, each an id or a name. */
export function parseRewardRequestBody(body: unknown):
  | { ok: true; child: string; reward: string }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "A JSON object body is required" };
  const b = body as Record<string, unknown>;
  const ref = (v: unknown) => (typeof v === "string" && v.trim().length > 0 && v.length <= REWARD_REF_MAX ? v.trim() : null);
  const child = ref(b.child);
  if (!child) return { ok: false, error: "child must be a child's person_id or name (GET /rewards)" };
  const reward = ref(b.reward);
  if (!reward) return { ok: false, error: "reward must be a reward's id or title (GET /rewards)" };
  return { ok: true, child, reward };
}

/**
 * One of `rows` by id, or by name when exactly one matches. An id is matched
 * only as an id: a reward titled like another reward's id cannot hijack it.
 */
export function resolveRef<T extends { id: string }>(
  rows: readonly T[], ref: string, nameOf: (row: T) => string,
): { ok: true; row: T } | { ok: false; reason: "none" | "ambiguous" } {
  if (UUID.test(ref)) {
    const byId = rows.find((r) => r.id.toLowerCase() === ref.toLowerCase());
    return byId ? { ok: true, row: byId } : { ok: false, reason: "none" };
  }
  const matches = rows.filter((r) => fold(nameOf(r)) === fold(ref));
  if (matches.length === 1) return { ok: true, row: matches[0] };
  return { ok: false, reason: matches.length === 0 ? "none" : "ambiguous" };
}

export interface RewardRequestDeps {
  db: Db;
  notifier: RewardNotifier;
}

/**
 * Ask for a reward for a child, as the child's own "Redeem" does: a pending
 * request a parent approves or denies on Kinboard with the settings PIN.
 * 201 with the request, or a refusal after which nothing was stored or
 * pushed. Unknown children and rewards are a 400 naming which, never a 404:
 * they are fields of the body, and to a client a 404 says the endpoint is
 * missing.
 */
export async function requestReward(
  input: { familyId: string; body: unknown },
  deps: RewardRequestDeps,
): Promise<RewardRequestResult> {
  const parsed = parseRewardRequestBody(input.body);
  if (!parsed.ok) return fail(400, "invalid_request", parsed.error);

  const [people, rewards] = await Promise.all([
    deps.db.from("people").select("id, name, is_child").eq("family_id", input.familyId).is("deleted_at", null),
    deps.db.from("point_rewards").select("id, title, icon, cost_points").eq("family_id", input.familyId).eq("active", true),
  ]);
  const peopleRows = checked<PersonRow[]>(people, "people");
  const rewardRows = checked<RewardView[]>(rewards, "rewards");

  const child = resolveRef(peopleRows.filter((p) => p.is_child === true), parsed.child, (p) => p.name);
  if (!child.ok) {
    if (child.reason === "ambiguous") {
      return fail(400, "invalid_request", "More than one child has that name; send their person_id instead. Nothing was asked.", { reason: "ambiguous_child" });
    }
    return fail(400, "invalid_request", "No child of this family has that id or name. Nothing was asked.", { reason: "no_child" });
  }
  const reward = resolveRef(rewardRows, parsed.reward, (r) => r.title);
  if (!reward.ok) {
    if (reward.reason === "ambiguous") {
      return fail(400, "invalid_request", "More than one reward has that title; send its id instead. Nothing was asked.", { reason: "ambiguous_reward" });
    }
    return fail(400, "invalid_request", "This family has no active reward with that id or title. Nothing was asked.", { reason: "no_reward" });
  }

  // The device is nobody: an integration is not one of the family's screens.
  const answer = await requestRedemption(deps.db as RpcClient, {
    familyId: input.familyId, personId: child.row.id, rewardId: reward.row.id, deviceId: null,
  }, deps.notifier);

  if (answer.status === 201) {
    const r = answer.body.redemption as {
      id: string; person_id: string; reward_id: string | null; title: string; icon: string | null; cost_points: number; created_at: string;
    };
    return {
      status: 201,
      body: {
        status: "pending_approval",
        redemption: {
          id: r.id, person_id: r.person_id, child_name: child.row.name, reward_id: r.reward_id ?? null,
          title: r.title, icon: r.icon ?? null, cost_points: r.cost_points, requested_at: r.created_at,
        },
      },
    };
  }
  switch (answer.body.error) {
    case "no_creature":
      return fail(409, "conflict", "This child has no creature switched on, so they have no rewards. A parent switches one on under Settings → Creatures & rewards. Nothing was asked.", { reason: "no_creature" });
    case "insufficient_points":
      return fail(409, "conflict", "This child does not have enough points for that reward, counting the requests already waiting. Nothing was asked.", {
        reason: "insufficient_points", balance: answer.body.balance ?? null, pending: answer.body.pending ?? null,
      });
    case "no_reward":
      return fail(400, "invalid_request", "This family has no active reward with that id or title. Nothing was asked.", { reason: "no_reward" });
    case "not found":
      return fail(400, "invalid_request", "No child of this family has that id or name. Nothing was asked.", { reason: "no_child" });
    default:
      throw new Error(`request_person_point_redemption: ${String(answer.body.error)}`);
  }
}
