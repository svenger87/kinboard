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
  // The same request on its old path, kept one release (RFC-017): it looks
  // the account's child up in the session's family and asks for them.
  "pocket-money/accounts/[id]/redemptions/route.ts": "a child's own request to redeem points, on its old path for one release",
  // Buying something for their creature in the shop (RFC-017 §5) is the
  // child's own action, paid from their own points, like asking for a
  // reward. A parent's say is the Shop switch (creatures.shop_enabled, behind
  // the PIN in PATCH /api/creatures/[personId]), which the purchase function
  // checks under the child's lock.
  "creatures/[personId]/purchases/route.ts": "a child buying an item for their creature with their own points",
  // An image candidate for a goal. No family money or settings touched.
  "pocket-money/goal-image-upload/route.ts": "uploads an image for a goal; moves no money and changes no setting",
};

/**
 * Thin forwards kept for one release (RFC-017 review): an old path that hands
 * the request to the new route, which does every check. Each must import the
 * route it names, contain nothing but the hand-over, and say it goes away.
 */
const FORWARDS: Record<string, string> = {
  "pocket-money/rewards/route.ts": "rewards/route.ts",
  "pocket-money/rewards/[id]/route.ts": "rewards/[id]/route.ts",
  "pocket-money/redemptions/[id]/route.ts": "rewards/redemptions/[id]/route.ts",
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
    if (rel in FORWARDS) continue; // checked below: the target is what holds the PIN
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
    return MUTATING_VERB.test(source) && !source.includes("requireSettingsUnlock") && !(rel in FORWARDS);
  });

  expect(flagged.sort()).toEqual(Object.keys(PIN_FREE_BY_DESIGN).sort());
});

test("each forward only hands over to a route that checks the PIN, and is marked for removal", () => {
  const forwards = Object.entries(FORWARDS);
  expect(forwards.length).toBe(3);
  for (const [from, to] of forwards) {
    const source = readFileSync(join(API, from), "utf8");
    const target = readFileSync(join(API, to), "utf8");
    expect(source, from).toContain(`from "@/app/api/${to.replace(/\/route\.ts$/, "/route")}"`);
    expect(source, from).toMatch(/REMOVE in the release after RFC-017 step 1/);
    // no client, no write of its own
    expect(source, from).not.toMatch(/createAdminClient|\.from\(/);
    for (const verb of source.match(/export function (POST|PATCH|PUT|DELETE)/g) ?? []) {
      const name = verb.split(" ").pop()!;
      expect(target, `${to} ${name}`).toMatch(new RegExp(`export async function ${name}[\\s\\S]*?requireSettingsUnlock`));
    }
  }
});

test("the kid-side allowlist names routes that exist", () => {
  const present = new Set(allRoutes());
  const stale = Object.keys(PIN_FREE_BY_DESIGN).filter((rel) => !present.has(rel));
  expect(stale).toEqual([]);
});

test("the account PATCH gates the money settings, and forwards the creature's old fields under the creature's rules", () => {
  // Until RFC-017 the account carried the creature too. For one release it
  // still takes those fields from a screen on the previous bundle, renames
  // them and hands them to applyCreaturePatch: one PIN check covers both
  // halves, before either is written.
  const source = readFileSync(join(API, "pocket-money/accounts/[id]/route.ts"), "utf8");
  const moved = source.slice(source.indexOf("MOVED_TO_CREATURES: Record"), source.indexOf("};", source.indexOf("MOVED_TO_CREATURES: Record")));
  for (const [old, now] of [["avatar_species", "species"], ["avatar_style", "style"], ["avatar_look", "look"], ["best_tier", "best_tier"], ["last_seen_tier", "last_seen_tier"], ["reward_mode", "grows_with"]]) {
    expect(moved, old).toContain(`${old}: "${now}"`);
  }
  expect(source).toMatch(/PIN_PROTECTED_FIELDS\.some\(.*\) \|\| \(creature\?\.ok && creature\.parental\)\) \{\s*const locked = await requireSettingsUnlock/);
  expect(source.indexOf("requireSettingsUnlock(auth.session)")).toBeLessThan(source.indexOf("applyCreaturePatch({"));
  expect(source).toMatch(/REMOVE in the release after RFC-017 step 1/);
});

test("the shop: buying is the child's, a refund is the parent's and checks the PIN before anything moves", () => {
  // RFC-017 §5. A child buys with no PIN (PIN_FREE_BY_DESIGN above); handing
  // points back is a parental decision, and the child's own screen must not
  // be able to refund itself or take a sibling's item away.
  expect(PIN_FREE_BY_DESIGN).toHaveProperty(["creatures/[personId]/purchases/route.ts"]);
  const refund = "creatures/purchases/[id]/route.ts";
  expect(PIN_FREE_BY_DESIGN).not.toHaveProperty([refund]);
  const source = readFileSync(join(API, refund), "utf8");
  const gate = source.indexOf("await requireSettingsUnlock(auth.session)");
  expect(gate).toBeGreaterThan(source.indexOf("export async function DELETE"));
  expect(gate).toBeLessThan(source.indexOf("refundPurchase(createAdminClient()"));
  expect(source).toMatch(/const locked = await requireSettingsUnlock\(auth\.session\);\s*if \(locked\) return locked;/);
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
    // 160 points: stage 3 is what the points justify.
    psql(`INSERT INTO todo_point_awards (family_id, person_id, points, completion_key) VALUES ('${famId}', '${childId}', 160, 'claude-pin-stage')`);
    const track = await api.patch(`/api/creatures/${childId}`, { data: { best_tier: 3, last_seen_tier: 3 } });
    expect(track.status(), await track.text()).toBe(200);
    expect(creature("best_tier || '|' || last_seen_tier")).toBe("3|3");
    const down = await api.patch(`/api/creatures/${childId}`, { data: { best_tier: 1, last_seen_tier: 2 } });
    expect(down.status(), await down.text()).toBe(200);
    expect(creature("best_tier || '|' || last_seen_tier")).toBe("3|2");
  });

  test("a child's screen cannot grow its own creature: the stages are held to what the points or the money justify", async () => {
    lock();
    // Points: 160 earned is stage 3, whatever the screen says.
    const high = await api.patch(`/api/creatures/${childId}`, { data: { best_tier: 8, last_seen_tier: 8 } });
    expect(high.status(), await high.text()).toBe(200);
    expect(creature("best_tier || '|' || last_seen_tier")).toBe("3|3");
    // Money: the account holds 10.00 (stage 5 with money) after the approval
    // earlier; the stage the balance reaches is the bound.
    await unlock();
    expect((await api.patch(`/api/creatures/${childId}`, { data: { grows_with: "money" } })).status()).toBe(200);
    lock();
    const balance = Number(psql(`SELECT balance_cents FROM pocket_money_accounts WHERE id = '${accountId}'`));
    const moneyTier = [0, 50, 150, 400, 1000, 3000, 8000, 20000].filter((t) => balance >= t).length;
    const rich = await api.patch(`/api/creatures/${childId}`, { data: { best_tier: 8, last_seen_tier: 8 } });
    expect(rich.status(), await rich.text()).toBe(200);
    expect(creature("best_tier")).toBe(String(Math.max(3, moneyTier)));
    expect(creature("last_seen_tier")).toBe(String(moneyTier));
    expect(moneyTier).toBeLessThan(8);
    await unlock();
    expect((await api.patch(`/api/creatures/${childId}`, { data: { grows_with: "points" } })).status()).toBe(200);
    psql(`DELETE FROM todo_point_awards WHERE completion_key = 'claude-pin-stage'`);
  });

  test("the old account PATCH forwards the creature's fields for one release, under the creature's rules", async () => {
    lock();
    // kid-side: the style, no PIN
    const style = await api.patch(`/api/pocket-money/accounts/${accountId}`, { data: { family_id: famId, avatar_style: "storybook" } });
    expect(style.status(), await style.text()).toBe(200);
    expect((await style.json()).account.id).toBe(accountId);
    expect(creature("style")).toBe("storybook");
    // the stage, clamped like the new route
    const stage = await api.patch(`/api/pocket-money/accounts/${accountId}`, { data: { family_id: famId, best_tier: 8 } });
    expect(stage.status(), await stage.text()).toBe(200);
    expect(Number(creature("best_tier"))).toBeLessThan(8);
    // parental: the species and the mode need the PIN, and a look sent with them is not written either
    const before = creature("species || '|' || grows_with || '|' || look::text");
    for (const data of [{ avatar_species: "cat", avatar_look: { body: "#56B6E8" } }, { reward_mode: "money" }]) {
      const res = await api.patch(`/api/pocket-money/accounts/${accountId}`, { data: { family_id: famId, ...data } });
      expect(res.status(), `${JSON.stringify(data)}: ${await res.text()}`).toBe(403);
    }
    expect(creature("species || '|' || grows_with || '|' || look::text")).toBe(before);
    // nothing outside the editor's sets
    const bogus = await api.patch(`/api/pocket-money/accounts/${accountId}`, { data: { family_id: famId, avatar_style: "neon" } });
    expect(bogus.status(), await bogus.text()).toBe(400);
    // with the PIN, the species goes to the creature; the account column stays as it was
    await unlock();
    const species = await api.patch(`/api/pocket-money/accounts/${accountId}`, { data: { family_id: famId, avatar_species: "cat" } });
    expect(species.status(), await species.text()).toBe(200);
    expect(creature("species")).toBe("cat");
    expect(psql(`SELECT avatar_species || '|' || avatar_style FROM pocket_money_accounts WHERE id = '${accountId}'`)).toBe("dragon|classic");
    expect((await api.patch(`/api/creatures/${childId}`, { data: { species: "dragon", style: "sticker" } })).status()).toBe(200);
  });

  test("the old reward paths forward for one release", async () => {
    lock();
    const add = await api.post("/api/pocket-money/rewards", { data: { title: `${P}old-path`, cost_points: 1 } });
    expect(add.status(), await add.text()).toBe(403);
    await unlock();
    const added = await api.post("/api/pocket-money/rewards", { data: { title: `${P}old-path`, cost_points: 1 } });
    expect(added.status(), await added.text()).toBe(201);
    const id = (await added.json()).reward.id;
    expect((await api.patch(`/api/pocket-money/rewards/${id}`, { data: { cost_points: 2 } })).status()).toBe(200);
    psql(`INSERT INTO todo_point_awards (family_id, person_id, points, completion_key) VALUES ('${famId}', '${childId}', 5, 'claude-pin-old')`);
    lock();
    const ask = await api.post(`/api/pocket-money/accounts/${accountId}/redemptions`, { data: { reward_id: id } });
    expect(ask.status(), await ask.text()).toBe(201);
    const redemption = (await ask.json()).redemption;
    expect(redemption.person_id).toBe(childId);
    const decide = await api.patch(`/api/pocket-money/redemptions/${redemption.id}`, { data: { status: "denied" } });
    expect(decide.status(), await decide.text()).toBe(403);
    await unlock();
    expect((await api.patch(`/api/pocket-money/redemptions/${redemption.id}`, { data: { status: "denied" } })).status()).toBe(200);
    expect((await api.delete(`/api/pocket-money/rewards/${id}`)).status()).toBe(200);
    psql(`DELETE FROM todo_point_awards WHERE completion_key = 'claude-pin-old'`);
  });

  test("a child in the recycle bin cannot be given a creature, and cannot redeem", async () => {
    await unlock();
    const binned = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', '${P}kid-binned', true) RETURNING id`);
    psql(`INSERT INTO creatures (person_id, family_id) VALUES ('${binned}', '${famId}')`);
    psql(`INSERT INTO todo_point_awards (family_id, person_id, points, completion_key) VALUES ('${famId}', '${binned}', 100, 'claude-pin-binned')`);
    const reward = (await (await api.post("/api/rewards", { data: { title: `${P}binned`, cost_points: 1 } })).json()).reward.id;
    psql(`UPDATE people SET deleted_at = now() WHERE id = '${binned}'`);
    const on = await api.post("/api/creatures", { data: { person_id: binned } });
    expect(on.status(), await on.text()).toBe(404);
    const ask = await api.post("/api/rewards/redemptions", { data: { person_id: binned, reward_id: reward } });
    expect(ask.status(), await ask.text()).toBe(404);
    expect(psql(`SELECT count(*) FROM point_redemptions WHERE person_id = '${binned}'`)).toBe("0");
    psql(`DELETE FROM todo_point_awards WHERE completion_key = 'claude-pin-binned'`);
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
