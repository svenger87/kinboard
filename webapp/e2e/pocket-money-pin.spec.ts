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

const ROOT = join(__dirname, "..", "src", "app", "api", "pocket-money");

const MUTATING_VERB = /export async function (POST|PATCH|PUT|DELETE)/;

/**
 * Mutating pocket-money routes that deliberately do NOT check the settings
 * PIN — the action belongs to the child, not a parent, so gating it would
 * just lock kids out of their own goals and requests.
 */
const PIN_FREE_BY_DESIGN: Record<string, string> = {
  // Asking for money is not spending it — only the parent's decision on the
  // request (withdrawal-requests/[id]/route.ts) moves anything.
  "accounts/[id]/withdrawal-requests/route.ts": "a child's own request for money, not the decision on it",
  // A child's own savings goal: creating one commits nothing.
  "accounts/[id]/goals/route.ts": "a child creating their own savings goal",
  // Renaming, reordering, retargeting or removing a goal is the same child
  // action as creating one — none of it moves money or a setting.
  "goals/[id]/route.ts": "editing or deleting a goal is the child's own, not a parental setting",
  // Redeeming points for a reward (#353) is the child's own request, like a
  // withdrawal request: it books nothing until a parent decides it, and that
  // decision (redemptions/[id]/route.ts) checks the PIN.
  "accounts/[id]/redemptions/route.ts": "a child's own request to redeem points, not the decision on it",
  // An image candidate for a goal. No family money or settings touched.
  "goal-image-upload/route.ts": "uploads an image for a goal; moves no money and changes no setting",
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

test("every mutating pocket-money route checks the settings PIN unless named as the child's own", () => {
  const files = routeFiles(ROOT);
  expect(files.length).toBeGreaterThan(5);

  const missing: string[] = [];
  for (const file of files) {
    const rel = file.slice(ROOT.length + 1);
    const source = readFileSync(file, "utf8");
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
  const flagged = routeFiles(ROOT)
    .map((f) => f.slice(ROOT.length + 1))
    .filter((rel) => {
      const source = readFileSync(join(ROOT, rel), "utf8");
      return MUTATING_VERB.test(source) && !source.includes("requireSettingsUnlock");
    });

  expect(flagged.sort()).toEqual(Object.keys(PIN_FREE_BY_DESIGN).sort());
});

test("the kid-side allowlist names routes that exist", () => {
  const present = new Set(routeFiles(ROOT).map((f) => f.slice(ROOT.length + 1)));
  const stale = Object.keys(PIN_FREE_BY_DESIGN).filter((rel) => !present.has(rel));
  expect(stale).toEqual([]);
});

test("the account PATCH gates only the parental fields, not the kid-side avatar fields", () => {
  // accounts/[id]/route.ts is the one route both sides call: a child's own
  // device writes last_seen_tier/best_tier on every visit and avatar_style
  // when they pick a new look, a parent writes
  // allowance/interest/currency/avatar_species from Settings. Gating the
  // whole route would 403 the kid-side write on every page load.
  const source = readFileSync(join(ROOT, "accounts/[id]/route.ts"), "utf8");
  expect(source).toContain("requireSettingsUnlock");
  // The call is conditional on the protected-field list, not unconditional —
  // i.e. it must not appear before the PATCH body is even inspected.
  expect(source).toMatch(/PIN_PROTECTED_FIELDS\.some\([\s\S]{0,200}?requireSettingsUnlock/);
  const list = source.slice(source.indexOf("const PIN_PROTECTED_FIELDS"), source.indexOf("] as const"));
  expect(list.length).toBeGreaterThan(0);
  for (const field of ["last_seen_tier", "best_tier", "avatar_style"]) {
    expect(
      list.includes(`"${field}"`) || list.includes(`'${field}'`),
      `${field} should not be in the protected list`,
    ).toBe(false);
  }
  // The species is still a parent's choice.
  expect(list).toContain(`"avatar_species"`);
  // And the style has no PIN check of its own further down: the block that
  // takes it ends before the next field without calling requireSettingsUnlock.
  const styleBlock = source.slice(source.indexOf("body.avatar_style !== undefined"), source.indexOf("body.last_seen_tier !== undefined"));
  expect(styleBlock).toContain("isAvatarStyle");
  expect(styleBlock).not.toContain("requireSettingsUnlock");
});

// ── live: approving without the server-side unlock is refused ─────────────

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const P = "claude-pm-pin-";
let api: APIRequestContext;
let famId = "";
let accountId = "";
let requestId = "";

function purge() {
  if (!famId) return;
  psql(`DELETE FROM pocket_money_withdrawal_requests WHERE account_id IN (SELECT id FROM pocket_money_accounts WHERE family_id = ${sqlText(famId)})`);
  psql(`DELETE FROM pocket_money_transactions WHERE account_id IN (SELECT id FROM pocket_money_accounts WHERE family_id = ${sqlText(famId)})`);
  psql(`DELETE FROM pocket_money_accounts WHERE family_id = ${sqlText(famId)}`);
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
    const childId = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', '${P}kid', true) RETURNING id`);
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

  test("the kid-side avatar-stage write on the same route needs no PIN", async () => {
    // Still locked from the previous test — this is the point: an
    // unprotected field must go through anyway.
    const track = await api.patch(`/api/pocket-money/accounts/${accountId}`, {
      data: { family_id: famId, best_tier: 2 },
    });
    expect(track.status(), await track.text()).toBe(200);
    expect(psql(`SELECT best_tier FROM pocket_money_accounts WHERE id = '${accountId}'`)).toBe("2");
  });

  test("a child picks their avatar's look with no PIN, but only one of the four", async () => {
    // Still locked: this is the kid's own screen.
    psql(`UPDATE device_sessions SET settings_unlocked_until = NULL WHERE family_id = '${famId}'`);
    const look = await api.patch(`/api/pocket-money/accounts/${accountId}`, {
      data: { family_id: famId, avatar_style: "sticker" },
    });
    expect(look.status(), await look.text()).toBe(200);
    expect(psql(`SELECT avatar_style FROM pocket_money_accounts WHERE id = '${accountId}'`)).toBe("sticker");

    const bogus = await api.patch(`/api/pocket-money/accounts/${accountId}`, {
      data: { family_id: famId, avatar_style: "neon" },
    });
    expect(bogus.status(), await bogus.text()).toBe(400);
    expect(psql(`SELECT avatar_style FROM pocket_money_accounts WHERE id = '${accountId}'`)).toBe("sticker");
  });

  test("changing the species still needs the PIN, even sent together with a look", async () => {
    psql(`UPDATE device_sessions SET settings_unlocked_until = NULL WHERE family_id = '${famId}'`);
    const species = await api.patch(`/api/pocket-money/accounts/${accountId}`, {
      data: { family_id: famId, avatar_species: "cat", avatar_style: "gumdrop" },
    });
    expect(species.status(), await species.text()).toBe(403);
    expect((await species.json()).error).toBe("pin_required");
    expect(psql(`SELECT avatar_species || '|' || avatar_style FROM pocket_money_accounts WHERE id = '${accountId}'`)).toBe("dragon|sticker");
  });

  test("a child's own withdrawal request still needs no PIN", async () => {
    const create = await api.post(`/api/pocket-money/accounts/${accountId}/withdrawal-requests`, {
      data: { family_id: famId, amount_cents: 100, reason: `${P}second` },
    });
    expect(create.status(), await create.text()).toBe(201);
  });

  test("with the PIN, a parent may pick any of the new creatures; an unknown one is refused", async () => {
    const verify = await api.post("/api/pin", { data: { family_id: famId, action: "verify", pin: "4711" } });
    expect((await verify.json()).valid).toBe(true);
    for (const species of ["rex", "unicorn", "princess", "prince", "cat", "axolotl", "owl", "robot", "fox", "penguin", "bunny", "trike", "stego"]) {
      const res = await api.patch(`/api/pocket-money/accounts/${accountId}`, { data: { family_id: famId, avatar_species: species } });
      expect(res.status(), `${species}: ${await res.text()}`).toBe(200);
      expect(psql(`SELECT avatar_species FROM pocket_money_accounts WHERE id = '${accountId}'`)).toBe(species);
    }
    const bogus = await api.patch(`/api/pocket-money/accounts/${accountId}`, { data: { family_id: famId, avatar_species: "griffin" } });
    expect(bogus.status(), await bogus.text()).toBe(400);
    expect(psql(`SELECT avatar_species FROM pocket_money_accounts WHERE id = '${accountId}'`)).toBe("stego");
  });

  test("a new account for a creature with no classic pictures starts in Gumdrop; the dragon still starts on Classic", async () => {
    const kidA = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', '${P}kid-a', true) RETURNING id`);
    const kidB = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', '${P}kid-b', true) RETURNING id`);
    const kidC = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', '${P}kid-c', true) RETURNING id`);
    const unicorn = await api.post("/api/pocket-money/accounts", { data: { family_id: famId, person_id: kidA, avatar_species: "unicorn" } });
    expect(unicorn.status(), await unicorn.text()).toBe(201);
    expect((await unicorn.json()).account.avatar_style).toBe("gumdrop");
    const dragon = await api.post("/api/pocket-money/accounts", { data: { family_id: famId, person_id: kidB, avatar_species: "dragon" } });
    expect(dragon.status(), await dragon.text()).toBe(201);
    expect((await dragon.json()).account.avatar_style).toBe("classic");
    const bogus = await api.post("/api/pocket-money/accounts", { data: { family_id: famId, person_id: kidC, avatar_species: "griffin" } });
    expect(bogus.status(), await bogus.text()).toBe(400);
  });
});
