import { test, expect } from "@playwright/test";
import { createAdminClient } from "../src/lib/supabase/server";
import { bookPocketMoney, type RpcClient } from "../src/lib/pocket-money/booking";
import { decideWithdrawal } from "../src/lib/pocket-money/runs";

/**
 * The pocket-money SQL functions under real concurrency, against PostgreSQL
 * through PostgREST (docker/migration_zzzzz_pocket_money_booking.sql). The
 * fake-client specs (pocket-money-runs, integration-pocket-money) pin what the
 * code asks for; this one proves the database does it atomically.
 *
 * Needs a stack: SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL (or
 * NEXT_PUBLIC_SUPABASE_URL), e.g. Kong on :8130 here. Skipped without them,
 * unless FAMILY_CODE says a stack is there; CI's smoke job (e2e.yml) runs it.
 * It works only in a family of its own, `claude-pm-live`, which it creates and
 * deletes again (people and goals, which the soft-delete triggers keep, are
 * purged by id), including whatever an interrupted run left behind.
 */

const HAS_STACK = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
// FAMILY_CODE promises a stack (e2e.yml sets it), so there a missing key fails
// in beforeAll rather than skipping the whole file green.
test.skip(!HAS_STACK && !process.env.FAMILY_CODE, "needs SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL for a running stack");
test.describe.configure({ mode: "serial" });

const FAMILY = "c1a0de00-0009-4000-8000-00000000f001";
const CHILD = "c1a0de00-0009-4000-8000-00000000f0a1";
const ACCOUNT = "c1a0de00-0009-4000-8000-00000000f0c1";
const GOAL = "c1a0de00-0009-4000-8000-00000000f0e1";
const SIBLING = "c1a0de00-0009-4000-8000-00000000f0a2";
const SIBLING_ACCOUNT = "c1a0de00-0009-4000-8000-00000000f0c2";
const SIBLING_GOAL = "c1a0de00-0009-4000-8000-00000000f0e2";
const ROUNDS = 5;

let db: any;
const rpc = () => db as RpcClient;

async function purge() {
  await db.from("families").delete().eq("id", FAMILY);
  // The cascade stops at the soft-delete triggers: delete twice to purge.
  for (let i = 0; i < 2; i++) {
    await db.from("pocket_money_goals").delete().in("id", [GOAL, SIBLING_GOAL]);
    await db.from("people").delete().in("id", [CHILD, SIBLING]);
  }
}

async function reset(balanceCents: number) {
  await db.from("pocket_money_withdrawal_requests").delete().eq("account_id", ACCOUNT);
  await db.from("pocket_money_transactions").delete().eq("account_id", ACCOUNT);
  const { error } = await db.from("pocket_money_accounts").update({
    balance_cents: balanceCents, lifetime_saved_cents: 0, last_allowance_at: null, pending_interest_cents: 0,
  }).eq("id", ACCOUNT);
  if (error) throw error;
  await db.from("pocket_money_goals").update({ status: "active", parent_confirmed_at: null }).eq("id", GOAL);
}

async function state() {
  const { data: account } = await db.from("pocket_money_accounts").select("balance_cents, lifetime_saved_cents, pending_interest_cents, last_allowance_at").eq("id", ACCOUNT).single();
  const { data: txns } = await db.from("pocket_money_transactions").select("amount_cents, type").eq("account_id", ACCOUNT);
  return { ...account, txns: (txns ?? []) as { amount_cents: number; type: string }[] };
}

async function newRequest(amountCents: number, goal: string | null = null): Promise<string> {
  const { data, error } = await db.from("pocket_money_withdrawal_requests")
    .insert({ account_id: ACCOUNT, amount_cents: amountCents, reason: "claude-pm-live", related_goal_id: goal }).select("id").single();
  if (error) throw error;
  return data.id;
}

const approve = (requestId: string) =>
  decideWithdrawal(rpc(), { familyId: FAMILY, requestId, decision: "approved", personId: null });

test.beforeAll(async () => {
  db = createAdminClient();
  await purge();
  for (const [table, row] of [
    ["families", { id: FAMILY, name: "claude-pm-live", join_code: "CLAUDEPMLV" }],
    ["people", { id: CHILD, family_id: FAMILY, name: "claude-pm-child", is_child: true }],
    ["pocket_money_accounts", { id: ACCOUNT, family_id: FAMILY, person_id: CHILD, balance_cents: 0 }],
    ["pocket_money_goals", { id: GOAL, account_id: ACCOUNT, name: "claude-pm-goal", target_amount_cents: 100 }],
    ["people", { id: SIBLING, family_id: FAMILY, name: "claude-pm-sibling", is_child: true }],
    ["pocket_money_accounts", { id: SIBLING_ACCOUNT, family_id: FAMILY, person_id: SIBLING, balance_cents: 0 }],
    ["pocket_money_goals", { id: SIBLING_GOAL, account_id: SIBLING_ACCOUNT, name: "claude-pm-sibling-goal", target_amount_cents: 100 }],
  ] as const) {
    const { error } = await db.from(table).insert(row);
    if (error) throw error;
  }
});

test.afterAll(async () => {
  await purge();
});

test.describe("a withdrawal request approved twice at once is booked once", () => {
  test("enough money for both: one 200, one already_decided, one booking, approved", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await reset(10_000);
      const id = await newRequest(600, GOAL);
      const answers = await Promise.all([approve(id), approve(id)]);
      expect(answers.map((a) => a.status).sort(), `round ${round}`).toEqual([200, 409]);
      expect(answers.find((a) => a.status === 409)!.body).toEqual({ error: "already_decided" });
      const after = await state();
      expect(after.txns, `round ${round}`).toEqual([{ amount_cents: -600, type: "withdrawal" }]);
      expect(after.balance_cents).toBe(9_400);
      const { data: req } = await db.from("pocket_money_withdrawal_requests").select("status").eq("id", id).single();
      expect(req.status).toBe("approved");
      const { data: goal } = await db.from("pocket_money_goals").select("status").eq("id", GOAL).single();
      expect(goal.status).toBe("bought");
    }
  });

  test("money for only one: approved once, never denied after the money went", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await reset(1_000);
      const id = await newRequest(600);
      const answers = await Promise.all([approve(id), approve(id)]);
      expect(answers.map((a) => a.status).sort(), `round ${round}`).toEqual([200, 409]);
      const after = await state();
      expect(after.txns).toEqual([{ amount_cents: -600, type: "withdrawal" }]);
      expect(after.balance_cents).toBe(400);
      const { data: req } = await db.from("pocket_money_withdrawal_requests").select("status").eq("id", id).single();
      expect(req.status).toBe("approved");
    }
  });

  test("approve and deny at once: whichever wins, the money matches the status", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await reset(1_000);
      const id = await newRequest(600);
      await Promise.all([
        approve(id),
        decideWithdrawal(rpc(), { familyId: FAMILY, requestId: id, decision: "denied", personId: null }),
      ]);
      const after = await state();
      const { data: req } = await db.from("pocket_money_withdrawal_requests").select("status").eq("id", id).single();
      expect(after.txns).toHaveLength(req.status === "approved" ? 1 : 0);
      expect(after.balance_cents).toBe(req.status === "approved" ? 400 : 1_000);
    }
  });

  test("two requests that together exceed the balance: one approved, the other denied for want of money", async () => {
    await reset(1_000);
    const [a, b] = [await newRequest(600), await newRequest(600)];
    const answers = await Promise.all([approve(a), approve(b)]);
    expect(answers.map((x) => x.body).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))))
      .toEqual([{ error: "insufficient_funds_at_decide_time" }, { ok: true }]);
    expect((await state()).balance_cents).toBe(400);
  });

  test("a goal that is not this account's, or a decider from another family: a clean 400, nothing booked", async () => {
    await reset(1_000);
    // A hand-made row, past the creation route's check: the sibling's goal.
    const id = await newRequest(100, SIBLING_GOAL);
    expect(await approve(id)).toEqual({ status: 400, body: { error: "the request's goal is not one of this account's goals" } });
    const other = await newRequest(100);
    const res = await decideWithdrawal(rpc(), { familyId: FAMILY, requestId: other, decision: "approved", personId: "c1a0de00-0009-4000-8000-00000000ffff" });
    expect(res).toEqual({ status: 400, body: { error: "parent_decided_by_person_id is not a person of this family" } });
    expect((await state()).txns).toEqual([]);
    const { data: reqs } = await db.from("pocket_money_withdrawal_requests").select("status").eq("account_id", ACCOUNT);
    expect(reqs.map((r: { status: string }) => r.status)).toEqual(["pending", "pending"]);
  });
});

test.describe("a booking never takes the balance below zero", () => {
  test("an overdraw is refused and writes nothing", async () => {
    await reset(500);
    expect(await bookPocketMoney(rpc(), { familyId: FAMILY, accountId: ACCOUNT, amountCents: -501, type: "withdrawal" }))
      .toEqual({ ok: false, error: "insufficient_funds" });
    expect(await bookPocketMoney(rpc(), { familyId: FAMILY, accountId: ACCOUNT, amountCents: -501, type: "adjustment" }))
      .toEqual({ ok: false, error: "insufficient_funds" });
    const after = await state();
    expect(after.balance_cents).toBe(500);
    expect(after.txns).toEqual([]);
  });

  test("ten withdrawals racing for five withdrawals' worth: five booked, the balance at zero", async () => {
    await reset(500);
    const answers = await Promise.all(Array.from({ length: 10 }, () =>
      bookPocketMoney(rpc(), { familyId: FAMILY, accountId: ACCOUNT, amountCents: -100, type: "withdrawal" })));
    expect(answers.filter((a) => a.ok)).toHaveLength(5);
    expect(answers.filter((a) => !a.ok && a.error === "insufficient_funds")).toHaveLength(5);
    const after = await state();
    expect(after.balance_cents).toBe(0);
    expect(after.txns).toHaveLength(5);
  });

  test("a request decided twice in turn: the second is already_decided, one booking", async () => {
    await reset(1_000);
    const id = await newRequest(300);
    expect(await approve(id)).toMatchObject({ status: 200 });
    expect(await approve(id)).toEqual({ status: 409, body: { error: "already_decided" } });
    const after = await state();
    expect(after.txns).toEqual([{ amount_cents: -300, type: "withdrawal" }]);
    expect(after.balance_cents).toBe(700);
  });
});

test.describe("the allowance is paid once per period, and never overwrites a booking", () => {
  test("two runs claiming the same period: paid once, last_allowance_at set", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await reset(0);
      const pay = () => rpc().rpc("pay_pocket_money_allowance", {
        p_account_id: ACCOUNT, p_amount_cents: 250, p_note: "Weekly allowance", p_expected_last: null,
      });
      const answers = await Promise.all([pay(), pay()]);
      const oks = answers.map((a) => (a.data as { ok?: boolean } | null)?.ok === true);
      expect(oks.filter(Boolean), `round ${round}`).toHaveLength(1);
      const after = await state();
      expect(after.txns).toEqual([{ amount_cents: 250, type: "allowance" }]);
      expect(after.balance_cents).toBe(250);
      expect(after.lifetime_saved_cents).toBe(250);
      expect(after.last_allowance_at).not.toBeNull();
    }
  });

  test("an allowance alongside ten withdrawals: every cent accounted for", async () => {
    await reset(1_000);
    const pay = rpc().rpc("pay_pocket_money_allowance", {
      p_account_id: ACCOUNT, p_amount_cents: 250, p_note: "Weekly allowance", p_expected_last: null,
    });
    const withdrawals = Array.from({ length: 10 }, () =>
      bookPocketMoney(rpc(), { familyId: FAMILY, accountId: ACCOUNT, amountCents: -100, type: "withdrawal" }));
    await Promise.all([pay, ...withdrawals]);
    const after = await state();
    expect(after.txns).toHaveLength(11);
    expect(after.balance_cents).toBe(1_000 + after.txns.reduce((sum: number, t: { amount_cents: number }) => sum + t.amount_cents, 0));
    expect(after.balance_cents).toBe(250);
  });

  test("interest committed alongside ten withdrawals: every cent accounted for", async () => {
    await reset(1_000);
    await db.from("pocket_money_accounts").update({ pending_interest_cents: 37 }).eq("id", ACCOUNT);
    const commit = rpc().rpc("commit_pocket_money_interest", { p_account_id: ACCOUNT, p_note: "Daily interest" });
    const withdrawals = Array.from({ length: 10 }, () =>
      bookPocketMoney(rpc(), { familyId: FAMILY, accountId: ACCOUNT, amountCents: -100, type: "withdrawal" }));
    await Promise.all([commit, ...withdrawals]);
    const after = await state();
    expect(after.balance_cents).toBe(37);
    expect(after.pending_interest_cents).toBe(0);
    expect(after.txns).toHaveLength(11);
  });
});
