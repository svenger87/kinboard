import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ACTION_KIND_HANDLERS,
  ACTION_REQUEST_TTL_MS,
  createActionRequest,
  decideActionRequest,
  submitActionRequest,
  toAssistantStatus,
  trustedAnswer,
  trustedNoticeText,
  type ActionKindHandler,
  type ActionPatch,
  type ActionRequestRow,
  type ActionRequestStore,
  type ActionStatus,
  type ActionTranslator,
  type CreateActionInput,
  type CreateKindRequestInput,
  type DecideDeps,
  type NewActionRow,
  type PushRequest,
  type SubmitDeps,
} from "../src/lib/home/action-requests";
import { setAssistantTrust, type TrustDeps } from "../src/lib/assistant-trust";
import {
  IN_PROGRESS, markBefore, rememberHomeAction, rememberStoredRequest, withIdempotency,
  type IdempotencyStore, type IdempotentResult, type StoredResult,
} from "../src/lib/integration-idempotency";
import { BOOKING_SIDE_EFFECTS, requestPocketMoneyBooking, type BookingRequestDeps } from "../src/lib/integration-pocket-money";
import { REWARD_DECISION_SIDE_EFFECTS, requestRewardDecision, type RewardDecisionRequestDeps } from "../src/lib/integration-reward-decisions";
import { HOME_SIDE_EFFECTS, runHomeAction, type HomeDeps } from "../src/lib/home/devices";
import en from "../messages/en.json";
import de from "../messages/de.json";
import fr from "../messages/fr.json";
import { createTranslator } from "next-intl";

/**
 * "Trust this assistant" (one switch per assistant connection).
 *
 * The request flow is `submitActionRequest` against the same counting fakes
 * as e2e/assistant-actions.spec.ts: a trusted assistant's request runs at
 * once through `runApproved` — the steps a PIN approval runs — and an
 * untrusted one is exactly `createActionRequest`. The switch is
 * `setAssistantTrust` against a fake table. The database half (the trigger
 * that drops trust on revoke, the grants) and the screens are in
 * e2e/assistant-trust-live.spec.ts.
 */

const FAMILY = "11111111-1111-1111-1111-111111111111";
const OTHER_FAMILY = "22222222-2222-2222-2222-222222222222";
const TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TOKEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DEVICE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CHILD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REDEMPTION = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const T0 = new Date("2026-10-01T12:00:00.000Z");

const EN = createTranslator({ locale: "en", messages: en, namespace: "assistantActions" }) as unknown as ActionTranslator;

let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function fakeStore(opts: { revoked?: Set<string> } = {}) {
  const rows = new Map<string, ActionRequestRow>();
  const revoked = opts.revoked ?? new Set<string>();
  const log = { inserts: [] as NewActionRow[], transitions: [] as { id: string; from: ActionStatus; patch: ActionPatch }[] };
  const store: ActionRequestStore = {
    insert: async (row) => {
      log.inserts.push(row);
      const full: ActionRequestRow = { ...row, id: newId(), created_at: T0.toISOString() };
      rows.set(full.id, full);
      return { ...full };
    },
    get: async (id, familyId) => {
      const r = rows.get(id);
      return r && r.family_id === familyId ? { ...r } : null;
    },
    listPending: async (familyId) =>
      [...rows.values()].filter((r) => r.family_id === familyId && r.status === "pending").map((r) => ({ ...r })),
    transition: async (id, familyId, from, patch, unexpiredAt) => {
      const r = rows.get(id);
      if (!r || r.family_id !== familyId || r.status !== from) return null;
      if (unexpiredAt && !(Date.parse(r.expires_at) > Date.parse(unexpiredAt))) return null;
      log.transitions.push({ id, from, patch });
      Object.assign(r, patch);
      return { ...r };
    },
    tokenActive: async (tokenId) => tokenId !== null && !revoked.has(tokenId),
  };
  return { store, rows, log, revoked };
}

/** What a PIN approval runs with, counting every call that would reach the outside. */
function decideDeps(store: ActionRequestStore, opts: {
  catalogue?: boolean;
  redemption?: { status: string; cost_points?: number; person_id?: string } | null;
} = {}) {
  const ha: unknown[][] = [];
  const bookings: unknown[] = [];
  const decisions: unknown[] = [];
  const pinChecks: string[] = [];
  const d: DecideDeps = {
    store,
    hasPin: async () => true,
    verifyPin: async (_f, pin) => {
      pinChecks.push(pin);
      return pin === "4711" ? "valid" : "invalid";
    },
    callHaService: async (...args) => {
      ha.push(args);
      return { ok: true, status: 200 };
    },
    catalogueEntity: async (_f, entityId) => (opts.catalogue === false ? null : { entityId }),
    pocketMoneyAccount: async () => ({ accountId: "acc-1", currency: "EUR" }),
    bookPocketMoney: async (input) => {
      bookings.push(input);
      return { ok: true, transactionId: "tx-1", balanceCents: 1500 } as never;
    },
    rewardRedemption: async () => {
      const r = opts.redemption === undefined ? { status: "pending" } : opts.redemption;
      return r ? { id: REDEMPTION, person_id: r.person_id ?? CHILD, status: r.status, cost_points: r.cost_points ?? 30 } : null;
    },
    decideRedemption: async (input) => {
      decisions.push(input);
      return { status: 200, body: { status: input.decision } };
    },
    now: () => T0,
  };
  return { d, ha, bookings, decisions, pinChecks };
}

const HOME: CreateActionInput = {
  familyId: FAMILY, tokenId: TOKEN, clientName: "Claude", entityId: "cover.garage", entityName: "Garage door",
  room: "Garage", domain: "cover", service: "open_cover", data: {},
};
const BOOKING: CreateKindRequestInput = {
  kind: "pocket_money", familyId: FAMILY, tokenId: TOKEN, clientName: "Claude",
  data: { person_id: CHILD, person_name: "Mira", amount_cents: 500, currency: "EUR", type: "deposit", note: null },
};
const REWARD: CreateKindRequestInput = {
  kind: "reward_decision", familyId: FAMILY, tokenId: TOKEN, clientName: "Claude",
  data: { redemption_id: REDEMPTION, decision: "approve", person_id: CHILD, child_name: "Mira", reward_title: "Tablet time", cost_points: 30 },
};

/** submitActionRequest's dependencies, with trust answered by `trusted` (per token) and everything counted. */
function submitDeps(opts: {
  trusted?: (familyId: string, tokenId: string) => boolean | Promise<boolean>;
  catalogue?: boolean;
  redemption?: { status: string; cost_points?: number; person_id?: string } | null;
  revoked?: Set<string>;
} = {}) {
  const s = fakeStore({ revoked: opts.revoked });
  const dd = decideDeps(s.store, opts);
  const pushes: PushRequest[] = [];
  const notices: ActionRequestRow[] = [];
  const trustReads: string[] = [];
  const deps: SubmitDeps = {
    store: s.store,
    push: async (p) => { pushes.push(p); },
    trusted: async (familyId, tokenId) => {
      trustReads.push(tokenId);
      return opts.trusted ? await opts.trusted(familyId, tokenId) : false;
    },
    decide: dd.d,
    notice: async (row) => { notices.push(row); },
    now: () => T0,
  };
  return { ...s, ...dd, deps, pushes, notices, trustReads };
}

const onlyTrusted = (token: string) => (_f: string, t: string) => t === token;

// ── the request flow ────────────────────────────────────────────────────────

test.describe("an untrusted assistant: exactly as before", () => {
  test("submitActionRequest stores and pushes the same row createActionRequest does, and runs nothing", async () => {
    for (const input of [HOME, BOOKING, REWARD]) {
      const viaSubmit = submitDeps();
      const viaCreate = fakeStore();
      const createPushes: PushRequest[] = [];
      const submitted = await submitActionRequest(input, viaSubmit.deps);
      await createActionRequest(input, { store: viaCreate.store, push: async (p) => { createPushes.push(p); }, now: () => T0 });

      // Byte for byte: the inserted row has no trust field at all.
      expect(JSON.stringify(viaSubmit.log.inserts)).toBe(JSON.stringify(viaCreate.log.inserts));
      expect("decided_by_trust" in viaSubmit.log.inserts[0]).toBe(false);
      expect(viaSubmit.pushes.map((p) => p.request)).toEqual(createPushes.map((p) => p.request));
      expect(submitted.request).toBeUndefined();
      expect(viaSubmit.ha).toEqual([]);
      expect(viaSubmit.bookings).toEqual([]);
      expect(viaSubmit.decisions).toEqual([]);
      expect(viaSubmit.notices).toEqual([]);
    }
  });

  test("trust that cannot be read is no trust: the request waits for a person", async () => {
    const f = submitDeps({ trusted: () => { throw new Error("db down"); } });
    const submitted = await submitActionRequest(HOME, f.deps);
    expect(submitted.request).toBeUndefined();
    expect(f.rows.get(submitted.id)?.status).toBe("pending");
    expect(f.ha).toEqual([]);
    expect(f.pushes).toHaveLength(1);
  });

  test("its status answer has no allowed_by_trust field", () => {
    const row = { id: newId(), family_id: FAMILY, token_id: TOKEN, client_name: "Claude", kind: "home", entity_id: "lock.front_door",
      entity_name: "Front door", domain: "lock", service: "unlock", data: {}, status: "done", created_at: T0.toISOString(),
      expires_at: T0.toISOString(), decided_at: T0.toISOString(), decided_by_device_id: DEVICE, result: { status: 200 } } as ActionRequestRow;
    expect(Object.keys(toAssistantStatus(row, EN))).not.toContain("allowed_by_trust");
  });
});

test.describe("a trusted assistant: runs at once, through the confirm path", () => {
  test("a garage door: Home Assistant is called once with what was stored; the row is done, marked, with no device; no push; one notice", async () => {
    const f = submitDeps({ trusted: onlyTrusted(TOKEN) });
    const submitted = await submitActionRequest(HOME, f.deps);
    expect(f.ha).toEqual([[FAMILY, "cover", "open_cover", "cover.garage", {}]]);
    const row = f.rows.get(submitted.id)!;
    expect(row).toMatchObject({ status: "done", decided_by_trust: true, decided_by_device_id: null, decided_at: T0.toISOString(), result: { status: 200 } });
    // Never on a screen as a question, never pushed as one.
    expect(f.log.inserts[0].status).toBe("approved");
    expect(f.pushes).toEqual([]);
    expect(f.notices.map((n) => n.id)).toEqual([submitted.id]);
    expect(submitted.request?.status).toBe("done");
    expect(trustedAnswer(submitted.request!)).toEqual({ status: 200, body: { status: "done", request_id: submitted.id, allowed_by_trust: true } });
    // get_action_status says done, and that trust allowed it.
    expect(toAssistantStatus(row, EN)).toMatchObject({ status: "done", allowed_by_trust: true, kind: "home" });
  });

  test("a pocket-money booking and a reward decision run through their own handlers, once", async () => {
    const booking = submitDeps({ trusted: onlyTrusted(TOKEN) });
    const b = await submitActionRequest(BOOKING, booking.deps);
    expect(booking.bookings).toEqual([{ familyId: FAMILY, accountId: "acc-1", amountCents: 500, type: "manual_deposit", note: "Claude" }]);
    expect(b.request).toMatchObject({ status: "done", decided_by_trust: true });

    const reward = submitDeps({ trusted: onlyTrusted(TOKEN) });
    const r = await submitActionRequest(REWARD, reward.deps);
    // No screen allowed it, so no device is recorded as the decider.
    expect(reward.decisions).toEqual([{ familyId: FAMILY, redemptionId: REDEMPTION, decision: "approved", deviceId: null }]);
    expect(r.request).toMatchObject({ status: "done", decided_by_trust: true });
  });

  test("the handler it runs is the one a PIN approval runs: validate and execute once each, on both paths", async () => {
    const calls: string[] = [];
    const spy: ActionKindHandler = {
      validate: async (row, familyId, deps) => { calls.push(`validate:${row.decided_by_trust ? "trust" : "pin"}`); return ACTION_KIND_HANDLERS.home.validate(row, familyId, deps); },
      execute: async (row, familyId, deps) => { calls.push(`execute:${row.decided_by_trust ? "trust" : "pin"}`); return ACTION_KIND_HANDLERS.home.execute(row, familyId, deps); },
      describe: ACTION_KIND_HANDLERS.home.describe,
    };
    const trusted = submitDeps({ trusted: onlyTrusted(TOKEN) });
    trusted.d.kinds = { home: spy };
    await submitActionRequest(HOME, trusted.deps);

    const asked = submitDeps();
    asked.d.kinds = { home: spy };
    const pending = await submitActionRequest(HOME, asked.deps);
    await decideActionRequest({ id: pending.id, familyId: FAMILY, deviceId: DEVICE, decision: "approve", pin: "4711" }, asked.d);
    expect(calls).toEqual(["validate:trust", "execute:trust", "validate:pin", "execute:pin"]);
    // Trust skipped the PIN; the approval needed it.
    expect(trusted.pinChecks).toEqual([]);
    expect(asked.pinChecks).toEqual(["4711"]);
  });
});

test.describe("trust skips the person, never the checks", () => {
  test("a device no longer in the catalogue: failed, not_in_catalogue, Home Assistant never called, no notice", async () => {
    const f = submitDeps({ trusted: onlyTrusted(TOKEN), catalogue: false });
    const submitted = await submitActionRequest(HOME, f.deps);
    expect(f.ha).toEqual([]);
    expect(submitted.request).toMatchObject({ status: "failed", result: { status: 0, reason: "not_in_catalogue" } });
    expect(f.notices).toEqual([]);
    expect(trustedAnswer(submitted.request!).status).toBe(409);
  });

  test("an action outside the device's allowed actions: failed, not_allowed, Home Assistant never called", async () => {
    const f = submitDeps({ trusted: onlyTrusted(TOKEN) });
    // Not something control_device would store; proves the handler's own policy re-check holds under trust.
    const submitted = await submitActionRequest({ ...HOME, entityId: "lock.front_door", domain: "lock", service: "set_code", data: { code: "0000" } }, f.deps);
    expect(f.ha).toEqual([]);
    expect(submitted.request).toMatchObject({ status: "failed", result: { reason: "not_allowed" } });
  });

  test("a reward request answered meanwhile, or whose cost changed: nothing decided (the #389 re-read)", async () => {
    for (const [redemption, reason] of [
      [{ status: "approved" }, "reward_already_decided"],
      [{ status: "pending", cost_points: 99 }, "not_allowed"],
      [null, "reward_request_gone"],
    ] as const) {
      const f = submitDeps({ trusted: onlyTrusted(TOKEN), redemption });
      const submitted = await submitActionRequest(REWARD, f.deps);
      expect(f.decisions, reason).toEqual([]);
      expect(submitted.request, reason).toMatchObject({ status: "failed", result: { reason } });
      expect(f.notices, reason).toEqual([]);
    }
  });

  test("an assistant revoked as it runs: denied, nothing runs (expired or revoked tokens do not execute)", async () => {
    const f = submitDeps({ trusted: onlyTrusted(TOKEN), revoked: new Set([TOKEN]) });
    const submitted = await submitActionRequest(HOME, f.deps);
    expect(f.ha).toEqual([]);
    expect(submitted.request?.status).toBe("denied");
    expect(trustedAnswer(submitted.request!)).toMatchObject({ status: 409, body: { reason: "revoked" } });
  });

  test("the home route still refuses before anything is stored: not allowed, no PIN, over budget", async () => {
    let asked = 0;
    const deps = {
      catalogueEntities: async () => [],
      catalogueEntity: async (_f: string, entityId: string) => ({ entityId, name: "Garage door", room: null, domain: "cover" }),
      getHaStates: async () => new Map(),
      getHaState: async () => ({ entity_id: "cover.garage", state: "closed", attributes: { device_class: "garage" } }),
      callHaService: async () => ({ ok: true, status: 200 }),
      requestConfirmation: async () => { asked++; return { requestId: "r", expiresAt: "x", ran: { status: "done" } as ActionRequestRow }; },
      recordAction: async () => {},
      familyHasPin: async () => true,
      confirmationBudget: async () => ({ ok: true }),
    } as unknown as HomeDeps;
    const act = (body: unknown, over: Partial<HomeDeps> = {}) =>
      runHomeAction({ familyId: FAMILY, tokenId: TOKEN, tokenName: "Claude", rawEntity: "cover.garage", body }, { ...deps, ...over });

    expect((await act({ service: "set_code" })).status).toBe(400);
    expect((await act({ service: "open_cover" }, { familyHasPin: async () => false })).status).toBe(403);
    expect((await act({ service: "open_cover" }, { confirmationBudget: async () => ({ ok: false, retryAfterMs: 1000 }) })).status).toBe(429);
    expect(asked).toBe(0);
    // And when it does run under trust, the route says done.
    expect(await act({ service: "open_cover" })).toEqual({ status: 200, body: { status: "done", request_id: undefined, allowed_by_trust: true } });
    expect(asked).toBe(1);
  });
});

test.describe("isolation and races", () => {
  test("another assistant of the same family is not trusted: its request waits", async () => {
    const f = submitDeps({ trusted: onlyTrusted(TOKEN) });
    const other = await submitActionRequest({ ...HOME, tokenId: OTHER_TOKEN }, f.deps);
    expect(other.request).toBeUndefined();
    expect(f.rows.get(other.id)?.status).toBe("pending");
    expect(f.ha).toEqual([]);
    expect(f.trustReads).toEqual([OTHER_TOKEN]);
  });

  test("trust is read per family as well as per token", async () => {
    const f = submitDeps({ trusted: (familyId, tokenId) => familyId === OTHER_FAMILY && tokenId === TOKEN });
    const ours = await submitActionRequest(HOME, f.deps);
    expect(ours.request).toBeUndefined();
    expect(f.ha).toEqual([]);
  });

  test("trust switched off while it starts: the request goes back to waiting, is pushed, and nothing runs", async () => {
    let reads = 0;
    const f = submitDeps({ trusted: () => ++reads === 1 });
    const submitted = await submitActionRequest(HOME, f.deps);
    expect(reads).toBe(2);
    expect(f.ha).toEqual([]);
    const row = f.rows.get(submitted.id)!;
    expect(row).toMatchObject({ status: "pending", decided_by_trust: false, decided_at: null, decided_by_device_id: null });
    expect(f.pushes).toHaveLength(1);
    expect(f.notices).toEqual([]);
    expect(trustedAnswer(submitted.request!)).toEqual({
      status: 202, body: { status: "pending_confirmation", request_id: submitted.id, expires_at: new Date(T0.getTime() + ACTION_REQUEST_TTL_MS).toISOString() },
    });
    // ...where a person can now allow it, the ordinary way.
    const decided = await decideActionRequest({ id: submitted.id, familyId: FAMILY, deviceId: DEVICE, decision: "approve", pin: "4711" }, f.d);
    expect(decided.status).toBe(200);
    expect(f.ha).toHaveLength(1);
  });

  test("a notice that fails to post does not fail the action", async () => {
    const f = submitDeps({ trusted: onlyTrusted(TOKEN) });
    f.deps.notice = async () => { throw new Error("messages down"); };
    const submitted = await submitActionRequest(HOME, f.deps);
    expect(submitted.request?.status).toBe("done");
  });
});

test.describe("trustedAnswer", () => {
  const row = (over: Partial<ActionRequestRow>) => ({ id: "r1", status: "done", result: null, expires_at: "x", ...over }) as ActionRequestRow;
  test("may-or-may-not outcomes are 502; refusals before it ran are 409 with the reason", () => {
    expect(trustedAnswer(row({ status: "failed", result: { status: 500 } })).status).toBe(502);
    expect(trustedAnswer(row({ status: "failed", result: { status: 0, reason: "booking_failed" } })).status).toBe(502);
    expect(trustedAnswer(row({ status: "failed", result: { status: 0, reason: "insufficient_funds" } }))).toMatchObject({ status: 409, body: { reason: "insufficient_funds" } });
    expect(trustedAnswer(row({ status: "approved" })).status).toBe(502);
  });
});

// ── the switch ──────────────────────────────────────────────────────────────

/** A fake integration_tokens table: the live route's UPDATE, as its WHERE clauses say. */
function trustTable() {
  const rows = new Map<string, { family_id: string; oauth: boolean; revoked: boolean; trusted: boolean; by: string | null }>([
    [TOKEN, { family_id: FAMILY, oauth: true, revoked: false, trusted: false, by: null }],
    [OTHER_TOKEN, { family_id: OTHER_FAMILY, oauth: true, revoked: false, trusted: false, by: null }],
  ]);
  const pinChecks: string[] = [];
  let verdict: "valid" | "invalid" | "rate_limited" | null = null;
  let hasPin = true;
  const deps: TrustDeps = {
    hasPin: async () => hasPin,
    verifyPin: async (_f, pin) => { pinChecks.push(pin); return verdict ?? (pin === "4711" ? "valid" : "invalid"); },
    setTrust: async ({ familyId, tokenId, trusted, deviceId }) => {
      const r = rows.get(tokenId);
      if (!r || r.family_id !== familyId) return "not_found";
      if (trusted && (!r.oauth || r.revoked)) return "not_found";
      r.trusted = trusted;
      r.by = trusted ? deviceId : null;
      return "ok";
    },
  };
  return {
    rows, deps, pinChecks,
    setVerdict: (v: typeof verdict) => { verdict = v; },
    setHasPin: (v: boolean) => { hasPin = v; },
  };
}

const sw = (t: ReturnType<typeof trustTable>, body: unknown, tokenId = TOKEN, familyId = FAMILY) =>
  setAssistantTrust({ familyId, deviceId: DEVICE, tokenId, body }, t.deps);

test.describe("switching trust on and off", () => {
  test("on needs the settings PIN: none, wrong, or rate-limited is refused and nothing changes", async () => {
    const t = trustTable();
    expect(await sw(t, { trusted: true })).toEqual({ status: 400, body: { error: "invalid_request" } });
    expect(await sw(t, { trusted: true, pin: "0000" })).toEqual({ status: 403, body: { error: "pin_invalid" } });
    t.setVerdict("rate_limited");
    expect(await sw(t, { trusted: true, pin: "4711" })).toEqual({ status: 429, body: { error: "rate_limited" } });
    t.setVerdict(null);
    t.setHasPin(false);
    expect(await sw(t, { trusted: true, pin: "4711" })).toEqual({ status: 403, body: { error: "pin_required" } });
    expect(t.rows.get(TOKEN)?.trusted).toBe(false);
    t.setHasPin(true);
    expect(await sw(t, { trusted: true, pin: "4711" })).toEqual({ status: 200, body: { trusted: true } });
    expect(t.rows.get(TOKEN)).toMatchObject({ trusted: true, by: DEVICE });
  });

  test("off needs no PIN and never touches the PIN limiter", async () => {
    const t = trustTable();
    t.rows.get(TOKEN)!.trusted = true;
    expect(await sw(t, { trusted: false })).toEqual({ status: 200, body: { trusted: false } });
    expect(t.rows.get(TOKEN)?.trusted).toBe(false);
    expect(t.pinChecks).toEqual([]);
  });

  test("family-scoped: another family's assistant is 404 and stays as it was, PIN or not", async () => {
    const t = trustTable();
    expect(await sw(t, { trusted: true, pin: "4711" }, OTHER_TOKEN)).toEqual({ status: 404, body: { error: "not_found" } });
    t.rows.get(OTHER_TOKEN)!.trusted = true;
    expect(await sw(t, { trusted: false }, OTHER_TOKEN)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(t.rows.get(OTHER_TOKEN)?.trusted).toBe(true);
  });

  test("a revoked connection or a hand-made token cannot be trusted", async () => {
    const t = trustTable();
    t.rows.get(TOKEN)!.revoked = true;
    expect((await sw(t, { trusted: true, pin: "4711" })).status).toBe(404);
    t.rows.get(TOKEN)!.revoked = false;
    t.rows.get(TOKEN)!.oauth = false;
    expect((await sw(t, { trusted: true, pin: "4711" })).status).toBe(404);
    expect(t.rows.get(TOKEN)?.trusted).toBe(false);
  });

  test("anything but a boolean, or an id that is not one, changes nothing", async () => {
    const t = trustTable();
    expect((await sw(t, { trusted: "yes", pin: "4711" })).status).toBe(400);
    expect((await sw(t, null)).status).toBe(400);
    expect((await sw(t, { trusted: true, pin: "4711" }, "not-a-uuid")).status).toBe(404);
  });
});

// ── no way in for an assistant ──────────────────────────────────────────────

const SRC = join(__dirname, "..", "src");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test.describe("an assistant cannot trust itself", () => {
  test("only the session route writes trusted_at; nothing an Integration API token or MCP tool reaches does", () => {
    const writers = files(SRC).filter((f) => /trusted_at\s*:/.test(readFileSync(f, "utf8")));
    expect(writers.map((f) => f.slice(SRC.length + 1)).sort()).toEqual([
      "app/api/assistants/[id]/trust/route.ts",
      "app/api/integration-tokens/route.ts",
    ]);
    // The list route only declares the field's type and reads it.
    expect(read("app/api/integration-tokens/route.ts")).not.toMatch(/\.update\([^)]*trusted_at/);
    const route = read("app/api/assistants/[id]/trust/route.ts");
    expect(route).toContain("requireSession(request)");
    expect(route).not.toContain("withIntegrationAuth");
    for (const f of files(join(SRC, "app", "api", "integration")).concat(files(join(SRC, "lib", "mcp")))) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toContain("assistants/");
      expect(text, f).not.toContain("setAssistantTrust");
    }
  });

  test("the live trust check reads the connection, bound to family, assistant client and revocation", () => {
    const live = read("lib/home/action-requests-live.ts");
    const fn = live.slice(live.indexOf("export async function liveAssistantTrusted"), live.indexOf("export async function liveTrustedNotice"));
    for (const part of ['.eq("id", tokenId)', "data.family_id === familyId", "!!data.trusted_at", "!data.revoked_at", "!!data.oauth_client_id"]) {
      expect(fn, part).toContain(part);
    }
    // Every request reads it afresh; nothing caches it.
    expect(fn).not.toMatch(/cache|Map\(/);
  });

  test("every flow that asks for a person submits through the trust-aware path", () => {
    expect(read("lib/home/live.ts")).toContain("submitActionRequest(");
    expect(read("lib/integration-pocket-money.ts")).toContain("submitActionRequest(input, liveSubmitDeps)");
    expect(read("lib/integration-reward-decisions.ts")).toContain("submitActionRequest(input, liveSubmitDeps)");
    const live = read("lib/home/action-requests-live.ts");
    expect(live).toMatch(/liveSubmitDeps: SubmitDeps = \{[^}]*decide: liveDecideDeps/);
  });

  test("an assistant cannot acknowledge the notice of what it did", () => {
    const ack = read("app/api/integration/v1/messages/[id]/acknowledge/route.ts");
    expect(ack.indexOf("isTrustNotice(")).toBeGreaterThan(0);
    expect(ack.indexOf("isTrustNotice(")).toBeLessThan(ack.indexOf("acknowledgeMessage(context.familyId, id)"));
  });
});

test.describe("the migration", () => {
  const sql = readFileSync(join(__dirname, "..", "docker", "migration_zzzzzzzzzzz_assistant_trust.sql"), "utf8");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  test("grants nothing to anyone, and runs safely twice at once", () => {
    expect(code).not.toMatch(/\bGRANT\b/i);
    expect(code).toContain("pg_advisory_lock(");
    expect(code).toContain("pg_advisory_unlock(");
    for (const add of code.match(/ADD COLUMN [^\n]+/g) ?? []) expect(add).toContain("IF NOT EXISTS");
    expect(code).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_trigger/);
  });

  test("a row is never born trusted, and revoking or losing the client drops trust", () => {
    expect(code).toMatch(/IF TG_OP = 'INSERT' OR NEW\.revoked_at IS NOT NULL OR NEW\.oauth_client_id IS NULL THEN\s+NEW\.trusted_at := NULL;/);
    expect(code).toContain("BEFORE INSERT OR UPDATE ON public.integration_tokens");
    expect(code).toContain("trusted_at IS NULL OR (revoked_at IS NULL AND oauth_client_id IS NOT NULL)");
    // Off for everyone it finds: nothing here sets trust.
    expect(code).not.toMatch(/SET\s+trusted_at\s*=/i);
  });

  test("sorts after the reward-decision kind, in byte order and under an en_US collation", () => {
    const names = ["migration_zzzzzzzzzz_reward_decision_kind.sql", "migration_zzzzzzzzzzz_assistant_trust.sql"];
    expect([...names].sort()).toEqual(names);
    expect([...names].sort(new Intl.Collator("en-US").compare)).toEqual(names);
  });
});

test.describe("the words", () => {
  test("the warning, in every language, says it happens right away and names doors and pocket money", () => {
    for (const [lang, m, words] of [
      ["en", en, ["right away", "unlocking doors", "pocket money", "web page"]],
      ["de", de, ["sofort", "Türen", "Taschengeld", "Webseite"]],
      ["fr", fr, ["immédiatement", "portes", "argent de poche", "page web"]],
    ] as const) {
      const warning = (m.settings.integrations as Record<string, string>).trustWarning;
      for (const w of words) expect(warning, `${lang}: ${w}`).toContain(w);
      expect((m.assistantActions as Record<string, unknown>).trustedNotice, lang).toContain("{action}");
    }
  });

  test("the notice says what happened, in the family's words for it", () => {
    expect(EN("trustedNotice", { action: "open Garage door" })).toBe("Done without asking: open Garage door");
  });
});

// ── one key, one run ────────────────────────────────────────────────────────

/**
 * The idempotency table as the database keeps it: one row per (family, key),
 * and an INSERT that loses to an existing row learns what is there. Every
 * call yields first, so concurrent requests really interleave.
 */
function idempotencyTable(opts: { failComplete?: boolean } = {}) {
  const rows = new Map<string, StoredResult & { service: string }>();
  const id = (familyId: string, key: string) => `${familyId}/${key}`;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const store: IdempotencyStore = {
    reserve: async ({ familyId, key, service, requestHash }) => {
      await tick();
      const existing = rows.get(id(familyId, key));
      if (existing) return { kind: "taken", stored: { ...existing } };
      rows.set(id(familyId, key), { status: IN_PROGRESS, response: { in_progress: true }, request_hash: requestHash, service });
      return { kind: "reserved" };
    },
    complete: async ({ familyId, key, status, response }) => {
      await tick();
      if (opts.failComplete) throw new Error("insert failed");
      const r = rows.get(id(familyId, key));
      if (!r || r.status !== IN_PROGRESS) throw new Error("gone");
      Object.assign(r, { status, response });
    },
    release: async ({ familyId, key }) => {
      await tick();
      const r = rows.get(id(familyId, key));
      if (r?.status === IN_PROGRESS) rows.delete(id(familyId, key));
    },
  };
  return { store, rows };
}

/** A gate a test opens: Home Assistant (or the booking) waits on it, as a slow one does. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => { open = r; });
  return { opened, open };
}

/** The home route's composition: runHomeAction → requestConfirmation → submitActionRequest, trusted, with a slow Home Assistant. */
function trustedHome(opts: { trusted?: boolean; slow?: Promise<void>; entity?: string; haOk?: boolean; stateThrows?: boolean } = {}) {
  const f = submitDeps({ trusted: () => opts.trusted ?? true });
  const ha: unknown[] = [];
  f.d.callHaService = async (...args) => { ha.push(args); await opts.slow; return { ok: true, status: 200 }; };
  const deps = {
    catalogueEntities: async () => [],
    catalogueEntity: async (_f: string, entityId: string) => ({ entityId, name: "Garage door", room: "Garage", domain: "cover" }),
    getHaStates: async () => new Map(),
    getHaState: async () => {
      if (opts.stateThrows) throw new Error("db hiccup");
      return { entity_id: opts.entity ?? "cover.garage", state: "closed", attributes: { device_class: "garage" } };
    },
    // A direct (not sensitive) action calls Home Assistant itself.
    callHaService: async (...args: unknown[]) => { ha.push(args); await opts.slow; return opts.haOk === false ? { ok: false, status: 500 } : { ok: true, status: 200 }; },
    requestConfirmation: async (r: { familyId: string; tokenId: string; tokenName: string; entityId: string; entityName: string; room: string | null; domain: string; service: string; data: Record<string, unknown> }) => {
      const out = await submitActionRequest({ familyId: r.familyId, tokenId: r.tokenId, clientName: r.tokenName, entityId: r.entityId,
        entityName: r.entityName, room: r.room, domain: r.domain, service: r.service, data: r.data }, f.deps);
      return { requestId: out.id, expiresAt: out.expiresAt, ran: out.request };
    },
    recordAction: async () => {},
    familyHasPin: async () => true,
    confirmationBudget: async () => ({ ok: true }),
  } as unknown as HomeDeps;
  const entity = opts.entity ?? "cover.garage";
  const service = entity.startsWith("light.") ? "turn_on" : "open_cover";
  // As the route runs it: the side effects mark where it starts to act.
  const run = (mark: () => void = () => {}) =>
    runHomeAction({ familyId: FAMILY, tokenId: TOKEN, tokenName: "Claude", rawEntity: entity, body: { service } }, markBefore(deps, HOME_SIDE_EFFECTS, mark));
  return { f, ha, run };
}

/** The booking route's composition: requestPocketMoneyBooking → createRequest = submitActionRequest, trusted. */
function trustedBooking(opts: { trusted?: boolean; slow?: Promise<void>; lookupThrows?: () => boolean; insertThrows?: boolean } = {}) {
  const f = submitDeps({ trusted: () => opts.trusted ?? true });
  const bookings: unknown[] = [];
  f.d.bookPocketMoney = async (input) => { bookings.push(input); await opts.slow; return { ok: true, transactionId: "tx", balanceCents: 1500 } as never; };
  const deps: BookingRequestDeps = {
    lookupChild: async () => {
      if (opts.lookupThrows?.()) throw new Error("Failed to read the child: connection reset");
      return { status: "ok", name: "Mira", account: { id: "acc-1", currency: "EUR", balanceCents: 1000 } };
    },
    familyHasPin: async () => true,
    confirmationBudget: async () => ({ ok: true }),
    createRequest: (input) => submitActionRequest(input, f.deps),
  };
  if (opts.insertThrows) {
    const insert = f.store.insert;
    f.store.insert = async (row) => { void insert; throw new Error("Failed to store the action request: timeout"); };
  }
  const run = (mark: () => void = () => {}) => requestPocketMoneyBooking({ familyId: FAMILY, tokenId: TOKEN, clientName: "Claude",
    body: { person_id: CHILD, amount: 5, type: "deposit" } }, markBefore(deps, BOOKING_SIDE_EFFECTS, mark));
  return { f, bookings, run };
}

/** The reward-decision route's composition: requestRewardDecision → createRequest = submitActionRequest, trusted. */
function trustedReward(opts: { lookupThrows?: () => boolean } = {}) {
  const f = submitDeps({ trusted: () => true });
  const deps: RewardDecisionRequestDeps = {
    lookupRedemption: async () => {
      if (opts.lookupThrows?.()) throw new Error("Failed to read the reward request: connection reset");
      return { id: REDEMPTION, person_id: CHILD, child_name: "Mira", title: "Tablet time", cost_points: 30, status: "pending" };
    },
    pointBalance: async () => 100,
    decisionPending: async () => false,
    familyHasPin: async () => true,
    confirmationBudget: async () => ({ ok: true }),
    createRequest: (input) => submitActionRequest(input, f.deps),
  };
  const run = (mark: () => void = () => {}) => requestRewardDecision({ familyId: FAMILY, tokenId: TOKEN, clientName: "Claude",
    redemptionId: REDEMPTION, body: { decision: "approve" } }, markBefore(deps, REWARD_DECISION_SIDE_EFFECTS, mark));
  return { f, decisions: f.decisions, run };
}

const idem = (store: IdempotencyStore, run: (mark: () => void) => Promise<IdempotentResult>, key = "key-00000001", hash = "h1", remember = rememberStoredRequest) =>
  withIdempotency({ familyId: FAMILY, key, service: "test", requestHash: hash, remember }, run, store);

for (const [name, make, executions] of [
  ["a garage door", trustedHome, (x: ReturnType<typeof trustedHome>) => x.ha.length],
  ["a pocket-money booking", trustedBooking, (x: ReturnType<typeof trustedBooking>) => x.bookings.length],
] as const) {
  test.describe(`one Idempotency-Key runs a trusted action once: ${name}`, () => {
    test("two requests with the same key at the same moment: exactly one runs, the other is told it is in progress", async () => {
      const g = gate();
      const x = (make as (o: { slow: Promise<void> }) => ReturnType<typeof trustedHome> & ReturnType<typeof trustedBooking>)({ slow: g.opened });
      const { store } = idempotencyTable();
      const both = Promise.all([idem(store, x.run), idem(store, x.run)]);
      setTimeout(g.open, 20);
      const answers = await both;
      expect((executions as (v: unknown) => number)(x)).toBe(1);
      expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
      expect(answers.find((a) => a.status === 409)?.body).toMatchObject({ reason: "in_progress" });
    });

    test("a retry while the first is still running does not run it; once finished, a retry replays the answer", async () => {
      const g = gate();
      const x = (make as (o: { slow: Promise<void> }) => ReturnType<typeof trustedHome> & ReturnType<typeof trustedBooking>)({ slow: g.opened });
      const { store } = idempotencyTable();
      const first = idem(store, x.run);
      await new Promise((r) => setTimeout(r, 10));
      const retry = await idem(store, x.run);
      expect(retry).toMatchObject({ status: 409, body: { reason: "in_progress" }, headers: { "retry-after": "2" } });
      g.open();
      const done = await first;
      expect(done).toMatchObject({ status: 200, body: { status: "done", allowed_by_trust: true } });
      const replay = await idem(store, x.run);
      expect(replay).toEqual({ status: 200, body: done.body, headers: { "idempotent-replay": "true" } });
      expect((executions as (v: unknown) => number)(x)).toBe(1);
    });

    test("the result could not be stored: the first still answers, the failure is logged, and a retry does not run it again", async () => {
      const x = (make as () => ReturnType<typeof trustedHome> & ReturnType<typeof trustedBooking>)();
      const { store } = idempotencyTable({ failComplete: true });
      const logged: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => { logged.push(String(args[0])); };
      try {
        expect((await idem(store, x.run)).status).toBe(200);
        expect(await idem(store, x.run)).toMatchObject({ status: 409, body: { reason: "in_progress" } });
      } finally {
        console.error = original;
      }
      expect((executions as (v: unknown) => number)(x)).toBe(1);
      expect(logged.some((l) => l.includes("[idempotency] could not store the result"))).toBe(true);
    });
  });
}

test.describe("one Idempotency-Key: the untrusted and refused paths", () => {
  test("untrusted: two requests at once store exactly one pending request; a retry replays it", async () => {
    const x = trustedBooking({ trusted: false });
    const { store } = idempotencyTable();
    const answers = await Promise.all([idem(store, x.run), idem(store, x.run)]);
    expect(answers.map((a) => a.status).sort()).toEqual([202, 409]);
    expect(x.f.log.inserts).toHaveLength(1);
    expect(x.f.log.inserts[0].status).toBe("pending");
    expect(x.bookings).toEqual([]);
    const replay = await idem(store, x.run);
    expect(replay.body.request_id).toBe(answers.find((a) => a.status === 202)?.body.request_id);
    expect(x.f.log.inserts).toHaveLength(1);
  });

  test("a refusal gives the key back, so a corrected retry runs; another body under the key is a conflict", async () => {
    const { store } = idempotencyTable();
    let runs = 0;
    const refused = async () => { runs++; return { status: 400, body: { error: "no" } }; };
    await idem(store, refused);
    await idem(store, refused);
    expect(runs).toBe(2);
    await idem(store, async () => { runs++; return { status: 202, body: { request_id: "r" } }; });
    expect(await idem(store, refused, "key-00000001", "h2")).toMatchObject({ status: 409, body: { code: "conflict" } });
    expect(runs).toBe(3);
  });

  test("work that throws after it started keeps the key: its outcome is unknown, so a retry is refused", async () => {
    const { store } = idempotencyTable();
    let runs = 0;
    await expect(idem(store, async (mark) => { runs++; mark(); throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await idem(store, async () => { runs++; return { status: 200, body: {} }; })).toMatchObject({ status: 409, body: { reason: "in_progress" } });
    expect(runs).toBe(1);
  });

  test("work that throws before it started gives the key back: a retry runs", async () => {
    const { store, rows } = idempotencyTable();
    await expect(idem(store, async () => { throw new Error("db hiccup"); })).rejects.toThrow("db hiccup");
    expect(rows.size).toBe(0);
    expect(await idem(store, async () => ({ status: 202, body: { request_id: "r" } }))).toMatchObject({ status: 202 });
  });

  test("a database error while looking the child up: nothing ran, the key is free, and the retry books once", async () => {
    let fail = true;
    const x = trustedBooking({ lookupThrows: () => fail });
    const { store } = idempotencyTable();
    await expect(idem(store, x.run)).rejects.toThrow("connection reset");
    expect(x.bookings).toEqual([]);
    fail = false;
    expect(await idem(store, x.run)).toMatchObject({ status: 200, body: { status: "done" } });
    expect(x.bookings).toHaveLength(1);
  });

  test("a database error while reading the reward request: nothing ran, the key is free, and the retry decides once", async () => {
    let fail = true;
    const x = trustedReward({ lookupThrows: () => fail });
    const { store } = idempotencyTable();
    await expect(idem(store, x.run)).rejects.toThrow("connection reset");
    fail = false;
    expect(await idem(store, x.run)).toMatchObject({ status: 200, body: { status: "done", decision: "approve" } });
    expect(x.decisions).toHaveLength(1);
  });

  test("a device state that could not be read for an unexpected reason: nothing ran, the key is free", async () => {
    const x = trustedHome({ stateThrows: true });
    const { store, rows } = idempotencyTable();
    await expect(idem(store, x.run, "key-00000001", "h1", rememberHomeAction)).rejects.toThrow("db hiccup");
    expect(rows.size).toBe(0);
    expect(x.ha).toEqual([]);
  });

  test("storing the request failed after it started: the key stays taken and the retry is refused", async () => {
    const x = trustedBooking({ insertThrows: true });
    const { store } = idempotencyTable();
    await expect(idem(store, x.run)).rejects.toThrow("Failed to store the action request");
    expect(await idem(store, x.run)).toMatchObject({ status: 409, body: { reason: "in_progress" } });
  });

  test("a direct home action Home Assistant did not confirm (502): a retry replays it and does not call Home Assistant again", async () => {
    const x = trustedHome({ entity: "light.kitchen", haOk: false });
    const { store } = idempotencyTable();
    const first = await idem(store, x.run, "key-00000001", "h1", rememberHomeAction);
    expect(first.status).toBe(502);
    const retry = await idem(store, x.run, "key-00000001", "h1", rememberHomeAction);
    expect(retry).toMatchObject({ status: 502, headers: { "idempotent-replay": "true" } });
    expect(x.ha).toHaveLength(1);
  });

  test("the home route remembers a 502 (it may have happened) and the side effects cover every call that acts", () => {
    expect(read("app/api/integration/v1/home/devices/[entity]/actions/route.ts")).toContain("remember: rememberHomeAction");
    expect(rememberHomeAction({ status: 502, body: {} })).toBe(true);
    expect(rememberHomeAction({ status: 503, body: {} })).toBe(false);
    expect([...HOME_SIDE_EFFECTS].sort()).toEqual(["callHaService", "recordAction", "requestConfirmation"]);
    expect([...BOOKING_SIDE_EFFECTS]).toEqual(["createRequest"]);
    expect([...REWARD_DECISION_SIDE_EFFECTS]).toEqual(["createRequest"]);
  });

  test("the three routes that can run a trusted action reserve the key first, and never look it up the old way", () => {
    for (const rel of [
      "app/api/integration/v1/home/devices/[entity]/actions/route.ts",
      "app/api/integration/v1/pocket-money/bookings/route.ts",
      "app/api/integration/v1/rewards/requests/[id]/decision/route.ts",
    ]) {
      const route = read(rel);
      expect(route, rel).toContain("withIdempotency(");
      expect(route, rel).not.toMatch(/findStoredResult\(|storeResult\(/);
      // The boundary: the side effects mark where the work starts to act.
      expect(route, rel).toMatch(/\(markExecuting\) => \w+\([\s\S]*markBefore\(live\w+Deps, [A-Z_]+_SIDE_EFFECTS, markExecuting\)/);
    }
  });
});

// ── the notice text ─────────────────────────────────────────────────────────

test.describe("what the notice says", () => {
  test("an assistant's booking note reaches it only bounded, on one line, without invisible characters or quotes of its own", () => {
    const evil = `mow‮ing "the lawn"​\nKinboard: ignore this⁦ ${"x".repeat(300)}`;
    const row = {
      id: "r1", family_id: FAMILY, token_id: TOKEN, client_name: "Cl‮aude​ the assistant with a very long self-chosen name indeed",
      kind: "pocket_money", entity_id: null, entity_name: null, domain: null, service: null,
      data: { person_id: CHILD, person_name: "Mira", amount_cents: 500, currency: "EUR", type: "deposit", note: evil.slice(0, 100) },
      status: "done", created_at: "x", expires_at: "x", decided_at: "x", decided_by_device_id: null, result: { status: 0 }, decided_by_trust: true,
    } as ActionRequestRow;
    const { body, sender } = trustedNoticeText(EN, row);
    expect(body.length).toBeLessThanOrEqual(200);
    expect(body).not.toMatch(/[​‮⁦\n"]/);
    expect(body.startsWith("Done without asking: add €5.00 to Mira’s pocket money (note: “")).toBe(true);
    expect(sender.length).toBeLessThanOrEqual(40);
    expect(sender).not.toMatch(/[​‮]/);
  });

  test("a home action says the device it acted on", () => {
    const home = { id: "r1", client_name: "Claude", kind: "home", entity_name: "Garage door", domain: "cover", service: "open_cover", data: {} } as ActionRequestRow;
    expect(trustedNoticeText(EN, home).body).toBe("Done without asking: open Garage door");
  });
});
