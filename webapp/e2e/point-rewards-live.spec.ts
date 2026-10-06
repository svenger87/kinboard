import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../src/lib/supabase/server";
import { mintFamilyToken } from "../src/lib/family-jwt";
import type { RpcClient } from "../src/lib/pocket-money/booking";
import { decideRedemption, requestRedemption } from "../src/lib/pocket-money/rewards";

/**
 * Rewards bought with task points (discussion #349), against PostgreSQL
 * through PostgREST (docker/migration_zzzzzzz_point_rewards.sql), in the
 * style of pocket-money-live.spec.ts: approved twice books once, the balance
 * never goes below zero, and a browser's token can read but not write.
 *
 * Needs a stack: SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL (or
 * NEXT_PUBLIC_SUPABASE_URL), plus NEXT_PUBLIC_SUPABASE_ANON_KEY and JWT_SECRET
 * for the browser's half. Skipped without them, unless FAMILY_CODE says a
 * stack is there. It works only in a family of its own, `claude-pt-live`,
 * which it creates and deletes again, including whatever an interrupted run
 * left behind.
 */

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const HAS_STACK = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!URL;
test.skip(!HAS_STACK && !process.env.FAMILY_CODE, "needs SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL for a running stack");
test.describe.configure({ mode: "serial" });

const FAMILY = "c1a0de00-0010-4000-8000-00000000f001";
const OTHER_FAMILY = "c1a0de00-0010-4000-8000-00000000f002";
const CHILD = "c1a0de00-0010-4000-8000-00000000f0a1";
const ACCOUNT = "c1a0de00-0010-4000-8000-00000000f0c1";
const REWARD = "c1a0de00-0010-4000-8000-00000000f0d1";
const BIG_REWARD = "c1a0de00-0010-4000-8000-00000000f0d2";
const ROUNDS = 5;

let db: any;
const rpc = () => db as RpcClient;

async function purge() {
  await db.from("families").delete().in("id", [FAMILY, OTHER_FAMILY]);
  // The cascade stops at the soft-delete trigger on people: delete twice to purge.
  for (let i = 0; i < 2; i++) await db.from("people").delete().eq("id", CHILD);
}

/** The child has earned exactly `points`, has no requests, and is in points mode. */
async function reset(points: number) {
  await db.from("point_redemptions").delete().eq("account_id", ACCOUNT);
  await db.from("todo_point_awards").delete().eq("person_id", CHILD);
  if (points > 0) {
    const { error } = await db.from("todo_point_awards").insert({
      family_id: FAMILY, person_id: CHILD, todo_id: null, completion_key: "claude-pt-live", points,
    });
    if (error) throw error;
  }
  const { error } = await db.from("pocket_money_accounts").update({ reward_mode: "points" }).eq("id", ACCOUNT);
  if (error) throw error;
}

/** A pending request written by hand, past the request's own check. */
async function pending(cost: number): Promise<string> {
  const { data, error } = await db.from("point_redemptions")
    .insert({ family_id: FAMILY, account_id: ACCOUNT, title: "claude-pt-live", cost_points: cost })
    .select("id").single();
  if (error) throw error;
  return data.id;
}

async function totals(): Promise<{ earned: number; spent: number; pending: number; balance: number; owed: number }> {
  const { data, error } = await db.rpc("point_account_totals", { p_family_id: FAMILY, p_account_id: ACCOUNT });
  if (error) throw error;
  return data;
}

async function statusOf(id: string): Promise<string> {
  const { data } = await db.from("point_redemptions").select("status").eq("id", id).single();
  return data.status;
}

const approve = (redemptionId: string) =>
  decideRedemption(rpc(), { familyId: FAMILY, redemptionId, decision: "approved", deviceId: null });
const ask = (rewardId: string) =>
  requestRedemption(rpc(), { familyId: FAMILY, accountId: ACCOUNT, rewardId, deviceId: null });

test.beforeAll(async () => {
  db = createAdminClient();
  await purge();
  for (const [table, row] of [
    ["families", { id: FAMILY, name: "claude-pt-live", join_code: "CLAUDEPTLV" }],
    ["families", { id: OTHER_FAMILY, name: "claude-pt-live-other", join_code: "CLAUDEPTLO" }],
    ["people", { id: CHILD, family_id: FAMILY, name: "claude-pt-child", is_child: true }],
    ["pocket_money_accounts", { id: ACCOUNT, family_id: FAMILY, person_id: CHILD, balance_cents: 0 }],
    ["point_rewards", { id: REWARD, family_id: FAMILY, title: "claude-pt-reward", cost_points: 60 }],
    ["point_rewards", { id: BIG_REWARD, family_id: FAMILY, title: "claude-pt-big", cost_points: 500 }],
  ] as const) {
    const { error } = await db.from(table).insert(row);
    if (error) throw error;
  }
});

test.afterAll(async () => {
  await purge();
});

test.describe("a reward approved twice at once is booked once", () => {
  test("one 200, one already_decided, the points spent once", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await reset(100);
      const id = await pending(60);
      const answers = await Promise.all([approve(id), approve(id)]);
      expect(answers.map((a) => a.status).sort(), `round ${round}`).toEqual([200, 409]);
      expect(answers.find((a) => a.status === 409)!.body).toEqual({ error: "already_decided" });
      expect(await statusOf(id)).toBe("approved");
      expect(await totals()).toEqual({ earned: 100, spent: 60, pending: 0, balance: 40, owed: 0 });
    }
  });

  test("approve and deny at once: whichever wins, the points match the status", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await reset(100);
      const id = await pending(60);
      await Promise.all([
        approve(id),
        decideRedemption(rpc(), { familyId: FAMILY, redemptionId: id, decision: "denied", deviceId: null }),
      ]);
      const status = await statusOf(id);
      expect(["approved", "denied"]).toContain(status);
      expect((await totals()).balance).toBe(status === "approved" ? 40 : 100);
    }
  });

  test("decided twice in turn: the second is already_decided", async () => {
    await reset(100);
    const id = await pending(30);
    expect(await approve(id)).toEqual({ status: 200, body: { ok: true, status: "approved", balance: 70 } });
    expect(await approve(id)).toEqual({ status: 409, body: { error: "already_decided" } });
    expect((await totals()).spent).toBe(30);
  });
});

test.describe("the balance never goes below zero", () => {
  test("an approval the points don't cover is refused, writes nothing, and the request keeps waiting", async () => {
    await reset(30);
    const id = await pending(60);
    expect(await approve(id)).toEqual({ status: 409, body: { error: "insufficient_points", balance: 30 } });
    expect(await statusOf(id)).toBe("pending");
    expect(await totals()).toEqual({ earned: 30, spent: 0, pending: 60, balance: 30, owed: 0 });
  });

  test("two requests that together exceed the balance, approved at once: one approved, one refused", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await reset(100);
      const [a, b] = [await pending(60), await pending(60)];
      const answers = await Promise.all([approve(a), approve(b)]);
      expect(answers.map((x) => x.status).sort(), `round ${round}`).toEqual([200, 409]);
      expect(answers.find((x) => x.status === 409)!.body).toMatchObject({ error: "insufficient_points" });
      expect(await totals()).toMatchObject({ spent: 60, balance: 40 });
    }
  });

  test("a request is refused when the balance, less what is already waiting, does not cover it", async () => {
    await reset(100);
    expect((await ask(REWARD)).status).toBe(201);
    expect(await ask(REWARD)).toEqual({ status: 409, body: { error: "insufficient_points", balance: 100, pending: 60 } });
    expect((await ask(BIG_REWARD)).status).toBe(409);
    const { data } = await db.from("point_redemptions").select("title, cost_points, status").eq("account_id", ACCOUNT);
    expect(data).toEqual([{ title: "claude-pt-reward", cost_points: 60, status: "pending" }]);
  });

  test("ten requests racing for one reward's worth: one made", async () => {
    await reset(60);
    const answers = await Promise.all(Array.from({ length: 10 }, () => ask(REWARD)));
    expect(answers.filter((a) => a.status === 201)).toHaveLength(1);
    expect(answers.filter((a) => a.status === 409)).toHaveLength(9);
  });

  test("a child whose avatar grows with money cannot ask, nor for an inactive reward", async () => {
    await reset(1_000);
    await db.from("pocket_money_accounts").update({ reward_mode: "money" }).eq("id", ACCOUNT);
    expect(await ask(REWARD)).toEqual({ status: 409, body: { error: "not_points_mode" } });
    await db.from("pocket_money_accounts").update({ reward_mode: "points" }).eq("id", ACCOUNT);
    await db.from("point_rewards").update({ active: false }).eq("id", REWARD);
    expect(await ask(REWARD)).toEqual({ status: 404, body: { error: "no_reward" } });
    await db.from("point_rewards").update({ active: true }).eq("id", REWARD);
  });

  test("points taken back after they were spent are owed, and paid back from later ones", async () => {
    await reset(100);
    expect(await approve(await pending(60))).toMatchObject({ status: 200 });
    // A 50-point task un-ticked: earned 50, spent 60.
    await db.from("todo_point_awards").update({ points: 50 }).eq("person_id", CHILD);
    expect(await totals()).toMatchObject({ earned: 50, balance: 0, owed: 10 });
    // The next 10 points pay it back: still nothing to spend.
    await db.from("todo_point_awards").update({ points: 60 }).eq("person_id", CHILD);
    expect(await totals()).toMatchObject({ balance: 0, owed: 0 });
    const id = await pending(1);
    expect(await approve(id)).toEqual({ status: 409, body: { error: "insufficient_points", balance: 0 } });
  });

  test("a child switched back to money: approving is refused and the request keeps waiting; denying works", async () => {
    await reset(100);
    const id = await pending(10);
    await db.from("pocket_money_accounts").update({ reward_mode: "money" }).eq("id", ACCOUNT);
    expect(await approve(id)).toEqual({ status: 409, body: { error: "not_points_mode" } });
    expect(await statusOf(id)).toBe("pending");
    expect((await totals()).spent).toBe(0);
    expect(await decideRedemption(rpc(), { familyId: FAMILY, redemptionId: id, decision: "denied", deviceId: null }))
      .toMatchObject({ status: 200 });
    expect(await statusOf(id)).toBe("denied");
  });

  test("another family's request or reward is not found", async () => {
    await reset(100);
    const id = await pending(10);
    expect(await decideRedemption(rpc(), { familyId: OTHER_FAMILY, redemptionId: id, decision: "approved", deviceId: null }))
      .toEqual({ status: 404, body: { error: "not found" } });
    expect(await requestRedemption(rpc(), { familyId: OTHER_FAMILY, accountId: ACCOUNT, rewardId: REWARD, deviceId: null }))
      .toEqual({ status: 404, body: { error: "not found" } });
    expect(await statusOf(id)).toBe("pending");
  });
});

test.describe("best_tier only climbs, and never past the last stage", () => {
  const bestTier = async () =>
    (await db.from("pocket_money_accounts").select("best_tier").eq("id", ACCOUNT).single()).data.best_tier;

  test("a lower value written to it is ignored", async () => {
    await db.from("pocket_money_accounts").update({ best_tier: 5 }).eq("id", ACCOUNT);
    await db.from("pocket_money_accounts").update({ best_tier: 2 }).eq("id", ACCOUNT);
    expect(await bestTier()).toBe(5);
  });

  test("a value past stage 8 is held at 8, and a new account can't start out of range", async () => {
    await db.from("pocket_money_accounts").update({ best_tier: 99 }).eq("id", ACCOUNT);
    expect(await bestTier()).toBe(8);
    const { error } = await db.from("pocket_money_accounts")
      .insert({ family_id: OTHER_FAMILY, person_id: CHILD, best_tier: 99 });
    expect(error?.code).toBe("23514");
  });
});

test.describe("a browser's token reads its family's rows and writes nothing", () => {
  const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  test.skip(!ANON || !(process.env.JWT_SECRET || process.env.PGRST_JWT_SECRET), "needs NEXT_PUBLIC_SUPABASE_ANON_KEY and JWT_SECRET");

  const browser = (familyId: string) =>
    createClient(URL!, ANON!, {
      global: { headers: { Authorization: `Bearer ${mintFamilyToken(familyId).token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }) as any;

  test("reads: its own family's rewards and requests, never another's", async () => {
    await reset(100);
    const id = await pending(10);
    const mine = browser(FAMILY);
    expect((await mine.from("point_rewards").select("id").eq("id", REWARD)).data).toHaveLength(1);
    expect((await mine.from("point_redemptions").select("id").eq("id", id)).data).toHaveLength(1);
    const theirs = browser(OTHER_FAMILY);
    expect((await theirs.from("point_rewards").select("id").eq("id", REWARD)).data).toEqual([]);
    expect((await theirs.from("point_redemptions").select("id").eq("id", id)).data).toEqual([]);
  });

  test("writes: no insert, update or delete, and no function, even in its own family", async () => {
    await reset(100);
    const id = await pending(10);
    const mine = browser(FAMILY);
    const attempts = [
      await mine.from("point_redemptions").update({ status: "approved" }).eq("id", id),
      await mine.from("point_redemptions").insert({ family_id: FAMILY, account_id: ACCOUNT, title: "x", cost_points: 1, status: "approved" }),
      await mine.from("point_redemptions").delete().eq("id", id),
      await mine.from("point_rewards").insert({ family_id: FAMILY, title: "x", cost_points: 1 }),
      await mine.from("point_rewards").update({ cost_points: 1 }).eq("id", REWARD),
      await mine.from("point_rewards").delete().eq("id", REWARD),
      await mine.rpc("decide_point_redemption", { p_family_id: FAMILY, p_redemption_id: id, p_decision: "approved", p_device_id: null }),
      await mine.rpc("request_point_redemption", { p_family_id: FAMILY, p_account_id: ACCOUNT, p_reward_id: REWARD, p_device_id: null }),
    ];
    for (const [i, res] of attempts.entries()) {
      expect(res.error, `attempt ${i}`).not.toBeNull();
      expect(res.error.code, `attempt ${i}`).toBe("42501");
    }
    expect(await statusOf(id)).toBe("pending");
    const { data: rewards } = await db.from("point_rewards").select("cost_points").in("id", [REWARD, BIG_REWARD]).order("cost_points");
    expect(rewards).toEqual([{ cost_points: 60 }, { cost_points: 500 }]);
    expect(await totals()).toEqual({ earned: 100, spent: 0, pending: 10, balance: 100, owed: 0 });
  });
});
