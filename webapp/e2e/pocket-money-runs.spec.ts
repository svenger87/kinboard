import { test, expect } from "@playwright/test";
import {
  accrueInterest, commitInterest, decideWithdrawal, processAllowance, type PocketMoneyClient,
} from "../src/lib/pocket-money/runs";
import { applyDailyAccrual } from "../src/lib/pocket-money/interest";

/**
 * What the scheduled pocket-money runs and the withdrawal decision ask the
 * database to do (lib/pocket-money/runs.ts), against a fake client that
 * records every RPC. Each balance change is one SQL call, so the arguments of
 * that call — amount, type, note, goal, decider, the period claimed — are the
 * behaviour. The SQL functions themselves are proved against a real database
 * in pocket-money-live.spec.ts.
 */

const NOW = new Date("2026-10-01T06:00:00.000Z"); // a Thursday (UTC day 4)
const DAY = 24 * 60 * 60 * 1000;
const FAMILY = "11111111-1111-1111-1111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const PERSON = "33333333-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;
type RpcAnswer = { data: unknown; error: { message: string } | null };

function fakeClient(opts: {
  tables?: Record<string, Row[]>;
  counts?: (filters: [string, unknown][]) => number;
  rpc?: (fn: string, args: Record<string, unknown>) => RpcAnswer;
} = {}) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const reads: { table: string; filters: [string, unknown][] }[] = [];
  const client: PocketMoneyClient = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      reads.push({ table, filters });
      const chain = {
        select() { return chain; },
        eq(c: string, v: unknown) { filters.push([c, v]); return chain; },
        gt(c: string, v: unknown) { filters.push([`${c}>`, v]); return chain; },
        gte(c: string, v: unknown) { filters.push([`${c}>=`, v]); return chain; },
        then(resolve: (v: unknown) => void) {
          resolve({ data: opts.tables?.[table] ?? [], error: null, count: opts.counts ? opts.counts(filters) : 0 });
        },
      };
      return chain;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      return opts.rpc ? opts.rpc(fn, args) : { data: { ok: true, balance_cents: 0, amount_cents: 0, transaction: {} }, error: null };
    },
  };
  return { client, rpcs, reads };
}

test.describe("the allowance cron pays and claims the period in one call", () => {
  const accounts: Row[] = [
    { id: "weekly", family_id: FAMILY, weekly_allowance_cents: 250, allowance_interval_days: 7, last_allowance_at: null },
    { id: "biweekly", family_id: FAMILY, weekly_allowance_cents: 500, allowance_interval_days: 14, last_allowance_at: new Date(NOW.getTime() - 14 * DAY).toISOString() },
    { id: "paid-this-week", family_id: FAMILY, weekly_allowance_cents: 250, allowance_interval_days: 7, last_allowance_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString() },
    // Paid three days ago, on another weekday: the parent moved the day, so it is paid now.
    { id: "moved-day", family_id: FAMILY, weekly_allowance_cents: 100, allowance_interval_days: 7, last_allowance_at: new Date(NOW.getTime() - 3 * DAY).toISOString() },
  ];

  test("each due account: one pay_pocket_money_allowance with its amount, note and the period it read", async () => {
    const { client, rpcs, reads } = fakeClient({ tables: { pocket_money_accounts: accounts } });
    expect(await processAllowance(client, NOW)).toEqual({ deposited: 3 });
    expect(reads[0]).toEqual({ table: "pocket_money_accounts", filters: [["allowance_day_of_week", 4], ["weekly_allowance_cents>", 0]] });
    expect(rpcs).toEqual([
      { fn: "pay_pocket_money_allowance", args: { p_account_id: "weekly", p_amount_cents: 250, p_note: "Weekly allowance", p_expected_last: null } },
      { fn: "pay_pocket_money_allowance", args: { p_account_id: "biweekly", p_amount_cents: 500, p_note: "Allowance (every 14 days)", p_expected_last: accounts[1].last_allowance_at } },
      { fn: "pay_pocket_money_allowance", args: { p_account_id: "moved-day", p_amount_cents: 100, p_note: "Weekly allowance", p_expected_last: accounts[3].last_allowance_at } },
    ]);
  });

  test("a period another run claimed, or a refused payment, is not counted as paid", async () => {
    const { client } = fakeClient({
      tables: { pocket_money_accounts: accounts.slice(0, 2) },
      rpc: (_fn, args) => args.p_account_id === "weekly"
        ? { data: { ok: false, error: "already_paid" }, error: null }
        : { data: null, error: { message: "allowance not booked" } },
    });
    expect(await processAllowance(client, NOW)).toEqual({ deposited: 0 });
  });
});

test.describe("interest is accrued and committed as deltas", () => {
  test("accrue: each account not yet accrued today, with applyDailyAccrual's cents and carry", async () => {
    const rows: Row[] = [
      { id: "a", balance_cents: 10_000, max_balance_eligible_cents: 50_000, apr_bps: 1000, pending_interest_cents: 4, pending_interest_micros: 500_000, last_accrued_date: null },
      { id: "done", balance_cents: 10_000, max_balance_eligible_cents: 50_000, apr_bps: 1000, pending_interest_cents: 0, pending_interest_micros: 0, last_accrued_date: "2026-10-01" },
      { id: "raced", balance_cents: 100, max_balance_eligible_cents: 50_000, apr_bps: 1000, pending_interest_cents: 0, pending_interest_micros: 0, last_accrued_date: "2026-09-30" },
    ];
    const { client, rpcs } = fakeClient({
      tables: { pocket_money_accounts: rows },
      rpc: (_fn, args) => ({ data: args.p_account_id === "a", error: null }), // "raced": another run got there first
    });
    expect(await accrueInterest(client, NOW)).toEqual({ updated: 1, processed: 3 });
    const a = applyDailyAccrual({ balanceCents: 10_000, maxBalanceEligibleCents: 50_000, aprBps: 1000, carryMicros: 500_000 });
    const raced = applyDailyAccrual({ balanceCents: 100, maxBalanceEligibleCents: 50_000, aprBps: 1000, carryMicros: 0 });
    expect(rpcs).toEqual([
      { fn: "accrue_pocket_money_interest", args: { p_account_id: "a", p_add_cents: a.addCents, p_carry_micros: a.carryMicros, p_today: "2026-10-01" } },
      { fn: "accrue_pocket_money_interest", args: { p_account_id: "raced", p_add_cents: raced.addCents, p_carry_micros: raced.carryMicros, p_today: "2026-10-01" } },
    ]);
  });

  test("commit: commit_pocket_money_interest with \"Daily interest\", skipping an account committed in the last 23 hours", async () => {
    const { client, rpcs, reads } = fakeClient({
      tables: { pocket_money_accounts: [{ id: "a", pending_interest_cents: 37 }, { id: "recent", pending_interest_cents: 5 }, { id: "zero", pending_interest_cents: 0 }] },
      counts: (filters) => (filters.some(([c, v]) => c === "account_id" && v === "recent") ? 1 : 0),
      rpc: () => ({ data: { ok: true, amount_cents: 37, balance_cents: 1037 }, error: null }),
    });
    expect(await commitInterest(client, NOW)).toEqual({ committed: 1 });
    expect(rpcs).toEqual([{ fn: "commit_pocket_money_interest", args: { p_account_id: "a", p_note: "Daily interest" } }]);
    const since = reads.find((r) => r.table === "pocket_money_transactions")!.filters.find(([c]) => c === "created_at>=");
    expect(since?.[1]).toBe(new Date(NOW.getTime() - 23 * 60 * 60 * 1000).toISOString());
  });

  test("commit: nothing pending by the time it ran is not counted", async () => {
    const { client } = fakeClient({
      tables: { pocket_money_accounts: [{ id: "a", pending_interest_cents: 37 }] },
      rpc: () => ({ data: { ok: false, error: "nothing_pending" }, error: null }),
    });
    expect(await commitInterest(client, NOW)).toEqual({ committed: 0 });
  });
});

test.describe("a withdrawal request is decided in one call", () => {
  const decide = (answer: RpcAnswer, decision: "approved" | "denied" = "approved") => {
    const { client, rpcs } = fakeClient({ rpc: () => answer });
    return decideWithdrawal(client, { familyId: FAMILY, requestId: REQUEST, decision, personId: PERSON })
      .then((result) => ({ result, rpcs }));
  };

  test("asks decide_pocket_money_withdrawal with the family, the request, the decision and the decider", async () => {
    const { result, rpcs } = await decide({ data: { ok: true, status: "approved" }, error: null });
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(rpcs).toEqual([{ fn: "decide_pocket_money_withdrawal", args: {
      p_family_id: FAMILY, p_request_id: REQUEST, p_decision: "approved", p_person_id: PERSON,
    } }]);
    expect((await decide({ data: { ok: true, status: "denied" }, error: null }, "denied")).rpcs[0].args.p_decision).toBe("denied");
  });

  test("answers as the route always did, and clean 400s where the booking would have raised", async () => {
    const cases: [unknown, number, string | true][] = [
      [{ ok: false, error: "not_found" }, 404, "not found"],
      [{ ok: false, error: "already_decided", status: "approved" }, 409, "already_decided"],
      [{ ok: false, error: "insufficient_funds" }, 409, "insufficient_funds_at_decide_time"],
      [{ ok: false, error: "invalid_goal" }, 400, "the request's goal is not one of this account's goals"],
      [{ ok: false, error: "invalid_person" }, 400, "parent_decided_by_person_id is not a person of this family"],
      [{ ok: false, error: "weird" }, 500, "unexpected answer from decide_pocket_money_withdrawal"],
    ];
    for (const [data, status, error] of cases) {
      expect((await decide({ data, error: null })).result, JSON.stringify(data)).toEqual({ status, body: { error } });
    }
    expect((await decide({ data: null, error: { message: "db down" } })).result).toEqual({ status: 500, body: { error: "db down" } });
  });
});
