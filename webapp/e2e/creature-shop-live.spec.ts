import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../src/lib/supabase/server";
import { mintFamilyToken } from "../src/lib/family-jwt";
import type { RpcClient } from "../src/lib/pocket-money/booking";
import { buyItem, refundPurchase } from "../src/lib/creatures/purchases";
import { decideRedemption, requestRedemption, silentRewardNotifier } from "../src/lib/pocket-money/rewards";
import { pointTotals, tierFromPoints } from "../src/lib/pocket-money/points";
import { postJoin } from "./session";
import { acquireWholeDatabase, dbContainer, releaseWholeDatabase } from "./whole-database";

/**
 * The creature shop (RFC-017 §5) against a running stack:
 *
 *   the database  purchase_person_point_item() buys atomically under the
 *                 child's lock, never overdraws, never sells an item twice,
 *                 refuses with the shop off or no creature switched on; the
 *                 balance (point_person_totals and its TS mirror) counts
 *                 purchases, and so do a reward request and its approval;
 *                 the browser's token reads and writes nothing
 *   the migration applied twice in a transaction, rolled back
 *   the routes    the price is the catalogue's, only owned items can be
 *                 worn, a backup carries the purchases
 *
 * The browser half is creature-shop-ui-live.spec.ts.
 *
 * In a family of its own, `claude-shop`, created here and removed with its
 * devices afterwards. Needs FAMILY_CODE (a stack) and the service-role env.
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");
test.describe.configure({ mode: "serial" });

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const ID = (n: string) => `c1a0de00-0217-4000-8000-00000000${n}`;
const FAMILY = ID("f001");
const OTHER = ID("f002");
const KID = ID("f0a1");
const KID2 = ID("f0a2");
const REWARD = ID("f0d1");
const JOIN_CODE = "CLAUDESHOP";
const DEVICES = ["claude-shop-api"];

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  ).trim();
}

function purge() {
  psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
    DELETE FROM devices WHERE family_id IN ('${FAMILY}', '${OTHER}') OR hardware_id LIKE '%claude-shop%';
    DELETE FROM families WHERE id IN ('${FAMILY}', '${OTHER}') OR name LIKE 'claude-shop-restored%';
    DELETE FROM people WHERE id IN ('${KID}', '${KID2}');`);
}

let db: any;
const rpc = () => db as RpcClient;
const buy = (itemId: string, personId = KID, familyId = FAMILY) => buyItem(rpc(), { familyId, personId, itemId });

/** The child has earned exactly `points`, owns nothing, has no requests, and a creature with the shop on. */
function reset(points: number, child = KID) {
  psql(`DELETE FROM point_purchases WHERE person_id = '${child}';
    DELETE FROM point_redemptions WHERE person_id = '${child}';
    DELETE FROM todo_point_awards WHERE person_id = '${child}';
    ${points > 0 ? `INSERT INTO todo_point_awards (family_id, person_id, completion_key, points) VALUES ('${FAMILY}', '${child}', 'claude-shop', ${points});` : ""}
    UPDATE creatures SET enabled = true, shop_enabled = true, look = '{}'::jsonb, style = 'gumdrop' WHERE person_id = '${child}';`);
}

async function totals(child = KID) {
  const { data, error } = await db.rpc("point_person_totals", { p_family_id: FAMILY, p_person_id: child });
  if (error) throw error;
  return data as { earned: number; spent: number; purchased: number; pending: number; balance: number; owed: number };
}

/** The TS mirror over the rows, as the screens compute it. */
function mirror(child = KID) {
  const earned = Number(psql(`SELECT COALESCE(sum(points), 0) FROM todo_point_awards WHERE person_id = '${child}'`));
  const red = psql(`SELECT cost_points || ':' || status FROM point_redemptions WHERE person_id = '${child}'`).split("\n").filter(Boolean)
    .map((l) => ({ cost_points: Number(l.split(":")[0]), status: l.split(":")[1] as "pending" | "approved" | "denied" }));
  const pur = psql(`SELECT cost FROM point_purchases WHERE person_id = '${child}'`).split("\n").filter(Boolean).map((c) => ({ cost: Number(c) }));
  return pointTotals(earned, red, pur);
}

const owned = (child = KID) => psql(`SELECT string_agg(item_id, ',' ORDER BY item_id) FROM point_purchases WHERE person_id = '${child}'`);

test.beforeAll(() => {
  db = createAdminClient();
  purge();
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES ('${FAMILY}', 'claude-shop', '${JOIN_CODE}', true),
      ('${OTHER}', 'claude-shop-other', 'CLAUDESHOO', true);
    INSERT INTO people (id, family_id, name, is_child, color) VALUES
      ('${KID}', '${FAMILY}', 'claude-Mia', true, '#56B6E8'), ('${KID2}', '${FAMILY}', 'claude-Ben', true, '#E85656');
    INSERT INTO creatures (person_id, family_id, species, style, enabled, shop_enabled) VALUES
      ('${KID}', '${FAMILY}', 'dragon', 'gumdrop', true, true), ('${KID2}', '${FAMILY}', 'princess', 'sticker', true, true);
    INSERT INTO point_rewards (id, family_id, title, cost_points, active) VALUES ('${REWARD}', '${FAMILY}', 'claude-shop film', 60, true);`);
});

test.afterAll(() => {
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE id IN ('${FAMILY}', '${OTHER}') OR name LIKE 'claude-shop%'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM devices WHERE hardware_id LIKE '%claude-shop%'`)).toBe("0");
});

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

test.describe("buying", () => {
  test("spends the catalogue's price at once; the balance counts it, in SQL and in the mirror alike", async () => {
    reset(100);
    const answer = await buy("wizard_hat");
    expect(answer.status).toBe(201);
    expect(answer.body).toMatchObject({ purchase: { person_id: KID, item_id: "wizard_hat", cost: 40 }, balance: 60 });
    expect(await totals()).toEqual({ earned: 100, spent: 0, purchased: 40, pending: 0, balance: 60, owed: 0 });
    const m = mirror();
    expect({ earned: m.earned, spent: m.spent, purchased: m.purchased, pending: m.pending, balance: m.balance, owed: m.owed }).toEqual(await totals());
    // The stage follows points earned: buying never shrinks the creature.
    expect(tierFromPoints((await totals()).earned)).toBe(tierFromPoints(100));
  });

  test("cannot overdraw, and holds what is waiting for a parent", async () => {
    reset(30);
    expect(await buy("wizard_hat")).toEqual({ status: 409, body: { error: "insufficient_points", balance: 30, pending: 0 } });
    expect(owned()).toBe("");
    reset(50);
    psql(`INSERT INTO point_redemptions (family_id, person_id, title, cost_points) VALUES ('${FAMILY}', '${KID}', 'claude-shop wait', 30)`);
    expect(await buy("cap")).toEqual({ status: 409, body: { error: "insufficient_points", balance: 50, pending: 30 } });
    expect((await buy("heart_glasses")).status).toBe(201);
    expect(await totals()).toMatchObject({ purchased: 20, pending: 30, balance: 30 });
  });

  test("the same item twice: bought once, charged once", async () => {
    reset(100);
    expect((await buy("scarf")).status).toBe(201);
    expect(await buy("scarf")).toEqual({ status: 409, body: { error: "already_owned" } });
    expect(await totals()).toMatchObject({ purchased: 20, balance: 80 });
  });

  test("refused with the shop off, the creature off or missing, a binned child or another family", async () => {
    reset(500);
    psql(`UPDATE creatures SET shop_enabled = false WHERE person_id = '${KID}'`);
    expect(await buy("cap")).toEqual({ status: 409, body: { error: "shop_off" } });
    psql(`UPDATE creatures SET shop_enabled = true, enabled = false WHERE person_id = '${KID}'`);
    expect(await buy("cap")).toEqual({ status: 409, body: { error: "no_creature" } });
    psql(`UPDATE creatures SET enabled = true WHERE person_id = '${KID}'`);
    expect(await buy("cap", KID, OTHER)).toEqual({ status: 404, body: { error: "not found" } });
    psql(`UPDATE people SET deleted_at = now() WHERE id = '${KID}'`);
    expect(await buy("cap")).toEqual({ status: 404, body: { error: "not found" } });
    psql(`UPDATE people SET deleted_at = NULL WHERE id = '${KID}'`);
    const backup = psql(`SELECT to_jsonb(c)::text FROM creatures c WHERE person_id = '${KID}'`);
    psql(`DELETE FROM creatures WHERE person_id = '${KID}'`);
    expect(await buy("cap")).toEqual({ status: 409, body: { error: "no_creature" } });
    psql(`INSERT INTO creatures SELECT * FROM jsonb_populate_record(NULL::creatures, '${backup.replace(/'/g, "''")}'::jsonb)`);
    expect(owned()).toBe("");
    expect(await buy("gold_bar")).toEqual({ status: 404, body: { error: "no_item" } });
  });

  test("ten taps at once on one item: one purchase", async () => {
    for (let round = 0; round < 5; round++) {
      reset(100);
      const answers = await Promise.all(Array.from({ length: 10 }, () => buy("medal")));
      expect(answers.filter((a) => a.status === 201), `round ${round}`).toHaveLength(1);
      expect(answers.filter((a) => a.status === 409), `round ${round}`).toHaveLength(9);
      expect(await totals()).toMatchObject({ purchased: 35, balance: 65 });
    }
  });

  test("six items racing for 60 points: never more than 60 spent", async () => {
    const items = ["heart_glasses", "scarf", "bow_tie", "monocle", "cap", "headphones"];
    for (let round = 0; round < 5; round++) {
      reset(60);
      const answers = await Promise.all(items.map((i) => buy(i)));
      const t = await totals();
      expect(t.purchased, `round ${round}`).toBeLessThanOrEqual(60);
      expect(t.balance, `round ${round}`).toBe(60 - t.purchased);
      expect(t.owed).toBe(0);
      const made = answers.filter((a) => a.status === 201).length;
      expect(Number(psql(`SELECT count(*) FROM point_purchases WHERE person_id = '${KID}'`)), `round ${round}`).toBe(made);
      // Whatever was refused was refused for want of points.
      for (const a of answers.filter((x) => x.status !== 201)) expect(a.body.error).toBe("insufficient_points");
    }
  });

  test("a reward request and its approval see the purchases", async () => {
    reset(100);
    expect((await buy("rainbow")).status).toBe(201);
    expect(await requestRedemption(rpc(), { familyId: FAMILY, personId: KID, rewardId: REWARD, deviceId: null }, silentRewardNotifier))
      .toEqual({ status: 409, body: { error: "insufficient_points", balance: 20, pending: 0 } });
    const id = psql(`INSERT INTO point_redemptions (family_id, person_id, title, cost_points) VALUES ('${FAMILY}', '${KID}', 'claude-shop late', 30) RETURNING id`).split("\n")[0];
    expect(await decideRedemption(rpc(), { familyId: FAMILY, redemptionId: id, decision: "approved", deviceId: null }, silentRewardNotifier))
      .toEqual({ status: 409, body: { error: "insufficient_points", balance: 20 } });
  });

  test("a purchase and a reward request at once, together past the balance: exactly one goes through", async () => {
    for (let round = 0; round < 5; round++) {
      reset(100);
      // 80 + 60 > 100: whichever is served first under the child's lock wins.
      const [bought, asked] = await Promise.all([
        buy("rainbow"),
        requestRedemption(rpc(), { familyId: FAMILY, personId: KID, rewardId: REWARD, deviceId: null }, silentRewardNotifier),
      ]);
      expect([bought.status, asked.status].filter((s) => s === 201), `round ${round}`).toHaveLength(1);
      const t = await totals();
      expect(t.balance - t.pending, `round ${round}`).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe("a parent's refund", () => {
  const refund = (purchaseId: string, familyId = FAMILY) => refundPurchase(rpc(), { familyId, purchaseId });
  const idOf = (item: string) => psql(`SELECT id FROM point_purchases WHERE person_id = '${KID}' AND item_id = '${item}'`);
  const lookOf = () => psql(`SELECT look::text FROM creatures WHERE person_id = '${KID}'`);

  test("gives the points back and deletes the purchase; the item can be bought again", async () => {
    reset(100);
    expect((await buy("wizard_hat")).status).toBe(201);
    const id = idOf("wizard_hat");
    expect(await refund(id)).toEqual({ status: 200, body: { refunded: expect.objectContaining({ id, item_id: "wizard_hat", cost: 40 }), balance: 100 } });
    expect(await totals()).toMatchObject({ purchased: 0, balance: 100 });
    expect(owned()).toBe("");
    expect((await buy("wizard_hat")).status).toBe(201);
  });

  test("a worn item comes off in the same transaction; the other slots stay", async () => {
    reset(300);
    for (const item of ["cap", "monocle", "snow"]) expect((await buy(item)).status).toBe(201);
    psql(`UPDATE creatures SET look = '{"name":"Feuer","head":"cap","face":"monocle","background":"snow"}' WHERE person_id = '${KID}'`);
    expect((await refund(idOf("monocle"))).status).toBe(200);
    expect(JSON.parse(lookOf())).toEqual({ name: "Feuer", head: "cap", background: "snow" });
    expect((await refund(idOf("snow"))).status).toBe(200);
    expect(JSON.parse(lookOf())).toEqual({ name: "Feuer", head: "cap" });
    // an item not worn: the look is left alone
    expect((await buy("scarf")).status).toBe(201);
    expect((await refund(idOf("scarf"))).status).toBe(200);
    expect(JSON.parse(lookOf())).toEqual({ name: "Feuer", head: "cap" });
  });

  test("another family's purchase, an unknown id, or one refunded twice at once: not found", async () => {
    reset(100);
    expect((await buy("medal")).status).toBe(201);
    const id = idOf("medal");
    expect(await refund(id, OTHER)).toEqual({ status: 404, body: { error: "not found" } });
    expect(await refund("nope")).toEqual({ status: 404, body: { error: "not found" } });
    expect(owned()).toBe("medal");
    const answers = await Promise.all([refund(id), refund(id), refund(id)]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 404, 404]);
    expect(await totals()).toMatchObject({ purchased: 0, balance: 100 });
  });

  test("a refund and a purchase at once for one child are served in turn", async () => {
    for (let round = 0; round < 5; round++) {
      reset(60);
      expect((await buy("starry_sky")).status).toBe(201);
      // 0 points left; the refund frees 60, so the cape (45) is bought only after it
      const [refunded, bought] = await Promise.all([refund(idOf("starry_sky")), buy("cape")]);
      expect(refunded.status, `round ${round}`).toBe(200);
      const t = await totals();
      expect(t.balance, `round ${round}`).toBe(bought.status === 201 ? 15 : 60);
      expect(t.owed).toBe(0);
    }
  });
});

test.describe("a browser's token", () => {
  const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const browser = (familyId: string) =>
    createClient(URL!, ANON!, {
      global: { headers: { Authorization: `Bearer ${mintFamilyToken(familyId).token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }) as any;

  test("reads its own family's purchases only, and writes none, nor calls the function", async () => {
    test.skip(!ANON || !(process.env.JWT_SECRET || process.env.PGRST_JWT_SECRET), "needs the anon key and JWT secret");
    reset(100);
    expect((await buy("cap")).status).toBe(201);
    const id = psql(`SELECT id FROM point_purchases WHERE person_id = '${KID}'`);
    const mine = browser(FAMILY);
    expect((await mine.from("point_purchases").select("item_id").eq("person_id", KID)).data).toEqual([{ item_id: "cap" }]);
    expect((await browser(OTHER).from("point_purchases").select("id").eq("person_id", KID)).data).toEqual([]);
    const attempts = [
      await mine.from("point_purchases").insert({ family_id: FAMILY, person_id: KID, item_id: "space_helmet", cost: 1 }),
      await mine.from("point_purchases").update({ cost: 1 }).eq("id", id),
      await mine.from("point_purchases").delete().eq("id", id),
      await mine.rpc("purchase_person_point_item", { p_family_id: FAMILY, p_person_id: KID, p_item_id: "snow", p_cost: 1 }),
      await mine.rpc("refund_person_point_purchase", { p_family_id: FAMILY, p_purchase_id: id }),
      await mine.rpc("point_person_totals", { p_family_id: FAMILY, p_person_id: KID }),
    ];
    for (const [i, res] of attempts.entries()) {
      expect(res.error, `attempt ${i}`).not.toBeNull();
      expect(res.error.code, `attempt ${i}`).toBe("42501");
    }
    expect(owned()).toBe("cap");
    expect(await totals()).toMatchObject({ purchased: 25 });
  });

  test("the grants: SELECT for authenticated, nothing for anon, TRUNCATE for neither", () => {
    const rows = psql(`
      SELECT r || ':' || string_agg(p, ',' ORDER BY p)
      FROM unnest(ARRAY['anon','authenticated']) r,
           unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
      WHERE has_table_privilege(r, 'public.point_purchases', p)
      GROUP BY r ORDER BY 1;`).split("\n").filter(Boolean);
    expect(rows).toEqual(["authenticated:SELECT"]);
    for (const fn of [
      "public.purchase_person_point_item(uuid, uuid, text, integer)",
      "public.refund_person_point_purchase(uuid, uuid)",
      "public.request_person_point_redemption(uuid, uuid, uuid, uuid)",
      "public.point_person_totals(uuid, uuid)",
    ]) {
      expect(psql(`SELECT has_function_privilege('authenticated', '${fn}', 'EXECUTE');`), fn).toBe("f");
      expect(psql(`SELECT has_function_privilege('anon', '${fn}', 'EXECUTE');`), fn).toBe("f");
      expect(psql(`SELECT has_function_privilege('service_role', '${fn}', 'EXECUTE');`), fn).toBe("t");
    }
    expect(psql(`SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'point_purchases';`)).toBe("1");
  });
});

test.describe("the migration", () => {
  test.beforeEach(acquireWholeDatabase);
  test.afterEach(releaseWholeDatabase);

  test("applies on a database without it, then again as a no-op, and keeps what was bought", () => {
    const migration = readFileSync(join(process.cwd(), "docker", "migration_zzzzzzzzz_point_purchases.sql"), "utf8");
    const step1 = readFileSync(join(process.cwd(), "docker", "migration_zzzzzzzz_pocket_money_creatures_out.sql"), "utf8");
    reset(100);
    const out = psql(`BEGIN;
SET LOCAL client_min_messages = warning;
DROP FUNCTION public.purchase_person_point_item(UUID, UUID, TEXT, INTEGER);
DROP TABLE public.point_purchases;
-- the balance as step 1 left it
${step1}
SELECT 'BEFORE|' || public.point_person_totals('${FAMILY}', '${KID}')::text;
${migration}
SELECT 'BUY|' || (public.purchase_person_point_item('${FAMILY}', '${KID}', 'snow', 70)->>'ok');
${migration}
SELECT 'AGAIN|' || count(*) FROM public.point_purchases WHERE person_id = '${KID}';
SELECT 'TOT|' || public.point_person_totals('${FAMILY}', '${KID}')::text;
SELECT 'TWICE|' || (public.purchase_person_point_item('${FAMILY}', '${KID}', 'snow', 70)->>'error');
-- step 1 re-run on a later boot, then this file: purchases still count
${step1}
${migration}
SELECT 'BOOT|' || (public.point_person_totals('${FAMILY}', '${KID}')->>'balance');
ROLLBACK;`).split("\n");
    const line = (tag: string) => out.find((l) => l.startsWith(`${tag}|`))?.slice(tag.length + 1);
    expect(JSON.parse(line("BEFORE")!)).toEqual({ earned: 100, spent: 0, pending: 0, balance: 100, owed: 0 });
    expect(line("BUY")).toBe("true");
    expect(line("AGAIN")).toBe("1");
    expect(JSON.parse(line("TOT")!)).toEqual({ earned: 100, spent: 0, purchased: 70, pending: 0, balance: 30, owed: 0 });
    expect(line("TWICE")).toBe("already_owned");
    expect(line("BOOT")).toBe("30");
    expect(psql(`SELECT to_regclass('public.point_purchases') IS NOT NULL`)).toBe("t");
  });
});

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

test.describe("the routes", () => {
  let api: APIRequestContext;

  test.beforeAll(async () => {
    api = await pwRequest.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000" });
    const join = await postJoin(api, { joinCode: JOIN_CODE, hardwareId: DEVICES[0], deviceName: DEVICES[0] });
    expect(join.ok(), await join.text()).toBe(true);
  });
  test.afterAll(async () => {
    await api?.dispose();
  });

  test("buying needs no PIN and ignores a price in the body", async () => {
    reset(200);
    const res = await api.post(`/api/creatures/${KID}/purchases`, { data: { item_id: "space_helmet", cost: 1 } });
    expect(res.status(), await res.text()).toBe(201);
    expect(psql(`SELECT cost FROM point_purchases WHERE person_id = '${KID}' AND item_id = 'space_helmet'`)).toBe("60");
    expect((await api.post(`/api/creatures/${KID}/purchases`, { data: {} })).status()).toBe(400);
    expect((await api.post(`/api/creatures/${KID}/purchases`, { data: { item_id: "space_helmet" } })).status()).toBe(409);
  });

  test("only owned items can be worn", async () => {
    reset(200);
    const wear = (look: Record<string, string>) => api.patch(`/api/creatures/${KID}`, { data: { look } });
    let res = await wear({ head: "cap", name: "Feuer" });
    expect(res.status()).toBe(409);
    expect(await res.json()).toEqual({ error: "not_owned", items: ["cap"] });
    expect(psql(`SELECT look::text FROM creatures WHERE person_id = '${KID}'`)).toBe("{}");
    expect((await api.post(`/api/creatures/${KID}/purchases`, { data: { item_id: "cap" } })).status()).toBe(201);
    res = await wear({ head: "cap", name: "Feuer" });
    expect(res.status(), await res.text()).toBe(200);
    expect(psql(`SELECT look->>'head' FROM creatures WHERE person_id = '${KID}'`)).toBe("cap");
    // the wrong slot, or another child's item, are refused too
    expect((await wear({ face: "cap" })).status()).toBe(400);
    expect((await api.patch(`/api/creatures/${KID2}`, { data: { look: { head: "cap" } } })).status()).toBe(409);
    // the shop off: what was bought stays worn, and can still be taken off and put back on
    psql(`UPDATE creatures SET shop_enabled = false WHERE person_id = '${KID}'`);
    expect((await api.post(`/api/creatures/${KID}/purchases`, { data: { item_id: "monocle" } })).status()).toBe(409);
    expect((await wear({})).status()).toBe(200);
    expect((await wear({ head: "cap" })).status()).toBe(200);
    psql(`UPDATE creatures SET shop_enabled = true WHERE person_id = '${KID}'`);
  });

  test("a backup carries the purchases, and a restore gives them to the restored child", async () => {
    reset(200);
    expect((await api.post(`/api/creatures/${KID}/purchases`, { data: { item_id: "forest" } })).status()).toBe(201);
    psql(`UPDATE creatures SET look = '{"background":"forest"}' WHERE person_id = '${KID}'`);
    const exp = await api.get(`/api/export?family_id=${FAMILY}`);
    expect(exp.status()).toBe(200);
    const backup = await exp.json();
    expect(backup.data.point_purchases).toEqual([expect.objectContaining({ person_id: KID, item_id: "forest", cost: 70 })]);
    const res = await api.post("/api/import", { data: { ...backup, family: { id: FAMILY, name: "claude-shop-restored" } } });
    expect(res.status(), await res.text()).toBe(200);
    const restored = (await res.json()).family_id as string;
    const child = psql(`SELECT id FROM people WHERE family_id = '${restored}' AND name = 'claude-Mia'`);
    expect(child).not.toBe(KID);
    expect(psql(`SELECT person_id || '|' || item_id || '|' || cost FROM point_purchases WHERE family_id = '${restored}'`)).toBe(`${child}|forest|70`);
    expect(psql(`SELECT public.point_person_totals('${restored}', '${child}')->>'balance'`)).toBe("130");
    expect(psql(`SELECT look->>'background' FROM creatures WHERE person_id = '${child}'`)).toBe("forest");
    psql(`SELECT public.delete_family('${restored}')`);
  });

  test("a refund needs the settings PIN, checked on the server before anything moves", async () => {
    reset(100);
    expect((await api.post(`/api/creatures/${KID}/purchases`, { data: { item_id: "cap" } })).status()).toBe(201);
    psql(`UPDATE creatures SET look = '{"head":"cap"}' WHERE person_id = '${KID}'`);
    const id = psql(`SELECT id FROM point_purchases WHERE person_id = '${KID}' AND item_id = 'cap'`);
    // A family with no PIN counts as unlocked: set one, so this proves the lock, not its absence.
    const setPin = await api.post("/api/pin", { data: { family_id: FAMILY, action: "set", pin: "4711" } });
    expect(setPin.ok(), await setPin.text()).toBe(true);
    psql(`UPDATE device_sessions SET settings_unlocked_until = NULL WHERE family_id = '${FAMILY}'`);
    const locked = await api.delete(`/api/creatures/purchases/${id}`);
    expect(locked.status()).toBe(403);
    expect(await locked.json()).toEqual({ error: "pin_required" });
    expect(owned()).toBe("cap");
    expect(psql(`SELECT look->>'head' FROM creatures WHERE person_id = '${KID}'`)).toBe("cap");
    // Unlocked: refunded, and off the creature.
    psql(`UPDATE device_sessions SET settings_unlocked_until = now() + interval '5 minutes' WHERE family_id = '${FAMILY}'`);
    const res = await api.delete(`/api/creatures/purchases/${id}`);
    expect(res.status(), await res.text()).toBe(200);
    expect(owned()).toBe("");
    expect(psql(`SELECT look::text FROM creatures WHERE person_id = '${KID}'`)).toBe("{}");
    psql(`DELETE FROM settings WHERE family_id = '${FAMILY}' AND key = 'settings_pin'`);
  });
});
