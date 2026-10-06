import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { request as pwRequest, type APIRequestContext } from "@playwright/test";
import { postJoin } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";

/**
 * Approving or denying a pocket-money withdrawal, and every parental
 * pocket-money setting (allowance, interest, currency, manual deposits and
 * withdrawals, creating or deleting a child's account), used to check only
 * `requireSession` + `familyMatchesSession` — never the settings PIN that
 * guards Settings in the browser. Any signed-in device of the family,
 * including a child's own wall panel, could approve its own withdrawal
 * request with a direct PATCH, no PIN screen involved.
 *
 * This is a source scan, like e2e/api-route-auth.spec.ts: it has to hold for
 * a route nobody thought to add a test for, including one written next year.
 * A new mutating pocket-money route defaults to needing the PIN; staying off
 * it is a decision written out below, not a thing that happens by omission.
 *
 * The kid side is the asymmetry that matters: a child creating their own
 * goal, uploading an image for it, or asking for a withdrawal must stay
 * PIN-free, or the feature stops working for the person it's for.
 */

const API = join(__dirname, "..", "src", "app", "api");
/**
 * The trees scanned. Pocket money, and since RFC-017 the creatures and the
 * rewards that moved out of it: the same parent/child split, the same rule.
 */
const ROOTS = ["pocket-money", "creatures", "rewards"];

const MUTATING_VERB = /export async function (POST|PATCH|PUT|DELETE)/;

/**
 * Mutating routes that deliberately do NOT check the settings PIN — the
 * action belongs to the child, not a parent, so gating it would just lock
 * kids out of their own goals and requests. Paths relative to src/app/api.
 */
const PIN_FREE_BY_DESIGN: Record<string, string> = {
  // Asking for money is not spending it — only the parent's decision on the
  // request (withdrawal-requests/[id]/route.ts) moves anything.
  "pocket-money/accounts/[id]/withdrawal-requests/route.ts": "a child's own request for money, not the decision on it",
  // A child's own savings goal: creating one commits nothing.
  "pocket-money/accounts/[id]/goals/route.ts": "a child creating their own savings goal",
  // Renaming, reordering, retargeting or removing a goal is the same child
  // action as creating one — none of it moves money or a setting.
  "pocket-money/goals/[id]/route.ts": "editing or deleting a goal is the child's own, not a parental setting",
  // Redeeming points for a reward (#353, per child since RFC-017) is the
  // child's own request, like a withdrawal request: it books nothing until a
  // parent decides it, and that decision (rewards/redemptions/[id]) checks
  // the PIN.
  "rewards/redemptions/route.ts": "a child's own request to redeem points, not the decision on it",
  // An image candidate for a goal. No family money or settings touched.
  "pocket-money/goal-image-upload/route.ts": "uploads an image for a goal; moves no money and changes no setting",
};

function routeFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") found.push(full);
    }
  };
  walk(root);
  return found;
}

const allRoutes = () => ROOTS.flatMap((r) => routeFiles(join(API, r))).map((f) => f.slice(API.length + 1));

test("every mutating pocket-money, creature and reward route checks the settings PIN unless named as the child's own", () => {
  const files = allRoutes();
  expect(files.length).toBeGreaterThan(8);
  // Guard the guard: the new trees are walked.
  expect(files).toContain("creatures/[personId]/route.ts");
  expect(files).toContain("rewards/redemptions/[id]/route.ts");

  const missing: string[] = [];
  for (const rel of files) {
    const source = readFileSync(join(API, rel), "utf8");
    if (!MUTATING_VERB.test(source)) continue; // read-only: nothing to gate
    if (rel in PIN_FREE_BY_DESIGN) continue;
    if (!source.includes("requireSettingsUnlock")) missing.push(rel);
  }

  expect(missing).toEqual([]);
});

test("the kid-side allowlist is the only thing keeping those routes PIN-free", () => {
  // Guards the first test against going vacuous: if MUTATING_VERB stopped
  // matching, or requireSettingsUnlock were added everywhere by mistake, the
  // first test would pass empty and hide that the allowlist protects nothing.
  const flagged = allRoutes().filter((rel) => {
    const source = readFileSync(join(API, rel), "utf8");
    return MUTATING_VERB.test(source) && !source.includes("requireSettingsUnlock");
  });

  expect(flagged.sort()).toEqual(Object.keys(PIN_FREE_BY_DESIGN).sort());
});

test("the kid-side allowlist names routes that exist", () => {
  const present = new Set(allRoutes());
  const stale = Object.keys(PIN_FREE_BY_DESIGN).filter((rel) => !present.has(rel));
  expect(stale).toEqual([]);
});

test("the account PATCH gates the money settings, and refuses the creature's fields that moved out", () => {
  // Until RFC-017 the account carried the creature too, and its kid-side
  // fields went through here with no PIN. They live on `creatures` now; the
  // account route refuses them rather than writing a column nobody reads.
  const source = readFileSync(join(API, "pocket-money/accounts/[id]/route.ts"), "utf8");
  expect(source).toMatch(/PIN_PROTECTED_FIELDS\.some\([\s\S]{0,200}?requireSettingsUnlock/);
  const moved = source.slice(source.indexOf("const MOVED_TO_CREATURES"), source.indexOf("] as const", source.indexOf("const MOVED_TO_CREATURES")));
  for (const field of ["avatar_species", "avatar_style", "avatar_look", "best_tier", "last_seen_tier", "reward_mode"]) {
    expect(moved, field).toContain(`"${field}"`);
  }
  // Refused before the PIN check: a moved field is a 400 whoever sends it.
  expect(source.indexOf("moved.length > 0")).toBeGreaterThan(0);
  expect(source.indexOf("moved.length > 0")).toBeLessThan(source.indexOf("PIN_PROTECTED_FIELDS.some("));
});

test("the creature PATCH gates only the parental fields, not the kid-side look and stage", () => {
  // creatures/[personId] is the one route both sides call: a child's own
  // device writes the stage on every visit and the look when they change it,
  // a parent switches the creature on or off and picks species, growth and
  // the shop. Gating the whole route would 403 the child on every page load.
  const source = readFileSync(join(API, "creatures/[personId]/route.ts"), "utf8");
  expect(source).toMatch(/if \(parsed\.parental\) \{\s*const locked = await requireSettingsUnlock/);
  const rules = readFileSync(join(__dirname, "..", "src", "lib", "creatures", "rules.ts"), "utf8");
  const parental = /PARENTAL_FIELDS = \[([^\]]*)\]/.exec(rules)?.[1] ?? "";
  const kid = /KID_FIELDS = \[([^\]]*)\]/.exec(rules)?.[1] ?? "";
  for (const f of ["enabled", "species", "grows_with", "shop_enabled"]) expect(parental, f).toContain(`"${f}"`);
  for (const f of ["style", "look", "best_tier", "last_seen_tier"]) {
    expect(kid, f).toContain(`"${f}"`);
    expect(parental, f).not.toContain(`"${f}"`);
  }
});

// ── live: approving without the server-side unlock is refused ─────────────

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const P = "claude-pm-pin-";
let api: APIRequestContext;
let famId = "";
let accountId = "";
let requestId = "";
let childId = "";
let rewardId = "";

function purge() {
  if (!famId) return;
  psql(`DELETE FROM pocket_money_withdrawal_requests WHERE account_id IN (SELECT id FROM pocket_money_accounts WHERE family_id = ${sqlText(famId)})`);
  psql(`DELETE FROM pocket_money_transactions WHERE account_id IN (SELECT id FROM pocket_money_accounts WHERE family_id = ${sqlText(famId)})`);
  psql(`DELETE FROM pocket_money_accounts WHERE family_id = ${sqlText(famId)}`);
  psql(`DELETE FROM point_redemptions WHERE family_id = ${sqlText(famId)}`);
  psql(`DELETE FROM point_rewards WHERE family_id = ${sqlText(famId)}`);
  psql(`DELETE FROM creatures WHERE family_id = ${sqlText(famId)}`);
  for (let i = 0; i < 2; i++) psql(`DELETE FROM people WHERE family_id = ${sqlText(famId)}`);
  psql(`DELETE FROM families WHERE id = ${sqlText(famId)}`);
}

test.describe("live: the decide route 403s a device that never entered the PIN", () => {
  test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE and a running stack");
  test.beforeAll(async () => {
    test.setTimeout(60_000);
    // Leftovers from an aborted run.
    const stale = psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`);
    for (const id of stale.split(",").filter(Boolean)) {
      famId = id;
      purge();
    }
    famId = "";

    const code = `CP${randomBytes(4).toString("hex").toUpperCase()}`;
    famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);
    childId = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', '${P}kid', true) RETURNING id`);
    accountId = psqlRow(`INSERT INTO pocket_money_accounts (family_id, person_id, currency, balance_cents) VALUES ('${famId}', '${childId}', 'EUR', 1000) RETURNING id`);
    requestId = psqlRow(`INSERT INTO pocket_money_withdrawal_requests (account_id, amount_cents, reason) VALUES ('${accountId}', 500, '${P}toy') RETURNING id`);

    api = await pwRequest.newContext({ baseURL: BASE });
    const join = await postJoin(api, { joinCode: code, hardwareId: `${P}device-${Date.now()}`, deviceName: `${P}device` });
    expect(join.ok(), await join.text()).toBe(true);

    // This family has no PIN at all yet, which `requireSettingsUnlock`
    // treats as "unlocked" — that would make the request below pass for the
    // wrong reason. Set one, so the test proves the lock, not its absence.
    const setPin = await api.post("/api/pin", { data: { family_id: famId, action: "set", pin: "4711" } });
    expect(setPin.ok(), await setPin.text()).toBe(true);
  });

  test.afterAll(async () => {
    purge();
    psql("DELETE FROM devices WHERE hardware_id LIKE 'claude-pm-pin-%'");
    await api?.dispose();
    expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
  });

  test("approving with no server-side unlock is 403 pin_required, and books nothing", async () => {
    // Setting the PIN in beforeAll unlocked *this* device's session (choosing
    // a PIN proves knowing it) — the same gap this fix closes would otherwise
    // let that stand in for having entered it. Clear it so the call below
    // meets a genuinely locked session.
    psql(`UPDATE device_sessions SET settings_unlocked_until = NULL WHERE family_id = '${famId}'`);

    const decide = await api.patch(`/api/pocket-money/withdrawal-requests/${requestId}`, {
      data: { status: "approved", family_id: famId },
    });
    expect(decide.status(), await decide.text()).toBe(403);
    expect((await decide.json()).error).toBe("pin_required");

    expect(psql(`SELECT balance_cents FROM pocket_money_accounts WHERE id = '${accountId}'`)).toBe("1000");
    expect(psql(`SELECT status FROM pocket_money_withdrawal_requests WHERE id = '${requestId}'`)).toBe("pending");
  });

  test("the same device, after verifying the PIN, may approve it", async () => {
    const verify = await api.post("/api/pin", { data: { family_id: famId, action: "verify", pin: "4711" } });
    expect(verify.ok(), await verify.text()).toBe(true);
    expect((await verify.json()).valid).toBe(true);

    const decide = await api.patch(`/api/pocket-money/withdrawal-requests/${requestId}`, {
      data: { status: "approved", family_id: famId },
    });
    expect(decide.status(), await decide.text()).toBe(200);
    expect(psql(`SELECT balance_cents FROM pocket_money_accounts WHERE id = '${accountId}'`)).toBe("500");
  });

  test("a direct manual deposit also needs the unlock", async () => {
    psql(`UPDATE device_sessions SET settings_unlocked_until = NULL WHERE family_id = '${famId}'`);

    const deposit = await api.post(`/api/pocket-money/accounts/${accountId}/transactions`, {
      data: { family_id: famId, amount_cents: 200, type: "manual_deposit" },
    });
    expect(deposit.status(), await deposit.text()).toBe(403);
    expect((await deposit.json()).error).toBe("pin_required");
    expect(psql(`SELECT balance_cents FROM pocket_money_accounts WHERE id = '${accountId}'`)).toBe("500");
  });

  const lock = () => psql(`UPDATE device_sessions SET settings_unlocked_until = NULL WHERE family_id = '${famId}'`);
  const unlock = async () => {
    const verify = await api.post("/api/pin", { data: { family_id: famId, action: "verify", pin: "4711" } });
    expect((await verify.json()).valid).toBe(true);
  };
  const creature = (cols: string) => psql(`SELECT ${cols} FROM creatures WHERE person_id = '${childId}'`);

  test("the account no longer takes the creature's fields: they moved to /api/creatures", async () => {
    lock();
    for (const data of [{ best_tier: 2 }, { avatar_style: "sticker" }, { avatar_species: "cat" }, { reward_mode: "points" }, { avatar_look: {} }]) {
      const res = await api.patch(`/api/pocket-money/accounts/${accountId}`, { data: { family_id: famId, ...data } });
      expect(res.status(), `${JSON.stringify(data)}: ${await res.text()}`).toBe(400);
    }
    expect(psql(`SELECT avatar_style || '|' || best_tier FROM pocket_money_accounts WHERE id = '${accountId}'`)).toBe("classic|1");
  });

  test("switching a child's creature on needs the PIN", async () => {
    lock();
    const res = await api.post("/api/creatures", { data: { person_id: childId } });
    expect(res.status(), await res.text()).toBe(403);
    expect((await res.json()).error).toBe("pin_required");
    expect(creature("count(*)")).toBe("0");

    await unlock();
    const on = await api.post("/api/creatures", { data: { person_id: childId } });
    expect(on.status(), await on.text()).toBe(201);
    expect(creature("species || '|' || style || '|' || grows_with || '|' || enabled || '|' || shop_enabled")).toBe("dragon|classic|points|true|true");
  });

  test("the kid-side stage write needs no PIN, and best_tier only climbs", async () => {
    lock();
    const track = await api.patch(`/api/creatures/${childId}`, { data: { best_tier: 3, last_seen_tier: 3 } });
    expect(track.status(), await track.text()).toBe(200);
    expect(creature("best_tier || '|' || last_seen_tier")).toBe("3|3");
    const down = await api.patch(`/api/creatures/${childId}`, { data: { best_tier: 1, last_seen_tier: 2 } });
    expect(down.status(), await down.text()).toBe(200);
    expect(creature("best_tier || '|' || last_seen_tier")).toBe("3|2");
    const over = await api.patch(`/api/creatures/${childId}`, { data: { best_tier: 99 } });
    expect(over.status(), await over.text()).toBe(200);
    expect(creature("best_tier")).toBe("8");
  });

  test("a child picks their creature's style with no PIN, but only one of the four", async () => {
    lock();
    const look = await api.patch(`/api/creatures/${childId}`, { data: { style: "sticker" } });
    expect(look.status(), await look.text()).toBe(200);
    expect(creature("style")).toBe("sticker");
    const bogus = await api.patch(`/api/creatures/${childId}`, { data: { style: "neon" } });
    expect(bogus.status(), await bogus.text()).toBe(400);
    expect(creature("style")).toBe("sticker");
  });

  test("changing the species still needs the PIN, even sent together with a style", async () => {
    lock();
    const species = await api.patch(`/api/creatures/${childId}`, { data: { species: "cat", style: "gumdrop" } });
    expect(species.status(), await species.text()).toBe(403);
    expect((await species.json()).error).toBe("pin_required");
    expect(creature("species || '|' || style")).toBe("dragon|sticker");
  });

  test("a child changes their creature's look with no PIN, but only from the editor's sets", async () => {
    lock();
    const look = { name: "  Funkel\n", body: "#ff8a5b", belly: "#DDF7E8", accent: "#3FA877", pattern: "hearts", eyes: "sparkly", acc: "bow" };
    const res = await api.patch(`/api/creatures/${childId}`, { data: { look } });
    expect(res.status(), await res.text()).toBe(200);
    const stored = JSON.parse(creature("look::text"));
    expect(stored).toEqual({ name: "Funkel", body: "#FF8A5B", belly: "#DDF7E8", accent: "#3FA877", pattern: "hearts", eyes: "sparkly", acc: "bow" });

    for (const bad of [{ body: "#123456" }, { wings: "#56B6E8" }, { acc: "crown" }, ["x"], "x", { name: 3 }]) {
      const r = await api.patch(`/api/creatures/${childId}`, { data: { look: bad } });
      expect(r.status(), `${JSON.stringify(bad)}: ${await r.text()}`).toBe(400);
    }
    expect(JSON.parse(creature("look::text"))).toEqual(stored);
  });

  test("a look sent together with a new species still needs the PIN, and writes neither", async () => {
    lock();
    const before = creature("species || '|' || look::text");
    const res = await api.patch(`/api/creatures/${childId}`, { data: { species: "unicorn", look: { body: "#56B6E8" } } });
    expect(res.status(), await res.text()).toBe(403);
    expect((await res.json()).error).toBe("pin_required");
    expect(creature("species || '|' || look::text")).toBe(before);
  });

  test("what it grows with, and the shop, need the PIN; money only with an account and the plugin on", async () => {
    lock();
    for (const data of [{ grows_with: "money" }, { shop_enabled: false }, { enabled: false }]) {
      const res = await api.patch(`/api/creatures/${childId}`, { data });
      expect(res.status(), `${JSON.stringify(data)}: ${await res.text()}`).toBe(403);
    }
    expect(creature("grows_with || '|' || shop_enabled || '|' || enabled")).toBe("points|true|true");

    await unlock();
    // This child has an account and the plugin is on (no setting = on).
    const money = await api.patch(`/api/creatures/${childId}`, { data: { grows_with: "money" } });
    expect(money.status(), await money.text()).toBe(200);
    expect(creature("grows_with")).toBe("money");

    // The plugin off: money is no longer on offer.
    psql(`INSERT INTO settings (family_id, key, value) VALUES ('${famId}', 'enabled_plugins', '{"pocket-money": false}')`);
    await api.patch(`/api/creatures/${childId}`, { data: { grows_with: "points" } });
    const off = await api.patch(`/api/creatures/${childId}`, { data: { grows_with: "money" } });
    expect(off.status(), await off.text()).toBe(409);
    expect((await off.json()).error).toBe("money_unavailable");
    psql(`DELETE FROM settings WHERE family_id = '${famId}' AND key = 'enabled_plugins'`);

    // A child without an account: points only.
    const kid2 = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', '${P}kid-noacct', true) RETURNING id`);
    expect((await api.post("/api/creatures", { data: { person_id: kid2 } })).status()).toBe(201);
    const noAccount = await api.patch(`/api/creatures/${kid2}`, { data: { grows_with: "money" } });
    expect(noAccount.status(), await noAccount.text()).toBe(409);
    expect(psql(`SELECT grows_with FROM creatures WHERE person_id = '${kid2}'`)).toBe("points");

    const shop = await api.patch(`/api/creatures/${childId}`, { data: { shop_enabled: false } });
    expect(shop.status(), await shop.text()).toBe(200);
    expect(creature("shop_enabled::text")).toBe("false");
  });

  test("switching off keeps the creature; switching on brings back the same one", async () => {
    await unlock();
    const before = creature("species || '|' || style || '|' || best_tier || '|' || look::text");
    const off = await api.patch(`/api/creatures/${childId}`, { data: { enabled: false } });
    expect(off.status(), await off.text()).toBe(200);
    expect(creature("enabled::text")).toBe("false");
    // The child's own screen writes nothing to a creature that is off.
    lock();
    const kid = await api.patch(`/api/creatures/${childId}`, { data: { last_seen_tier: 1 } });
    expect(kid.status(), await kid.text()).toBe(409);
    await unlock();
    const on = await api.post("/api/creatures", { data: { person_id: childId } });
    expect(on.status(), await on.text()).toBe(200);
    expect(creature("enabled::text")).toBe("true");
    expect(creature("species || '|' || style || '|' || best_tier || '|' || look::text")).toBe(before);
  });

  test("the rewards catalogue and the decisions need the PIN; a child's request does not", async () => {
    lock();
    const add = await api.post("/api/rewards", { data: { title: `${P}film`, cost_points: 5 } });
    expect(add.status(), await add.text()).toBe(403);
    await unlock();
    const added = await api.post("/api/rewards", { data: { title: `${P}film`, cost_points: 5 } });
    expect(added.status(), await added.text()).toBe(201);
    rewardId = (await added.json()).reward.id;
    lock();
    for (const res of [
      await api.patch(`/api/rewards/${rewardId}`, { data: { cost_points: 1 } }),
      await api.delete(`/api/rewards/${rewardId}`),
    ]) expect(res.status(), await res.text()).toBe(403);

    psql(`INSERT INTO todo_point_awards (family_id, person_id, points, completion_key) VALUES ('${famId}', '${childId}', 10, 'claude-pin-award')`);
    const ask = await api.post("/api/rewards/redemptions", { data: { person_id: childId, reward_id: rewardId } });
    expect(ask.status(), await ask.text()).toBe(201);
    const redemption = (await ask.json()).redemption.id;
    expect(psql(`SELECT person_id || '|' || account_id FROM point_redemptions WHERE id = '${redemption}'`)).toBe(`${childId}|${accountId}`);
    const decide = await api.patch(`/api/rewards/redemptions/${redemption}`, { data: { status: "approved" } });
    expect(decide.status(), await decide.text()).toBe(403);
    expect(psql(`SELECT status FROM point_redemptions WHERE id = '${redemption}'`)).toBe("pending");
    await unlock();
    const approved = await api.patch(`/api/rewards/redemptions/${redemption}`, { data: { status: "approved" } });
    expect(approved.status(), await approved.text()).toBe(200);
  });

  test("a child's own withdrawal request still needs no PIN", async () => {
    const create = await api.post(`/api/pocket-money/accounts/${accountId}/withdrawal-requests`, {
      data: { family_id: famId, amount_cents: 100, reason: `${P}second` },
    });
    expect(create.status(), await create.text()).toBe(201);
  });

  test("with the PIN, a parent may pick any of the new creatures; an unknown one is refused", async () => {
    await unlock();
    for (const species of ["rex", "unicorn", "princess", "prince", "cat", "axolotl", "owl", "robot", "fox", "penguin", "bunny", "trike", "stego"]) {
      const res = await api.patch(`/api/creatures/${childId}`, { data: { species } });
      expect(res.status(), `${species}: ${await res.text()}`).toBe(200);
      expect(creature("species")).toBe(species);
    }
    const bogus = await api.patch(`/api/creatures/${childId}`, { data: { species: "griffin" } });
    expect(bogus.status(), await bogus.text()).toBe(400);
    expect(creature("species")).toBe("stego");
  });

  test("a new creature with no classic pictures starts in Gumdrop; the dragon still starts on Classic", async () => {
    await unlock();
    const kidA = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', '${P}kid-a', true) RETURNING id`);
    const kidB = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', '${P}kid-b', true) RETURNING id`);
    const kidC = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', '${P}kid-c', true) RETURNING id`);
    const adult = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', '${P}adult', false) RETURNING id`);
    const unicorn = await api.post("/api/creatures", { data: { person_id: kidA, species: "unicorn" } });
    expect(unicorn.status(), await unicorn.text()).toBe(201);
    expect((await unicorn.json()).creature.style).toBe("gumdrop");
    const dragon = await api.post("/api/creatures", { data: { person_id: kidB, species: "dragon" } });
    expect(dragon.status(), await dragon.text()).toBe(201);
    expect((await dragon.json()).creature.style).toBe("classic");
    const bogus = await api.post("/api/creatures", { data: { person_id: kidC, species: "griffin" } });
    expect(bogus.status(), await bogus.text()).toBe(400);
    const grown = await api.post("/api/creatures", { data: { person_id: adult } });
    expect(grown.status(), await grown.text()).toBe(400);
  });

  test("a new pocket-money account is the euros only: it writes no creature", async () => {
    await unlock();
    const kidD = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', '${P}kid-d', true) RETURNING id`);
    const res = await api.post("/api/pocket-money/accounts", { data: { family_id: famId, person_id: kidD } });
    expect(res.status(), await res.text()).toBe(201);
    expect(psql(`SELECT count(*) FROM creatures WHERE person_id = '${kidD}'`)).toBe("0");
  });
});
