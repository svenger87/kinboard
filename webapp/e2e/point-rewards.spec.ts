import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { browserWriteGrants, codeOnly } from "./source-helpers";
import { TIER_THRESHOLDS_CENTS, TIER_THRESHOLDS_POINTS } from "../src/lib/pocket-money/types";
import { tierFromBalance } from "../src/lib/pocket-money/interest";
import { avatarStage, pointsStageWrites, pointTotals, rewardProgress, tierFromPoints } from "../src/lib/pocket-money/points";
import { decideRedemption, parseReward, requestRedemption, silentRewardNotifier } from "../src/lib/pocket-money/rewards";
import type { RpcClient } from "../src/lib/pocket-money/booking";

/**
 * Points instead of euros (discussion #349): the balance and stage maths,
 * the catalogue's input rules, and the routes' PIN boundary. No stack --
 * point-rewards-live.spec.ts proves the database half under concurrency.
 */

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

test.describe("the points balance", () => {
  test("earned minus approved; pending is held back from new requests, denied counts for nothing", () => {
    const totals = pointTotals(120, [
      { cost_points: 50, status: "approved" },
      { cost_points: 30, status: "pending" },
      { cost_points: 100, status: "denied" },
    ]);
    expect(totals).toEqual({ earned: 120, spent: 50, purchased: 0, pending: 30, balance: 70, owed: 0, available: 40 });
  });

  test("never goes below zero, even after a spent task is un-ticked", () => {
    expect(pointTotals(20, [{ cost_points: 50, status: "approved" }])).toMatchObject({ balance: 0, available: 0 });
    expect(pointTotals(0, [{ cost_points: 5, status: "pending" }])).toMatchObject({ balance: 0, available: 0 });
  });

  test("a shortfall is owed and paid back from later points", () => {
    const spent = [{ cost_points: 60, status: "approved" as const }];
    // Earned 100, spent 60, then a 50-point task un-ticked: 10 owed.
    expect(pointTotals(50, spent)).toMatchObject({ balance: 0, owed: 10 });
    // The next 10 points pay it back; the balance is still 0.
    expect(pointTotals(60, spent)).toMatchObject({ balance: 0, owed: 0 });
    expect(pointTotals(65, spent)).toMatchObject({ balance: 5, owed: 0 });
  });

  test("progress toward a reward is capped at 100", () => {
    expect(rewardProgress(0, 100)).toBe(0);
    expect(rewardProgress(37, 100)).toBe(37);
    expect(rewardProgress(250, 100)).toBe(100);
    expect(rewardProgress(-5, 100)).toBe(0);
  });
});

test.describe("the stage in points mode", () => {
  test("the thresholds: eight stages, rising, the egg hatching at 50 points", () => {
    expect(TIER_THRESHOLDS_POINTS).toHaveLength(TIER_THRESHOLDS_CENTS.length);
    expect(TIER_THRESHOLDS_POINTS[0]).toBe(0);
    expect(TIER_THRESHOLDS_POINTS[1]).toBe(50);
    for (let i = 1; i < TIER_THRESHOLDS_POINTS.length; i++) {
      expect(TIER_THRESHOLDS_POINTS[i]).toBeGreaterThan(TIER_THRESHOLDS_POINTS[i - 1]);
    }
  });

  test("follows the points earned", () => {
    expect(tierFromPoints(0)).toBe(1);
    expect(tierFromPoints(49)).toBe(1);
    expect(tierFromPoints(50)).toBe(2);
    expect(tierFromPoints(299)).toBe(3);
    expect(tierFromPoints(300)).toBe(4);
    expect(tierFromPoints(2_500)).toBe(8);
    expect(tierFromPoints(1_000_000)).toBe(8);
  });

  test("spending points never shrinks the pet: the stage reads earned, not the balance", () => {
    const before = avatarStage({ mode: "points", balanceCents: 0, earnedPoints: 320, storedBestTier: 1 });
    // The same child after spending 300 of them: earned is unchanged.
    const after = avatarStage({ mode: "points", balanceCents: 0, earnedPoints: 320, storedBestTier: before.tier });
    expect(before.tier).toBe(4);
    expect(after.tier).toBe(4);
  });

  test("a stage reached with money stays reached after switching to points", () => {
    const stage = avatarStage({ mode: "points", balanceCents: 0, earnedPoints: 10, storedBestTier: 5 });
    expect(stage.tier).toBe(5);
    expect(stage.best).toBe(5);
    expect(stage.next).toEqual({ tier: 6, at: TIER_THRESHOLDS_POINTS[5] });
  });

  test("in points mode a stage is never written to best_tier, so un-ticking takes it back", () => {
    // Tick: 50 points hatch the egg. Celebrated, last_seen moves, best_tier not.
    const hatched = avatarStage({ mode: "points", balanceCents: 0, earnedPoints: 50, storedBestTier: 1 });
    expect(pointsStageWrites({ stage: hatched, lastSeenTier: 1, storedBestTier: 1 }))
      .toEqual({ celebrate: true, update: { last_seen_tier: 2 } });
    // Un-tick: back to the egg, because nothing froze stage 2.
    const back = avatarStage({ mode: "points", balanceCents: 0, earnedPoints: 0, storedBestTier: 1 });
    expect(back.tier).toBe(1);
    expect(pointsStageWrites({ stage: back, lastSeenTier: 2, storedBestTier: 1 }))
      .toEqual({ celebrate: false, update: { last_seen_tier: 1 } });
  });

  test("in money mode best_tier still records the highest stage", () => {
    const stage = avatarStage({ mode: "money", balanceCents: 400, earnedPoints: 0, storedBestTier: 2 });
    expect(pointsStageWrites({ stage, lastSeenTier: 2, storedBestTier: 2 }))
      .toEqual({ celebrate: true, update: { last_seen_tier: 4, best_tier: 4 } });
  });

  test("switching to points that only brings back a money stage is not celebrated", () => {
    const stage = avatarStage({ mode: "points", balanceCents: 0, earnedPoints: 0, storedBestTier: 5 });
    expect(pointsStageWrites({ stage, lastSeenTier: 3, storedBestTier: 5 }))
      .toEqual({ celebrate: false, update: { last_seen_tier: 5 } });
  });

  test("the top stage has no next one", () => {
    expect(avatarStage({ mode: "points", balanceCents: 0, earnedPoints: 9_999, storedBestTier: 1 }).next).toBeNull();
  });

  test("money mode is unchanged: the balance's stage, best_tier as the badge", () => {
    for (const cents of [0, 49, 50, 999, 20_000]) {
      const stage = avatarStage({ mode: "money", balanceCents: cents, earnedPoints: 5_000, storedBestTier: 7 });
      expect(stage.tier).toBe(tierFromBalance(cents));
      expect(stage.best).toBe(Math.max(7, tierFromBalance(cents)));
      expect(stage.thresholds).toBe(TIER_THRESHOLDS_CENTS);
    }
    // An account from before the column existed has no mode: money.
    expect(avatarStage({ mode: undefined, balanceCents: 400, earnedPoints: 9_999, storedBestTier: 1 }).tier).toBe(4);
  });
});

test.describe("a reward's fields", () => {
  test("a new reward needs a title and a whole cost from 1 to 10000", () => {
    expect(parseReward({ title: " Kinoabend ", cost_points: 100, icon: "🎬" }, false))
      .toEqual({ ok: true, fields: { title: "Kinoabend", cost_points: 100, icon: "🎬" } });
    for (const cost of [0, -1, 10_001, 1.5, "100", null]) {
      expect(parseReward({ title: "x", cost_points: cost }, false).ok, String(cost)).toBe(false);
    }
    expect(parseReward({ title: "x", cost_points: 1 }, false).ok).toBe(true);
    expect(parseReward({ title: "x", cost_points: 10_000 }, false).ok).toBe(true);
    expect(parseReward({ title: "   ", cost_points: 5 }, false).ok).toBe(false);
    expect(parseReward({ title: "x".repeat(81), cost_points: 5 }, false).ok).toBe(false);
    expect(parseReward({ cost_points: 5 }, false).ok).toBe(false);
  });

  test("an edit checks only what it changes; an icon can be cleared; active is a boolean", () => {
    expect(parseReward({ active: false }, true)).toEqual({ ok: true, fields: { active: false } });
    expect(parseReward({ icon: "" }, true)).toEqual({ ok: true, fields: { icon: null } });
    expect(parseReward({ icon: "x".repeat(17) }, true).ok).toBe(false);
    expect(parseReward({ active: "yes" }, true).ok).toBe(false);
    expect(parseReward({}, true).ok).toBe(false);
  });
});

/** A client that answers every rpc with `data` and records the call. */
function fake(data: unknown): RpcClient & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return {
    calls,
    rpc: async (fn, args) => {
      calls.push([fn, args]);
      return { data, error: null };
    },
  };
}

const ID = "c1a0de00-0010-4000-8000-00000000aaaa";

test.describe("the database's answers, as HTTP", () => {
  test("a decision", async () => {
    const decide = (data: unknown) =>
      decideRedemption(fake(data), { familyId: ID, redemptionId: ID, decision: "approved", deviceId: null }, silentRewardNotifier);
    expect(await decide({ ok: true, status: "approved", balance: 40 })).toEqual({ status: 200, body: { ok: true, status: "approved", balance: 40 } });
    expect(await decide({ ok: false, error: "already_decided", status: "approved" })).toEqual({ status: 409, body: { error: "already_decided" } });
    expect(await decide({ ok: false, error: "insufficient_points", balance: 10 })).toEqual({ status: 409, body: { error: "insufficient_points", balance: 10 } });
    expect(await decide({ ok: false, error: "not_found" })).toEqual({ status: 404, body: { error: "not found" } });
    // Points are core since RFC-017: what the creature grows with no longer
    // stops an approval, so the database never answers not_points_mode.
    expect((await decide({ ok: false, error: "not_points_mode" })).status).toBe(500);
    expect((await decide({ ok: false, error: "???" })).status).toBe(500);
  });

  test("a request", async () => {
    const ask = (data: unknown) =>
      requestRedemption(fake(data), { familyId: ID, personId: ID, rewardId: ID, deviceId: null }, silentRewardNotifier);
    expect((await ask({ ok: true, redemption: { id: ID } })).status).toBe(201);
    expect(await ask({ ok: false, error: "insufficient_points", balance: 5, pending: 0 })).toEqual({ status: 409, body: { error: "insufficient_points", balance: 5, pending: 0 } });
    expect(await ask({ ok: false, error: "no_creature" })).toEqual({ status: 409, body: { error: "no_creature" } });
    expect((await ask({ ok: false, error: "no_reward" })).status).toBe(404);
  });

  test("an id that is not a uuid never reaches the database", async () => {
    const client = fake({ ok: true });
    expect((await decideRedemption(client, { familyId: ID, redemptionId: "1 or 1=1", decision: "approved", deviceId: null }, silentRewardNotifier)).status).toBe(404);
    expect((await requestRedemption(client, { familyId: ID, personId: "x", rewardId: ID, deviceId: null }, silentRewardNotifier)).status).toBe(404);
    expect(client.calls).toEqual([]);
  });
});

test.describe("who may write", () => {
  test("deciding, and keeping the catalogue, take the settings PIN; the family is the session's", () => {
    for (const path of [
      "src/app/api/rewards/redemptions/[id]/route.ts",
      "src/app/api/rewards/route.ts",
      "src/app/api/rewards/[id]/route.ts",
    ]) {
      const src = codeOnly(read(path));
      const handlers = src.match(/export async function (POST|PATCH|DELETE)/g) ?? [];
      expect(handlers.length, path).toBeGreaterThan(0);
      // One PIN check per handler, before anything is written.
      expect((src.match(/await requireSettingsUnlock\(auth\.session\)/g) ?? []).length, path).toBe(handlers.length);
      expect(src, path).toContain("auth.session.familyId");
      expect(src, path).not.toMatch(/familyIdFrom|body\.family_id/);
    }
  });

  test("a child's request needs a session but no PIN, and books nothing itself", () => {
    const src = codeOnly(read("src/app/api/rewards/redemptions/route.ts"));
    expect(src).toContain("await requireSession(request)");
    expect(src).not.toContain("requireSettingsUnlock");
    expect(src).toContain("requestRedemption(");
    // Per child, in the session's family (RFC-017).
    expect(src).toContain("personId: body.person_id");
    expect(src).toContain("familyId: auth.session.familyId");
  });

  test("what a creature grows with takes the PIN, on the creature now; the account refuses it", () => {
    const rules = codeOnly(read("src/lib/creatures/rules.ts"));
    expect(/PARENTAL_FIELDS = \[([^\]]*)\]/.exec(rules)?.[1]).toContain('"grows_with"');
    const account = codeOnly(read("src/app/api/pocket-money/accounts/[id]/route.ts"));
    expect(account.slice(account.indexOf("MOVED_TO_CREATURES: Record"))).toContain('reward_mode: "grows_with"');
  });

  test("the tables are read-only to the browser, family-scoped, published, and the functions are the service role's", () => {
    const sql = codeOnly(read("docker/migration_zzzzzzz_point_rewards.sql"), { sql: true });
    for (const table of ["point_rewards", "point_redemptions"]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
      expect(sql).toMatch(new RegExp(`CREATE POLICY ${table}_family_read ON public\\.${table}\\s+FOR SELECT USING \\(family_id = public\\.current_family_id\\(\\)\\);`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM anon;`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM authenticated;`));
      expect(sql).toMatch(new RegExp(`GRANT SELECT ON TABLE public\\.${table} TO authenticated;`));
      expect(browserWriteGrants(sql, table), table).toEqual([]);
      expect(sql).toMatch(new RegExp(`ALTER PUBLICATION supabase_realtime ADD TABLE public\\.${table};`));
    }
    for (const fn of ["point_account_totals", "request_point_redemption", "decide_point_redemption"]) {
      expect(sql).toContain(`'public.${fn}(`);
    }
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION %s FROM authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION %s TO service_role/);
    // best_tier only climbs, and never past stage 8, in the database.
    expect(sql).toMatch(/NEW\.best_tier := LEAST\(8, GREATEST\(LEAST\(8, COALESCE\(OLD\.best_tier, 1\)\), COALESCE\(NEW\.best_tier, 1\), 1\)\);/);
    expect(sql).toMatch(/CHECK \(best_tier BETWEEN 1 AND 8\)/);
    // The account is locked before the redemption, the order a delete cascades in.
    const decide = sql.slice(sql.indexOf("FUNCTION public.decide_point_redemption("));
    expect(decide.indexOf("FOR UPDATE OF a")).toBeGreaterThan(0);
    expect(decide.indexOf("FOR UPDATE OF a")).toBeLessThan(decide.indexOf("FROM public.point_redemptions\n   WHERE id = p_redemption_id AND family_id = p_family_id FOR UPDATE"));
  });

  test("per child since RFC-017: the balance, the request and the decision lock the child, not an account", () => {
    const sql = codeOnly(read("docker/migration_zzzzzzzz_pocket_money_creatures_out.sql"), { sql: true });
    const totals = sql.slice(sql.indexOf("FUNCTION public.point_person_totals("), sql.indexOf("FUNCTION public.point_account_totals("));
    expect(totals).toMatch(/FROM public\.todo_point_awards\s+WHERE person_id = p_person_id/);
    expect(totals).toMatch(/FROM public\.point_redemptions WHERE person_id = p_person_id/);
    expect(totals).toContain("GREATEST(0, v_earned - v_spent)");
    expect(totals).not.toContain("pocket_money_accounts");
    // The decision takes the child's lock before the request's row lock.
    const decide = sql.slice(sql.indexOf("FUNCTION public.decide_point_redemption("));
    expect(decide.indexOf("point_lock_person(v_person)")).toBeGreaterThan(0);
    expect(decide.indexOf("point_lock_person(v_person)")).toBeLessThan(decide.indexOf("FOR UPDATE"));
    expect(decide).toContain("point_person_totals(p_family_id, v_req.person_id)");
    // rc.13's names stay as wrappers for one release.
    for (const fn of ["point_person_totals", "point_account_totals", "request_person_point_redemption", "request_point_redemption", "decide_point_redemption", "creatures_from_accounts"]) {
      expect(sql).toContain(`'public.${fn}(`);
    }
  });

  test("the migration sorts after the ones it builds on", () => {
    // Not necessarily last: a later migration may follow it.
    const files = readdirSync(join(ROOT, "docker")).filter((f) => /^migration.*\.sql$/.test(f)).sort();
    const at = files.indexOf("migration_zzzzzzz_point_rewards.sql");
    expect(at).toBeGreaterThanOrEqual(0);
    for (const before of [
      "migration_pocket_money.sql",
      "migration_pocket_money_best_tier.sql",
      "migration_zz_row_level_security.sql",
      "migration_zzz_todo_points.sql",
    ]) {
      expect(files.indexOf(before), before).toBeGreaterThanOrEqual(0);
      expect(files.indexOf(before), before).toBeLessThan(at);
    }
  });
});
