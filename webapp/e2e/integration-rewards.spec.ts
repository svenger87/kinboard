import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createTranslator } from "next-intl";
import en from "../messages/en.json";
import de from "../messages/de.json";
import fr from "../messages/fr.json";
import {
  listRewards, parseRewardRequestBody, requestReward, resolveRef, stageNameFor, type RewardsView,
} from "../src/lib/integration-rewards";
import { decideRedemption, requestRedemption, type RedemptionRow, type RewardNotifier } from "../src/lib/pocket-money/rewards";
import { requireIntegrationAuth, hashIntegrationToken } from "../src/lib/integration-auth";
import { TIER_THRESHOLDS_POINTS } from "../src/lib/pocket-money/types";

/**
 * Points, creatures and rewards through the Integration API (RFC-017
 * follow-up): what GET /rewards reads and from where, what POST
 * /rewards/requests may ask and who hears about it, and which scope each
 * needs.
 *
 * Everything runs against a fake database that applies every filter it is
 * given and records every select and every write, so "the look was never
 * read" is a recorded select list, and "nothing was asked" a count of zero.
 */

const FAMILY = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MIA = "eeeeeeee-eeee-4eee-8eee-000000000001";
const ENNO = "eeeeeeee-eeee-4eee-8eee-000000000002";
const MUM = "eeeeeeee-eeee-4eee-8eee-000000000003";
const BINNED = "eeeeeeee-eeee-4eee-8eee-000000000004";
const NO_CREATURE = "eeeeeeee-eeee-4eee-8eee-000000000005";
const FOREIGN = "eeeeeeee-eeee-4eee-8eee-000000000006";
const SWITCHED_OFF = "eeeeeeee-eeee-4eee-8eee-000000000007";
const MINECRAFT = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const ICE = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const RETIRED = "aaaaaaaa-aaaa-4aaa-8aaa-000000000003";
const THEIRS = "aaaaaaaa-aaaa-4aaa-8aaa-000000000004";
const REQ = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";

/** What a child named their creature: must never appear in anything that leaves. */
const CREATURE_NAME = "Funkel";

type Row = Record<string, unknown>;

function fakeDb(over: Partial<Record<string, Row[]>> = {}, opts: {
  totals?: Record<string, Row | null>;
  rpcAnswer?: (fn: string, args: Row) => { data: unknown; error: { message: string } | null };
} = {}) {
  const tables: Record<string, Row[]> = {
    people: [
      { id: MIA, family_id: FAMILY, name: "Mia", is_child: true, deleted_at: null, created_at: "2026-01-01" },
      { id: ENNO, family_id: FAMILY, name: "Enno", is_child: true, deleted_at: null, created_at: "2026-01-02" },
      { id: MUM, family_id: FAMILY, name: "Mum", is_child: false, deleted_at: null, created_at: "2026-01-03" },
      { id: BINNED, family_id: FAMILY, name: "Binned", is_child: true, deleted_at: "2026-09-30T10:00:00Z", created_at: "2026-01-04" },
      { id: NO_CREATURE, family_id: FAMILY, name: "Ida", is_child: true, deleted_at: null, created_at: "2026-01-05" },
      { id: SWITCHED_OFF, family_id: FAMILY, name: "Ole", is_child: true, deleted_at: null, created_at: "2026-01-06" },
      { id: FOREIGN, family_id: OTHER, name: "Foreign", is_child: true, deleted_at: null, created_at: "2026-01-01" },
    ],
    creatures: [
      { person_id: MIA, family_id: FAMILY, species: "dragon", grows_with: "points", best_tier: 1, enabled: true, look: { name: CREATURE_NAME, body: "#FF8A5B" } },
      { person_id: ENNO, family_id: FAMILY, species: "cat", grows_with: "money", best_tier: 1, enabled: true, look: { name: CREATURE_NAME } },
      // A grown-up with a creature row: not a child, never listed.
      { person_id: MUM, family_id: FAMILY, species: "owl", grows_with: "points", best_tier: 1, enabled: true, look: {} },
      { person_id: BINNED, family_id: FAMILY, species: "fox", grows_with: "points", best_tier: 1, enabled: true, look: {} },
      { person_id: SWITCHED_OFF, family_id: FAMILY, species: "fox", grows_with: "points", best_tier: 1, enabled: false, look: {} },
      { person_id: FOREIGN, family_id: OTHER, species: "fox", grows_with: "points", best_tier: 1, enabled: true, look: {} },
    ],
    pocket_money_accounts: [
      { person_id: ENNO, family_id: FAMILY, balance_cents: 1250, currency: "EUR", avatar_look: { name: CREATURE_NAME } },
      { person_id: FOREIGN, family_id: OTHER, balance_cents: 99999, currency: "EUR" },
    ],
    point_rewards: [
      { id: MINECRAFT, family_id: FAMILY, title: "An hour of Minecraft", icon: "🎮", cost_points: 50, active: true },
      { id: ICE, family_id: FAMILY, title: "Ice cream", icon: null, cost_points: 20, active: true },
      { id: RETIRED, family_id: FAMILY, title: "Cinema", icon: "🎬", cost_points: 300, active: false },
      { id: THEIRS, family_id: OTHER, title: "Pony", icon: "🐴", cost_points: 1, active: true },
    ],
    point_redemptions: [
      { id: REQ, family_id: FAMILY, person_id: MIA, reward_id: MINECRAFT, title: "An hour of Minecraft", icon: "🎮", cost_points: 50, status: "pending", created_at: "2026-10-06T08:00:00Z" },
      { id: "r-done", family_id: FAMILY, person_id: MIA, reward_id: ICE, title: "Ice cream", icon: null, cost_points: 20, status: "approved", created_at: "2026-10-05T08:00:00Z" },
      { id: "r-binned", family_id: FAMILY, person_id: BINNED, reward_id: ICE, title: "Ice cream", icon: null, cost_points: 20, status: "pending", created_at: "2026-10-06T07:00:00Z" },
      { id: "r-theirs", family_id: OTHER, person_id: FOREIGN, reward_id: THEIRS, title: "Pony", icon: "🐴", cost_points: 1, status: "pending", created_at: "2026-10-06T06:00:00Z" },
    ],
    // Awards that, summed, do NOT agree with what point_person_totals says
    // below: the balance must be the database's answer, never a sum taken here.
    todo_point_awards: [{ person_id: MIA, family_id: FAMILY, points: 99999 }],
    settings: [],
    scheduled_notifications: [],
    ...over,
  };
  const totals: Record<string, Row | null> = {
    [MIA]: { earned: 130, spent: 20, pending: 50, balance: 110, owed: 0 },
    [ENNO]: { earned: 0, spent: 0, pending: 0, balance: 0, owed: 0 },
    ...opts.totals,
  };
  const log = { selects: [] as { table: string; columns: string }[], inserts: [] as { table: string; row: Row }[], rpcs: [] as { fn: string; args: Row }[] };

  const db = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let order: { col: string; asc: boolean } | null = null;
      const result = () => {
        let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (order) {
          const { col, asc } = order;
          rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
        }
        return rows;
      };
      const chain: any = {
        select(columns?: string) {
          log.selects.push({ table, columns: columns ?? "" });
          return chain;
        },
        eq(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return chain; },
        is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return chain; },
        in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return chain; },
        order(col: string, o: { ascending?: boolean } = {}) { order = { col, asc: o.ascending !== false }; return chain; },
        async maybeSingle() { return { data: result()[0] ?? null, error: null }; },
        insert(row: Row) {
          log.inserts.push({ table, row });
          (tables[table] ??= []).push(row);
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          return Promise.resolve({ data: result(), error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
    async rpc(fn: string, args: Row) {
      log.rpcs.push({ fn, args });
      if (opts.rpcAnswer) return opts.rpcAnswer(fn, args);
      if (fn === "point_person_totals") {
        if (args.p_family_id !== FAMILY) return { data: null, error: null };
        return { data: totals[args.p_person_id as string] ?? null, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
  };
  return { db, log, tables };
}

const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");

// ── GET /rewards ────────────────────────────────────────────────────────────

test.describe("GET /rewards: points, creature stages, the catalogue and what waits", () => {
  test("only children with a creature switched on, in the family's order, with the database's totals", async () => {
    const { db, log } = fakeDb();
    const view = await listRewards(FAMILY, db, "en");
    expect(view.children.map((c) => c.name)).toEqual(["Mia", "Enno"]);
    expect(view.children[0]).toEqual({
      person_id: MIA,
      name: "Mia",
      points: { balance: 110, earned: 130, owed: 0, pending: 50, available: 60, purchased: 0 },
      creature: {
        species: "dragon",
        stage: 2,
        stage_name: "Hatchling",
        grows_with: "points",
        next_stage: { stage: 3, stage_name: "Lizard", at: TIER_THRESHOLDS_POINTS[2], unit: "points" },
      },
    });
    // Every balance is point_person_totals' answer, one call per child, in our family.
    expect(log.rpcs).toEqual([
      { fn: "point_person_totals", args: { p_family_id: FAMILY, p_person_id: MIA } },
      { fn: "point_person_totals", args: { p_family_id: FAMILY, p_person_id: ENNO } },
    ]);
    expect(log.selects.map((s) => s.table)).not.toContain("todo_point_awards");
  });

  test("a creature that grows with money: the next stage in currency units, with the currency", async () => {
    const { db } = fakeDb();
    const enno = (await listRewards(FAMILY, db, "en")).children.find((c) => c.person_id === ENNO)!;
    // 12.50 EUR: the cat's stage from the balance, the next threshold in euros.
    expect(enno.creature.grows_with).toBe("money");
    expect(enno.creature.next_stage?.unit).toBe("money");
    expect(enno.creature.next_stage?.currency).toBe("EUR");
    expect(enno.creature.next_stage!.at).toBeGreaterThan(12.5);
    expect(Number.isInteger(enno.creature.next_stage!.at * 100)).toBe(true);
    expect(enno.creature.stage_name).toBe(en.pocketMoney.species.cat[`tier${enno.creature.stage}` as "tier1"]);
  });

  test("at the top stage there is no next one", async () => {
    const { db } = fakeDb({}, { totals: { [MIA]: { earned: 1_000_000, spent: 0, pending: 0, balance: 1_000_000, owed: 0 } } });
    const mia = (await listRewards(FAMILY, db, "en")).children[0];
    expect(mia.creature.stage).toBe(8);
    expect(mia.creature.next_stage).toBeNull();
  });

  test("owed is passed through, and available never goes below zero", async () => {
    const { db } = fakeDb({}, { totals: { [MIA]: { earned: 10, spent: 30, pending: 20, balance: 0, owed: 20 } } });
    const mia = (await listRewards(FAMILY, db, "en")).children[0];
    expect(mia.points).toEqual({ balance: 0, earned: 10, owed: 20, pending: 20, available: 0, purchased: 0 });
  });

  test("shop purchases: passed through once point_person_totals reports them (#375), 0 before", async () => {
    const { db } = fakeDb({}, { totals: { [MIA]: { earned: 130, spent: 20, pending: 0, balance: 80, owed: 0, purchased: 30 } } });
    const mia = (await listRewards(FAMILY, db, "en")).children[0];
    // The balance is the database's: earned - approved rewards - purchases.
    expect(mia.points).toEqual({ balance: 80, earned: 130, owed: 0, pending: 0, available: 80, purchased: 30 });
  });

  test("the stage name is in the family's language, and a species without words falls back to the number", async () => {
    expect(stageNameFor("de")("dragon", 2)).toBe(de.pocketMoney.species.dragon.tier2);
    expect(stageNameFor("fr")("dragon", 2)).toBe(fr.pocketMoney.species.dragon.tier2);
    expect(stageNameFor("en")("not-a-species", 4)).toBe("4");
    const { db } = fakeDb();
    const view = await listRewards(FAMILY, db, "de");
    expect(view.locale).toBe("de");
    expect(view.children[0].creature.stage_name).toBe(de.pocketMoney.species.dragon.tier2);
  });

  test("the active rewards of this family only, cheapest first", async () => {
    const { db } = fakeDb();
    expect((await listRewards(FAMILY, db, "en")).rewards).toEqual([
      { id: ICE, title: "Ice cream", icon: null, cost_points: 20 },
      { id: MINECRAFT, title: "An hour of Minecraft", icon: "🎮", cost_points: 50 },
    ]);
  });

  test("pending requests of this family, with the child's name, not those of someone in the recycle bin", async () => {
    const { db } = fakeDb();
    expect((await listRewards(FAMILY, db, "en")).pending).toEqual([{
      id: REQ, person_id: MIA, child_name: "Mia", reward_id: MINECRAFT, title: "An hour of Minecraft",
      icon: "🎮", cost_points: 50, requested_at: "2026-10-06T08:00:00Z",
    }]);
  });

  test("the creature's look and the name the child gave it never leave: not read, not answered", async () => {
    const { db, log } = fakeDb();
    const view: RewardsView = await listRewards(FAMILY, db, "en");
    const json = JSON.stringify(view);
    expect(json).not.toContain(CREATURE_NAME);
    expect(json).not.toContain("look");
    expect(json).not.toContain("#FF8A5B");
    for (const { table, columns } of log.selects.filter((s) => s.table === "creatures" || s.table === "pocket_money_accounts")) {
      expect(columns, table).not.toMatch(/\*|look|^$/);
    }
    // The creature object is exactly these keys, and the OpenAPI schema says so too.
    expect(Object.keys(view.children[0].creature).sort()).toEqual(["grows_with", "next_stage", "species", "stage", "stage_name"]);
  });

  test("a failed read is an error, not an empty family", async () => {
    const { db } = fakeDb({}, { rpcAnswer: () => ({ data: null, error: { message: "boom" } }) });
    await expect(listRewards(FAMILY, db, "en")).rejects.toThrow("boom");
  });
});

// ── POST /rewards/requests ─────────────────────────────────────────────────

function recordingNotifier() {
  const calls = { requested: [] as { redemption: RedemptionRow; source: string | null }[], decided: [] as unknown[] };
  const notifier: RewardNotifier = {
    requested: async (redemption, source) => { calls.requested.push({ redemption, source }); },
    decided: async (...args) => { calls.decided.push(args); },
  };
  return { notifier, calls };
}

const redemptionRow = (over: Partial<RedemptionRow> = {}): RedemptionRow => ({
  id: "cccccccc-cccc-4ccc-8ccc-000000000001", family_id: FAMILY, person_id: MIA, reward_id: MINECRAFT,
  title: "An hour of Minecraft", icon: "🎮", cost_points: 50, created_at: "2026-10-06T09:00:00Z", ...over,
});

function askingDb(answer: unknown = { ok: true, redemption: redemptionRow() }) {
  return fakeDb({}, {
    rpcAnswer: (fn) => fn === "request_person_point_redemption"
      ? { data: answer, error: null }
      : { data: null, error: { message: `unexpected ${fn}` } },
  });
}

test.describe("POST /rewards/requests: asks as the child would, and only asks", () => {
  test("by id: one request_person_point_redemption in our family, with no device, and the parents are told", async () => {
    const { db, log } = askingDb();
    const { notifier, calls } = recordingNotifier();
    const res = await requestReward({ familyId: FAMILY, body: { child: MIA, reward: MINECRAFT } }, { db, notifier });
    expect(res).toEqual({
      status: 201,
      body: {
        status: "pending_approval",
        redemption: {
          id: "cccccccc-cccc-4ccc-8ccc-000000000001", person_id: MIA, child_name: "Mia", reward_id: MINECRAFT,
          title: "An hour of Minecraft", icon: "🎮", cost_points: 50, requested_at: "2026-10-06T09:00:00Z",
        },
      },
    });
    expect(log.rpcs).toEqual([{
      fn: "request_person_point_redemption",
      args: { p_family_id: FAMILY, p_person_id: MIA, p_reward_id: MINECRAFT, p_device_id: null },
    }]);
    expect(calls.requested).toEqual([{ redemption: redemptionRow(), source: null }]);
    expect(calls.decided).toEqual([]);
  });

  test("by name and title, ignoring case and spaces", async () => {
    const { db, log } = askingDb();
    const { notifier } = recordingNotifier();
    const res = await requestReward({ familyId: FAMILY, body: { child: "  mia ", reward: "an HOUR of minecraft" } }, { db, notifier });
    expect(res.status).toBe(201);
    expect(log.rpcs[0].args).toMatchObject({ p_person_id: MIA, p_reward_id: MINECRAFT });
  });

  test("whom it cannot be for: nobody, a grown-up, someone binned, another family's child -- 400 no_child, nothing asked", async () => {
    for (const child of ["Nobody", "Mum", MUM, BINNED, "Binned", FOREIGN, "Foreign", "00000000-0000-4000-8000-000000000000"]) {
      const { db, log } = askingDb();
      const { notifier, calls } = recordingNotifier();
      const res = await requestReward({ familyId: FAMILY, body: { child, reward: MINECRAFT } }, { db, notifier });
      expect(res.status, child).toBe(400);
      expect(res.body, child).toMatchObject({ code: "invalid_request", reason: "no_child" });
      expect(log.rpcs, child).toEqual([]);
      expect(calls.requested, child).toEqual([]);
    }
  });

  test("what it cannot be: an unknown, retired or other family's reward -- 400 no_reward, nothing asked", async () => {
    for (const reward of ["Pony", THEIRS, RETIRED, "Cinema", "Nothing"]) {
      const { db, log } = askingDb();
      const { notifier } = recordingNotifier();
      const res = await requestReward({ familyId: FAMILY, body: { child: MIA, reward } }, { db, notifier });
      expect(res.body, reward).toMatchObject({ code: "invalid_request", reason: "no_reward" });
      expect(log.rpcs, reward).toEqual([]);
    }
  });

  test("two children of one name, or two rewards of one title: ambiguous, send the id", async () => {
    const twins = fakeDb({
      people: [
        { id: MIA, family_id: FAMILY, name: "Mia", is_child: true, deleted_at: null },
        { id: ENNO, family_id: FAMILY, name: "mia", is_child: true, deleted_at: null },
      ],
      point_rewards: [
        { id: MINECRAFT, family_id: FAMILY, title: "Treat", cost_points: 5, active: true },
        { id: ICE, family_id: FAMILY, title: "TREAT", cost_points: 9, active: true },
      ],
    });
    const { notifier } = recordingNotifier();
    expect((await requestReward({ familyId: FAMILY, body: { child: "Mia", reward: MINECRAFT } }, { db: twins.db, notifier })).body)
      .toMatchObject({ reason: "ambiguous_child" });
    expect((await requestReward({ familyId: FAMILY, body: { child: MIA, reward: "treat" } }, { db: twins.db, notifier })).body)
      .toMatchObject({ reason: "ambiguous_reward" });
    expect(twins.log.rpcs).toEqual([]);
  });

  test("the database's refusals: 409 no_creature and insufficient_points, 400 for a race; nobody told", async () => {
    for (const [answer, status, reason] of [
      [{ ok: false, error: "no_creature" }, 409, "no_creature"],
      [{ ok: false, error: "insufficient_points", balance: 10, pending: 0 }, 409, "insufficient_points"],
      [{ ok: false, error: "no_reward" }, 400, "no_reward"],
      [{ ok: false, error: "not_found" }, 400, "no_child"],
    ] as const) {
      const { db } = askingDb(answer);
      const { notifier, calls } = recordingNotifier();
      const res = await requestReward({ familyId: FAMILY, body: { child: MIA, reward: MINECRAFT } }, { db, notifier });
      expect(res.status, reason).toBe(status);
      expect(res.body, reason).toMatchObject({ reason });
      expect(calls.requested, reason).toEqual([]);
    }
    const { db } = askingDb({ ok: false, error: "insufficient_points", balance: 10, pending: 40 });
    expect((await requestReward({ familyId: FAMILY, body: { child: MIA, reward: MINECRAFT } }, { db, notifier: recordingNotifier().notifier })).body)
      .toMatchObject({ balance: 10, pending: 40 });
  });

  test("an unexpected answer is an error, never a 201", async () => {
    const { db } = askingDb({ ok: "maybe" });
    await expect(requestReward({ familyId: FAMILY, body: { child: MIA, reward: MINECRAFT } }, { db, notifier: recordingNotifier().notifier }))
      .rejects.toThrow();
  });

  test("the body is checked first", () => {
    for (const bad of [null, [], "x", {}, { child: MIA }, { reward: MINECRAFT }, { child: "", reward: MINECRAFT }, { child: MIA, reward: 5 }, { child: "x".repeat(201), reward: MINECRAFT }]) {
      expect(parseRewardRequestBody(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(parseRewardRequestBody({ child: " Mia ", reward: MINECRAFT })).toEqual({ ok: true, child: "Mia", reward: MINECRAFT });
  });

  test("an id is only ever matched as an id: a title that looks like another reward's id cannot take it over", () => {
    const rows = [{ id: MINECRAFT, title: ICE }, { id: ICE, title: "Ice" }];
    expect(resolveRef(rows, ICE, (r) => r.title)).toEqual({ ok: true, row: rows[1] });
  });
});

test.describe("the notifier is part of every ask and every decision", () => {
  test("requestRedemption tells it once on success, with the asking device, and not on a refusal", async () => {
    const ok = fakeDb({}, { rpcAnswer: () => ({ data: { ok: true, redemption: redemptionRow() }, error: null }) });
    const { notifier, calls } = recordingNotifier();
    await requestRedemption(ok.db, { familyId: FAMILY, personId: MIA, rewardId: MINECRAFT, deviceId: "dddddddd-dddd-4ddd-8ddd-000000000001" }, notifier);
    expect(calls.requested).toEqual([{ redemption: redemptionRow(), source: "dddddddd-dddd-4ddd-8ddd-000000000001" }]);
    const no = fakeDb({}, { rpcAnswer: () => ({ data: { ok: false, error: "insufficient_points" }, error: null }) });
    await requestRedemption(no.db, { familyId: FAMILY, personId: MIA, rewardId: MINECRAFT, deviceId: null }, notifier);
    expect(calls.requested).toHaveLength(1);
  });

  test("decideRedemption tells it the decision, and not when nothing was decided", async () => {
    const { notifier, calls } = recordingNotifier();
    for (const status of ["approved", "denied"] as const) {
      const ok = fakeDb({}, { rpcAnswer: () => ({ data: { ok: true, status }, error: null }) });
      await decideRedemption(ok.db, { familyId: FAMILY, redemptionId: REQ, decision: status, deviceId: null }, notifier);
    }
    expect(calls.decided).toEqual([[FAMILY, REQ, "approved"], [FAMILY, REQ, "denied"]]);
    const no = fakeDb({}, { rpcAnswer: () => ({ data: { ok: false, error: "already_decided" }, error: null }) });
    await decideRedemption(no.db, { familyId: FAMILY, redemptionId: REQ, decision: "approved", deviceId: null }, notifier);
    expect(calls.decided).toHaveLength(2);
  });

  test("a notifier that throws never undoes the request", async () => {
    const ok = fakeDb({}, { rpcAnswer: () => ({ data: { ok: true, redemption: redemptionRow() }, error: null }) });
    const throwing: RewardNotifier = { requested: async () => { throw new Error("push down"); }, decided: async () => { throw new Error("push down"); } };
    expect((await requestRedemption(ok.db, { familyId: FAMILY, personId: MIA, rewardId: MINECRAFT, deviceId: null }, throwing)).status).toBe(201);
  });

  test("every route that asks or decides passes the live notifier", () => {
    for (const path of [
      "src/app/api/rewards/redemptions/route.ts",
      "src/app/api/rewards/redemptions/[id]/route.ts",
      "src/app/api/pocket-money/accounts/[id]/redemptions/route.ts",
      "src/app/api/integration/v1/rewards/requests/route.ts",
    ]) {
      expect(read(...path.split("/")), path).toMatch(/liveRewardNotifier\(db\)/);
    }
  });
});

// ── scopes ──────────────────────────────────────────────────────────────────

test.describe("scopes: reading is family:read, asking is pocket_money:write, approving is nobody's", () => {
  const routes = join(__dirname, "..", "src", "app", "api", "integration", "v1", "rewards");

  test("each route names exactly its scope", () => {
    const list = read("src", "app", "api", "integration", "v1", "rewards", "route.ts");
    const ask = read("src", "app", "api", "integration", "v1", "rewards", "requests", "route.ts");
    expect(list.match(/withIntegrationAuth\(request, "([a-z_:]+)"/g)).toEqual(['withIntegrationAuth(request, "family:read"']);
    expect(list).not.toMatch(/export async function (POST|PATCH|DELETE)/);
    expect(ask.match(/withIntegrationAuth\(request, "([a-z_:]+)"/g)).toEqual(['withIntegrationAuth(request, "pocket_money:write"']);
    expect(ask).not.toMatch(/export async function (GET|PATCH|DELETE)/);
    expect(readdirSync(routes).sort()).toEqual(["requests", "route.ts"]);
  });

  test("a family:read token cannot ask; a pocket_money:write token can, and family:read alone reads", async () => {
    const token = "kbi_test-rewards-token";
    const row = (scopes: string[]) => async () => ({
      id: "t1", family_id: FAMILY, name: "HA", scopes, token_hash: hashIntegrationToken(token),
      expires_at: null, revoked_at: null, last_used_at: null, oauth_client_id: null,
    });
    const request = { headers: new Headers({ authorization: `Bearer ${token}` }) } as unknown as NextRequest;
    expect((await requireIntegrationAuth(request, "pocket_money:write", row(["family:read"]))).ok).toBe(false);
    expect((await requireIntegrationAuth(request, "pocket_money:write", row(["family:read", "tasks:write", "home:control"]))).ok).toBe(false);
    expect((await requireIntegrationAuth(request, "pocket_money:write", row(["pocket_money:write"]))).ok).toBe(true);
    expect((await requireIntegrationAuth(request, "family:read", row(["pocket_money:write"]))).ok).toBe(false);
    expect((await requireIntegrationAuth(request, "family:read", row(["family:read"]))).ok).toBe(true);
  });

  test("nothing a token can reach decides a request: no outward code calls decide_point_redemption", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const f = join(d, e);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.tsx?$/.test(f)) files.push(f);
      }
    };
    walk(join(__dirname, "..", "src", "app", "api", "integration"));
    walk(join(__dirname, "..", "src", "lib", "mcp"));
    walk(join(__dirname, "..", "src", "app", "api", "mcp"));
    for (const f of readdirSync(join(__dirname, "..", "src", "lib")).filter((n) => /^integration-.*\.ts$/.test(n))) {
      files.push(join(__dirname, "..", "src", "lib", f));
    }
    expect(files.some((f) => f.endsWith("integration-rewards.ts"))).toBe(true);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/decide_point_redemption|decideRedemption/);
    }
    // The one place that decides is the session route, behind the settings PIN.
    const decide = read("src", "app", "api", "rewards", "redemptions", "[id]", "route.ts");
    expect(decide).toContain("await requireSession(request)");
    expect(decide).toContain("await requireSettingsUnlock(auth.session)");
  });

  test("an assistant's asks spend its edit budget, after a replay is answered and before anything is asked", () => {
    const ask = read("src", "app", "api", "integration", "v1", "rewards", "requests", "route.ts");
    const spend = ask.indexOf("const limited = destructiveLimitResponse(context);");
    expect(spend).toBeGreaterThan(-1);
    expect(ask.match(/destructiveLimitResponse\(context\)/g)).toHaveLength(1);
    // After the replay has been answered (free) ...
    expect(spend).toBeGreaterThan(ask.indexOf('headers: { "idempotent-replay": "true" }'));
    // ... and before the request is made.
    expect(spend).toBeLessThan(ask.indexOf("await requestReward("));
    expect(ask.slice(spend)).toMatch(/^const limited = destructiveLimitResponse\(context\);\s*if \(limited\) return limited;/);
  });

  test("a replay with the same key answers the same request; only a 201 is remembered", () => {
    const ask = read("src", "app", "api", "integration", "v1", "rewards", "requests", "route.ts");
    expect(ask).toContain("validateIdempotencyKey(");
    expect(ask).toContain('fingerprintRequest("rewards/requests", body)');
    expect(ask).toMatch(/if \(result\.status === 201\) \{\s*await storeResult/);
  });
});

// ── translations ────────────────────────────────────────────────────────────

test("every language has the stage names the API answers with", () => {
  const species = Object.keys(en.pocketMoney.species);
  for (const [locale, dict] of [["de", de], ["fr", fr]] as const) {
    for (const s of species) {
      for (let tier = 1; tier <= 8; tier++) {
        const t = createTranslator({ locale, messages: dict, namespace: "pocketMoney" });
        expect(t(`species.${s}.tier${tier}` as never), `${locale} ${s} ${tier}`).not.toContain("species.");
      }
    }
  }
});
