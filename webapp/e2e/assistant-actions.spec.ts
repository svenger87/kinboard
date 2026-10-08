import { test, expect } from "@playwright/test";
import {
  ACTION_KIND_HANDLERS,
  ACTION_STATUS_SCOPES,
  ACTION_REQUEST_TTL_MS,
  actionRequestStatus,
  actionVerbKey,
  clientLabel,
  CLIENT_LABEL_MAX,
  createActionRequest,
  decideActionRequest,
  describeAction,
  describeRequest,
  describeRequestVerb,
  describeVerb,
  familyActionRequest,
  pendingActionRequests,
  recordHomeAction,
  toAssistantRequest,
  toAssistantStatus,
  toScreenRequest,
  type ActionKindHandler,
  type ActionPatch,
  type ActionRequestRow,
  type ActionRequestStore,
  type ActionStatus,
  type ActionTranslator,
  type DecideDeps,
  type NewActionRow,
  type PushRequest,
} from "../src/lib/home/action-requests";
import { ALLOWED_SERVICES } from "../src/lib/home/policy";
import {
  actionChangeMatters, canApprove, canDeny, decisionErrorKey, isFinalError, isTerminal, newerRequest, outcomeNoticeKey,
  promptShownOn, secondsLeft, statusMessageKey, visibleRequests,
} from "../src/lib/home/action-prompt";
import { screensaverAllowed } from "../src/lib/screensaver-gate";
import { HomeUnavailable } from "../src/lib/home/errors";
import en from "../messages/en.json";
import de from "../messages/de.json";
import fr from "../messages/fr.json";
import { createTranslator } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Confirmation for sensitive assistant actions (RFC-011 §4.3).
 *
 * The decision flow is pure; the table, PIN, Home Assistant and push are
 * fakes that count what they were asked. The fake table implements
 * `transition` as the real one does — one conditional update — so the
 * double-approve test exercises the compare-and-swap rather than assuming it.
 */

const FAMILY = "11111111-1111-1111-1111-111111111111";
const OTHER_FAMILY = "22222222-2222-2222-2222-222222222222";
const TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
/** A token that may make (and so follow) a request of every kind. */
const BOTH_SCOPES = ["home:control", "pocket_money:write"];
const OTHER_TOKEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DEVICE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const T0 = new Date("2026-10-01T12:00:00.000Z");
const PIN = "4711";

/** The `assistantActions` translator in English, for what a screen is sent. */
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

function seed(
  rows: Map<string, ActionRequestRow>,
  overrides: Partial<ActionRequestRow> = {},
): ActionRequestRow {
  const row: ActionRequestRow = {
    id: newId(),
    family_id: FAMILY,
    token_id: TOKEN,
    client_name: "Claude",
    kind: "home",
    entity_id: "lock.front_door",
    entity_name: "Front door",
    domain: "lock",
    service: "unlock",
    data: {},
    status: "pending",
    created_at: T0.toISOString(),
    expires_at: new Date(T0.getTime() + ACTION_REQUEST_TTL_MS).toISOString(),
    decided_at: null,
    decided_by_device_id: null,
    result: null,
    ...overrides,
  };
  rows.set(row.id, row);
  return row;
}

function deps(store: ActionRequestStore, opts: {
  pin?: string | null;
  verdict?: "valid" | "invalid" | "rate_limited";
  ha?: (call: unknown[]) => Promise<{ ok: boolean; status: number }>;
  catalogue?: (familyId: string, entityId: string) => Promise<unknown | null>;
  now?: Date;
} = {}) {
  const calls: unknown[][] = [];
  const pinChecks: string[] = [];
  const catalogueChecks: string[] = [];
  const pin = opts.pin === undefined ? PIN : opts.pin;
  const d: DecideDeps = {
    store,
    hasPin: async () => pin !== null,
    verifyPin: async (_f, given) => {
      pinChecks.push(given);
      if (opts.verdict) return opts.verdict;
      return given === pin ? "valid" : "invalid";
    },
    callHaService: async (...args) => {
      calls.push(args);
      return opts.ha ? opts.ha(args) : { ok: true, status: 200 };
    },
    catalogueEntity: async (familyId, entityId) => {
      catalogueChecks.push(entityId);
      return opts.catalogue ? opts.catalogue(familyId, entityId) : { entityId };
    },
    now: () => opts.now ?? new Date(T0.getTime() + 30_000),
  };
  return { d, calls, pinChecks, catalogueChecks };
}

const decide = (d: DecideDeps, id: string, decision: unknown = "approve", pin: unknown = PIN, familyId = FAMILY) =>
  decideActionRequest({ id, familyId, deviceId: DEVICE, decision, pin }, d);

// ── deciding ────────────────────────────────────────────────────────────────

test.describe("decideActionRequest", () => {
  test("the right PIN runs the stored action once, exactly as stored, and records done", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows, { entity_id: "cover.garage", entity_name: "Garage", domain: "cover", service: "set_cover_position", data: { position: 30 } });
    const { d, calls } = deps(store);
    const res = await decide(d, row.id);
    expect(res.status).toBe(200);
    expect(calls).toEqual([[FAMILY, "cover", "set_cover_position", "cover.garage", { position: 30 }]]);
    const stored = rows.get(row.id)!;
    expect(stored.status).toBe("done");
    expect(stored.result).toEqual({ status: 200 });
    expect(stored.decided_by_device_id).toBe(DEVICE);
    expect(stored.decided_at).toBe(new Date(T0.getTime() + 30_000).toISOString());
    expect(res.request?.status).toBe("done");
  });

  test("nothing in the approving request can change what runs", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d, calls } = deps(store);
    const input = { id: row.id, familyId: FAMILY, deviceId: DEVICE, decision: "approve", pin: PIN, service: "open", entity_id: "lock.back_door", data: { code: "1" } };
    await decideActionRequest(input as never, d);
    expect(calls).toEqual([[FAMILY, "lock", "unlock", "lock.front_door", {}]]);
  });

  test("a wrong PIN never reaches Home Assistant and leaves the request pending", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d, calls } = deps(store);
    const res = await decide(d, row.id, "approve", "0000");
    expect(res).toMatchObject({ status: 403, error: "pin_invalid" });
    expect(calls).toEqual([]);
    expect(rows.get(row.id)!.status).toBe("pending");
  });

  test("a rate-limited PIN check is 429 and runs nothing", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d, calls } = deps(store, { verdict: "rate_limited" });
    expect(await decide(d, row.id)).toMatchObject({ status: 429, error: "rate_limited" });
    expect(calls).toEqual([]);
    expect(rows.get(row.id)!.status).toBe("pending");
  });

  test("approving with no PIN set is 403 pin_required, before the PIN is even checked", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d, calls, pinChecks } = deps(store, { pin: null });
    expect(await decide(d, row.id, "approve")).toMatchObject({ status: 403, error: "pin_required" });
    expect(pinChecks).toEqual([]);
    expect(calls).toEqual([]);
    expect(rows.get(row.id)!.status).toBe("pending");
  });

  test("denying needs no PIN: no PIN set, a garbage PIN or none at all — denied, PIN and Home Assistant untouched", async () => {
    for (const [pinSet, pin] of [[null, null], [null, "garbage"], [PIN, 12], [PIN, "0000"], [PIN, ""]] as const) {
      const { store, rows } = fakeStore();
      const row = seed(rows);
      const { d, calls, pinChecks } = deps(store, { pin: pinSet });
      const hasPinCalls: string[] = [];
      const hasPin = d.hasPin;
      d.hasPin = async (f) => { hasPinCalls.push(f); return hasPin(f); };
      const res = await decide(d, row.id, "deny", pin);
      expect(res, JSON.stringify(pin)).toMatchObject({ status: 200 });
      expect(rows.get(row.id)).toMatchObject({ status: "denied", decided_by_device_id: DEVICE });
      expect(pinChecks).toEqual([]);
      expect(hasPinCalls).toEqual([]);
      expect(calls).toEqual([]);
    }
  });

  test("denying after expiry is 409 expired", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d, pinChecks } = deps(store, { pin: null, now: new Date(T0.getTime() + ACTION_REQUEST_TTL_MS + 1) });
    expect(await decide(d, row.id, "deny", null)).toMatchObject({ status: 409, error: "expired" });
    expect(rows.get(row.id)!.status).toBe("expired");
    expect(pinChecks).toEqual([]);
  });

  test("the swap judges expiry by the clock when it runs, not when the request came in", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d, calls } = deps(store);
    let current = new Date(T0.getTime() + 1_000);
    d.now = () => current;
    const verify = d.verifyPin;
    // The PIN check is slow enough for the request to run out meanwhile.
    d.verifyPin = async (f, p) => { current = new Date(T0.getTime() + ACTION_REQUEST_TTL_MS + 5); return verify(f, p); };
    expect(await decide(d, row.id)).toMatchObject({ status: 409, error: "expired" });
    expect(calls).toEqual([]);
    expect(rows.get(row.id)!.status).toBe("expired");
  });

  test("a device removed from the catalogue after the request is never run", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d, calls, catalogueChecks } = deps(store, { catalogue: async () => null });
    expect(await decide(d, row.id)).toMatchObject({ status: 200 });
    expect(catalogueChecks).toEqual(["lock.front_door"]);
    expect(calls).toEqual([]);
    expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { status: 0, reason: "not_in_catalogue" } });
  });

  test("an unreadable catalogue at approval runs nothing", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d, calls } = deps(store, { catalogue: async () => { throw new Error("db down"); } });
    expect(await decide(d, row.id)).toMatchObject({ status: 200 });
    expect(calls).toEqual([]);
    expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { status: 0, reason: "catalogue_unavailable" } });
  });

  test("an expired request is ended as expired and never runs — not even with the right PIN", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d, calls, pinChecks } = deps(store, { now: new Date(T0.getTime() + ACTION_REQUEST_TTL_MS) });
    expect(await decide(d, row.id)).toMatchObject({ status: 409, error: "expired" });
    expect(calls).toEqual([]);
    expect(pinChecks).toEqual([]);
    expect(rows.get(row.id)!.status).toBe("expired");
  });

  test("a request that expires between the read and the decision still does not run (the UPDATE checks expiry)", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d, calls } = deps(store, { now: new Date(T0.getTime() + 1000) });
    // The read sees it live; by the time the UPDATE runs, the database's clock is past expiry.
    const late = new Date(T0.getTime() + ACTION_REQUEST_TTL_MS + 1).toISOString();
    const real = store.transition;
    store.transition = (id, f, from, patch, unexpiredAt) => real(id, f, from, patch, unexpiredAt ? late : undefined);
    const res = await decide(d, row.id);
    expect(res.status).toBe(409);
    expect(calls).toEqual([]);
    expect(rows.get(row.id)!.status).toBe("pending");
  });

  test("approving twice — even concurrently — runs Home Assistant once", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { d, calls } = deps(store, { ha: async () => { await gate; return { ok: true, status: 200 }; } });
    const first = decide(d, row.id);
    const second = decide(d, row.id);
    await new Promise((r) => setTimeout(r, 10));
    release();
    const results = await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)).toMatchObject({ error: "already_decided" });
    // And a third, after it is done.
    expect(await decide(d, row.id)).toMatchObject({ status: 409, error: "already_decided" });
    expect(calls).toHaveLength(1);
    expect(rows.get(row.id)!.status).toBe("done");
  });

  test("deny never runs anything and records who denied it", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d, calls } = deps(store);
    const res = await decide(d, row.id, "deny");
    expect(res).toMatchObject({ status: 200 });
    expect(calls).toEqual([]);
    expect(rows.get(row.id)).toMatchObject({ status: "denied", decided_by_device_id: DEVICE, result: null });
    // Approving after a deny does nothing.
    expect(await decide(d, row.id)).toMatchObject({ status: 409, error: "already_decided" });
    expect(calls).toEqual([]);
  });

  test("Home Assistant refusing or failing ends the request failed, with only its status", async () => {
    for (const [ha, expected] of [
      [async () => ({ ok: false, status: 500 }), { status: 500 }],
      [async () => ({ ok: false, status: 0 }), { status: 0 }],
      [async () => { throw new HomeUnavailable(); }, { status: 0 }],
      [async () => { throw new Error("boom"); }, { status: 0 }],
    ] as const) {
      const { store, rows } = fakeStore();
      const row = seed(rows);
      const { d, calls } = deps(store, { ha });
      const res = await decide(d, row.id);
      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(rows.get(row.id)).toMatchObject({ status: "failed", result: expected });
    }
  });

  test("a revoked assistant's request is denied on decide and never runs", async () => {
    const { store, rows, revoked } = fakeStore();
    const row = seed(rows);
    revoked.add(TOKEN);
    const { d, calls, pinChecks } = deps(store);
    expect(await decide(d, row.id)).toMatchObject({ status: 409, error: "revoked" });
    expect(calls).toEqual([]);
    expect(pinChecks).toEqual([]);
    expect(rows.get(row.id)).toMatchObject({ status: "denied", decided_by_device_id: null });
  });

  test("a request whose token was deleted (token_id null) counts as revoked", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows, { token_id: null });
    const { d, calls } = deps(store);
    expect(await decide(d, row.id)).toMatchObject({ status: 409, error: "revoked" });
    expect(calls).toEqual([]);
  });

  test("revoked while the PIN was being checked: approved, then denied, never run", async () => {
    const { store, rows, revoked } = fakeStore();
    const row = seed(rows);
    const { d, calls } = deps(store);
    const verify = d.verifyPin;
    d.verifyPin = async (f, p) => { revoked.add(TOKEN); return verify(f, p); };
    expect(await decide(d, row.id)).toMatchObject({ status: 409, error: "revoked" });
    expect(calls).toEqual([]);
    expect(rows.get(row.id)!.status).toBe("denied");
  });

  test("another family's request is 404 and untouched", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows, { family_id: OTHER_FAMILY });
    const { d, calls, pinChecks } = deps(store);
    expect(await decide(d, row.id)).toMatchObject({ status: 404, error: "not_found" });
    expect(calls).toEqual([]);
    expect(pinChecks).toEqual([]);
    expect(rows.get(row.id)!.status).toBe("pending");
  });

  test("a malformed id, decision or PIN is refused before anything is read", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d, calls, pinChecks } = deps(store);
    expect(await decide(d, "not-a-uuid")).toMatchObject({ status: 404 });
    expect(await decide(d, row.id, "maybe")).toMatchObject({ status: 400, error: "invalid_request" });
    expect(await decide(d, row.id, "approve", 4711)).toMatchObject({ status: 400 });
    expect(await decide(d, row.id, "approve", "")).toMatchObject({ status: 400 });
    expect(await decide(d, row.id, "approve", "1".repeat(33))).toMatchObject({ status: 400 });
    expect(await decide(d, row.id, "approve", null)).toMatchObject({ status: 400 });
    expect(pinChecks).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("a stored action the policy no longer allows is marked failed, not run", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows, { entity_id: "lock.front_door", domain: "homeassistant", service: "restart" });
    const tampered = seed(rows, { service: "unlock", data: { code: "1234" } });
    const { d, calls } = deps(store);
    expect(await decide(d, row.id)).toMatchObject({ status: 200 });
    expect(await decide(d, tampered.id)).toMatchObject({ status: 200 });
    expect(calls).toEqual([]);
    expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { status: 0, reason: "not_allowed" } });
    expect(rows.get(tampered.id)).toMatchObject({ status: "failed", result: { status: 0, reason: "not_allowed" } });
  });

  test("Home Assistant's answer is recorded as its status only, with no reason", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d } = deps(store, { ha: async () => ({ ok: false, status: 502 }) });
    await decide(d, row.id);
    expect(rows.get(row.id)!.result).toEqual({ status: 502 });
  });
});

test.describe("an approval nobody finished", () => {
  const decidedAgo = (ms: number) => new Date(T0.getTime() + 30_000 - ms).toISOString();
  const at = { now: () => new Date(T0.getTime() + 30_000) };

  test("approved for over a minute reads as failed with an unknown outcome, and is written so", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows, { status: "approved", decided_at: decidedAgo(61_000) });
    const read = await familyActionRequest(row.id, FAMILY, { store, ...at });
    expect(read).toMatchObject({ status: "failed", result: { status: 0, reason: "unknown_outcome" } });
    expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { status: 0, reason: "unknown_outcome" } });
    // get_action_status says the same.
    expect(await actionRequestStatus({ id: row.id, familyId: FAMILY, tokenId: TOKEN, scopes: BOTH_SCOPES }, { store, ...at }))
      .toMatchObject({ status: "failed", result: { reason: "unknown_outcome" } });
  });

  test("a fresh approval is left alone — it is still running", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows, { status: "approved", decided_at: decidedAgo(10_000) });
    expect((await familyActionRequest(row.id, FAMILY, { store, ...at }))?.status).toBe("approved");
    expect(rows.get(row.id)!.status).toBe("approved");
  });

  test("if writing that down fails, it is still reported as failed", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows, { status: "approved", decided_at: decidedAgo(120_000) });
    store.transition = async () => { throw new Error("db down"); };
    expect(await familyActionRequest(row.id, FAMILY, { store, ...at }))
      .toMatchObject({ status: "failed", result: { status: 0, reason: "unknown_outcome" } });
  });

  test("the real answer arriving after a reader guessed 'unknown outcome' replaces the guess, and is what is returned", async () => {
    for (const [ok, httpStatus, want] of [[true, 200, "done"], [false, 500, "failed"]] as const) {
      const { store, rows } = fakeStore();
      const row = seed(rows);
      const { d } = deps(store, {
        ha: async () => {
          // A screen polled while Home Assistant was slow and settled it as stale.
          Object.assign(rows.get(row.id)!, { status: "failed", result: { status: 0, reason: "unknown_outcome" } });
          return { ok, status: httpStatus };
        },
      });
      const res = await decide(d, row.id);
      expect(res.status).toBe(200);
      expect(rows.get(row.id)).toMatchObject({ status: want, result: { status: httpStatus } });
      expect(res.request).toMatchObject({ status: want, result: { status: httpStatus } });
    }
  });

  test("a row that ended any other way meanwhile is left alone, and the stored row is returned", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d } = deps(store, {
      ha: async () => {
        Object.assign(rows.get(row.id)!, { status: "failed", result: { status: 0, reason: "not_allowed" } });
        return { ok: true, status: 200 };
      },
    });
    const res = await decide(d, row.id);
    expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { reason: "not_allowed" } });
    expect(res.request).toMatchObject({ status: "failed", result: { reason: "not_allowed" } });
  });

  test("deciding it again is already_decided, and runs nothing", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows, { status: "approved", decided_at: decidedAgo(61_000) });
    const { d, calls } = deps(store);
    expect(await decide(d, row.id)).toMatchObject({ status: 409, error: "already_decided", request: { status: "failed" } });
    expect(calls).toEqual([]);
  });
});

// ── creating and recording ──────────────────────────────────────────────────

test.describe("createActionRequest", () => {
  test("stores a pending request expiring in two minutes and pushes the family once", async () => {
    const { store, rows } = fakeStore();
    const pushes: PushRequest[] = [];
    const res = await createActionRequest({
      familyId: FAMILY, tokenId: TOKEN, clientName: "Claude", entityId: "lock.front_door",
      entityName: "Front door", room: "Hall", domain: "lock", service: "unlock", data: {},
    }, { store, push: async (p) => { pushes.push(p); }, now: () => T0 });
    expect(res.expiresAt).toBe("2026-10-01T12:02:00.000Z");
    expect(rows.get(res.id)).toMatchObject({
      family_id: FAMILY, token_id: TOKEN, client_name: "Claude", kind: "home", entity_id: "lock.front_door",
      entity_name: "Front door", domain: "lock", service: "unlock", data: {}, status: "pending",
      decided_at: null, decided_by_device_id: null, result: null,
    });
    expect(pushes).toEqual([{
      familyId: FAMILY, requestId: res.id,
      request: { kind: "home", client_name: "Claude", entity_name: "Front door", room: "Hall", domain: "lock", service: "unlock", data: {} },
    }]);
  });

  test("a failing push does not fail the request", async () => {
    const { store, rows } = fakeStore();
    const res = await createActionRequest({
      familyId: FAMILY, tokenId: TOKEN, clientName: "Claude", entityId: "lock.front_door",
      entityName: "Front door", domain: "lock", service: "unlock", data: {},
    }, { store, push: async () => { throw new Error("push down"); }, now: () => T0 });
    expect(rows.get(res.id)!.status).toBe("pending");
  });

  test("bounds the names it stores", async () => {
    const { store, rows } = fakeStore();
    const res = await createActionRequest({
      familyId: FAMILY, tokenId: TOKEN, clientName: "C".repeat(500), entityId: "lock.front_door",
      entityName: "D".repeat(500), domain: "lock", service: "unlock", data: {},
    }, { store, push: async () => undefined, now: () => T0 });
    expect(rows.get(res.id)!.client_name).toHaveLength(200);
    expect(rows.get(res.id)!.entity_name).toHaveLength(200);
  });
});

test.describe("recordHomeAction (every action is attributable)", () => {
  test("writes a done or failed row with the token, the action and only the status", async () => {
    for (const [ok, status, expected] of [[true, 200, "done"], [false, 502, "failed"]] as const) {
      const { store, log } = fakeStore();
      await recordHomeAction({
        familyId: FAMILY, tokenId: TOKEN, clientName: "Claude", entityId: "light.kitchen",
        entityName: "Kitchen light", domain: "light", service: "turn_on", data: { brightness_pct: 40 }, ok, status,
      }, { store, now: () => T0 });
      expect(log.inserts).toEqual([{
        family_id: FAMILY, token_id: TOKEN, client_name: "Claude", kind: "home", entity_id: "light.kitchen",
        entity_name: "Kitchen light", domain: "light", service: "turn_on", data: { brightness_pct: 40 },
        status: expected, expires_at: T0.toISOString(), decided_at: T0.toISOString(),
        decided_by_device_id: null, result: { status },
      }]);
    }
  });
});

// ── reading ─────────────────────────────────────────────────────────────────

test.describe("reading requests", () => {
  test("pending lists only live requests, ending expired and revoked ones on the way", async () => {
    const { store, rows, revoked } = fakeStore();
    const live = seed(rows);
    const old = seed(rows, { expires_at: T0.toISOString() });
    const orphan = seed(rows, { token_id: OTHER_TOKEN });
    seed(rows, { family_id: OTHER_FAMILY });
    seed(rows, { status: "done" });
    revoked.add(OTHER_TOKEN);
    const pending = await pendingActionRequests(FAMILY, { store, now: () => new Date(T0.getTime() + 1000) });
    expect(pending.map((r) => r.id)).toEqual([live.id]);
    expect(rows.get(old.id)!.status).toBe("expired");
    expect(rows.get(orphan.id)).toMatchObject({ status: "denied", decided_by_device_id: null });
  });

  test("get_action_status sees only the caller's own requests; expiry is applied lazily", async () => {
    const { store, rows } = fakeStore();
    const mine = seed(rows);
    const theirs = seed(rows, { token_id: OTHER_TOKEN });
    const otherFamily = seed(rows, { family_id: OTHER_FAMILY });
    const later = { store, now: () => new Date(T0.getTime() + ACTION_REQUEST_TTL_MS + 1) };
    expect(await actionRequestStatus({ id: theirs.id, familyId: FAMILY, tokenId: TOKEN, scopes: BOTH_SCOPES }, later)).toBeNull();
    expect(await actionRequestStatus({ id: otherFamily.id, familyId: FAMILY, tokenId: TOKEN, scopes: BOTH_SCOPES }, later)).toBeNull();
    expect(await actionRequestStatus({ id: "nope", familyId: FAMILY, tokenId: TOKEN, scopes: BOTH_SCOPES }, later)).toBeNull();
    const status = await actionRequestStatus({ id: mine.id, familyId: FAMILY, tokenId: TOKEN, scopes: BOTH_SCOPES }, later);
    expect(status?.status).toBe("expired");
    expect(rows.get(mine.id)!.status).toBe("expired");
  });

  test("a screen can read any of its family's requests, but not another family's", async () => {
    const { store, rows } = fakeStore();
    const mine = seed(rows, { status: "done", result: { status: 200 } });
    const other = seed(rows, { family_id: OTHER_FAMILY });
    expect((await familyActionRequest(mine.id, FAMILY, { store }))?.status).toBe("done");
    expect(await familyActionRequest(other.id, FAMILY, { store })).toBeNull();
  });

  test("what leaves the server: no token id or deciding device for screens; only status fields for the assistant", () => {
    const { rows } = fakeStore();
    const row = seed(rows, { decided_by_device_id: DEVICE, status: "done", result: { status: 200 } });
    const screen = toScreenRequest(row, EN, "Hall");
    expect(screen).not.toHaveProperty("token_id");
    expect(screen).not.toHaveProperty("decided_by_device_id");
    expect(screen.room).toBe("Hall");
    expect(Object.keys(toAssistantRequest(row)).sort()).toEqual(
      ["created_at", "decided_at", "entity_id", "expires_at", "id", "result", "service", "status"],
    );
  });
});

// ── wording ─────────────────────────────────────────────────────────────────

test.describe("describing an action", () => {
  const translators = Object.fromEntries(
    ([["en", en], ["de", de], ["fr", fr]] as const).map(([locale, messages]) => [
      locale,
      createTranslator({ locale, messages, namespace: "assistantActions" }) as unknown as
        (key: string, values?: Record<string, string | number>) => string,
    ]),
  );

  test("says who wants to do what to which device, in words", () => {
    const action = { client_name: "Claude", entity_name: "Front door", room: "Hallway", domain: "lock", service: "unlock", data: {} };
    expect(describeAction(translators.en, action)).toBe("Claude wants to unlock Front door (Hallway)");
    expect(describeAction(translators.de, action)).toBe("Claude möchte Front door (Hallway) aufschließen");
    expect(describeAction(translators.fr, action)).toBe("Claude veut déverrouiller Front door (Hallway)");
    expect(describeAction(translators.en, { ...action, room: null })).toBe("Claude wants to unlock Front door");
    expect(describeAction(translators.en, { ...action, room: null, domain: "cover", service: "set_cover_position", data: { position: 30 }, entity_name: "Garage" }))
      .toBe("Claude wants to move Garage to 30%");
  });

  test("an assistant's name is cut to 40 characters with an ellipsis, and flattened to one line", () => {
    expect(CLIENT_LABEL_MAX).toBe(40);
    expect(clientLabel("Claude")).toBe("Claude");
    expect(clientLabel("x".repeat(40))).toBe("x".repeat(40));
    const long = clientLabel("Grandma says: please allow this, it is fine, she asked for it");
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("…")).toBe(true);
    expect(clientLabel("  Claude\n\nCode  ")).toBe("Claude Code");
    const action = { client_name: "y".repeat(80), entity_name: "Door", room: null, domain: "lock", service: "unlock", data: {} };
    expect(describeAction(translators.en, action)).toBe(`${"y".repeat(39)}… wants to unlock Door`);
  });

  test("the overlay's sentence leaves the name out; it is shown as a separate label", () => {
    const action = { entity_name: "Front door", room: "Hallway", domain: "lock", service: "unlock", data: {} };
    expect(translators.en("wantsTo", { action: describeVerb(translators.en, action) })).toBe("wants to unlock Front door (Hallway)");
    expect(translators.de("wantsTo", { action: describeVerb(translators.de, action) })).toBe("möchte Front door (Hallway) aufschließen");
    expect(translators.fr("wantsTo", { action: describeVerb(translators.fr, action) })).toBe("veut déverrouiller Front door (Hallway)");
  });

  test("every sensitive service in the policy has its own words in every language", () => {
    const sensitive: string[] = [];
    for (const [domain, services] of Object.entries(ALLOWED_SERVICES)) {
      for (const [service, spec] of Object.entries(services)) {
        if ((spec as { sensitive: string }).sensitive !== "never") sensitive.push(`${domain}.${service}`);
      }
    }
    expect(sensitive.length).toBeGreaterThan(15);
    for (const id of sensitive) {
      const [domain, service] = [id.slice(0, id.indexOf(".")), id.slice(id.indexOf(".") + 1)];
      expect(actionVerbKey(domain, service), id).not.toBe("generic");
      for (const [locale, t] of Object.entries(translators)) {
        const text = describeAction(t, { client_name: "C", entity_name: "D", domain, service, data: { position: 5 } });
        expect(text, `${locale} ${id}`).not.toContain("assistantActions.");
        expect(text, `${locale} ${id}`).not.toMatch(/[{}]/);
        expect(text, `${locale} ${id}`).toContain("D");
      }
    }
  });

  test("an unknown service falls back to naming it", () => {
    expect(actionVerbKey("light", "turn_on")).toBe("generic");
    expect(describeAction(translators.en, { client_name: "Claude", entity_name: "Lamp", domain: "light", service: "turn_on", data: {} }))
      .toBe("Claude wants to run “turn_on” on Lamp");
  });
});

// ── the screen prompt ───────────────────────────────────────────────────────

test.describe("the prompt on a screen", () => {
  const screen = (overrides: Partial<ActionRequestRow> = {}) => {
    const { rows } = fakeStore();
    return toScreenRequest(seed(rows, overrides), EN);
  };

  test("counts down in whole seconds, never below zero; an unreadable expiry is zero", () => {
    const expires = new Date(T0.getTime() + ACTION_REQUEST_TTL_MS).toISOString();
    expect(secondsLeft(expires, T0)).toBe(120);
    expect(secondsLeft(expires, new Date(T0.getTime() + 119_001))).toBe(1);
    expect(secondsLeft(expires, new Date(T0.getTime() + 120_000))).toBe(0);
    expect(secondsLeft(expires, new Date(T0.getTime() + 999_000))).toBe(0);
    expect(secondsLeft("not a date", T0)).toBe(0);
  });

  test("shows only pending requests with time left", () => {
    const live = screen();
    const decided = screen({ status: "done" });
    const ranOut = screen({ expires_at: new Date(T0.getTime() + 5_000).toISOString() });
    expect(visibleRequests([live, decided, ranOut], new Date(T0.getTime() + 10_000)).map((r) => r.id)).toEqual([live.id]);
  });

  test("maps every error the route can answer to its own message, anything else to a generic one", () => {
    for (const code of ["pin_invalid", "rate_limited", "expired", "already_decided", "revoked", "pin_required", "not_found"]) {
      const key = decisionErrorKey(code);
      expect(key).toBe(`errors.${code}`);
      for (const messages of [en, de, fr]) {
        expect((messages.assistantActions.errors as Record<string, string>)[code], code).toBeTruthy();
      }
    }
    expect(decisionErrorKey("internal_error")).toBe("errors.generic");
    expect(decisionErrorKey(undefined)).toBe("errors.generic");
  });

  test("Allow and Deny need a four-digit PIN, time left, and no decision in flight", () => {
    expect(canApprove("4711", false, 30)).toBe(true);
    expect(canApprove("471", false, 30)).toBe(false);
    expect(canApprove("47a1", false, 30)).toBe(false);
    expect(canApprove("4711", true, 30)).toBe(false);
    expect(canApprove("4711", false, 0)).toBe(false);
  });

  test("Deny needs only time left and no decision in flight — no PIN", () => {
    expect(canDeny(false, 30)).toBe(true);
    expect(canDeny(true, 30)).toBe(false);
    expect(canDeny(false, 0)).toBe(false);
  });

  test("an approval that failed without a known answer says the outcome is unknown, not 'try again'", () => {
    for (const code of ["internal_error", "network", undefined]) {
      expect(decisionErrorKey(code, "approve")).toBe("errors.unknown_outcome");
      expect(decisionErrorKey(code, "deny")).toBe("errors.generic");
    }
    expect(decisionErrorKey("pin_invalid", "approve")).toBe("errors.pin_invalid");
    for (const messages of [en, de, fr]) expect(messages.assistantActions.errors.unknown_outcome).toBeTruthy();
  });

  test("errors that end the request stay up until closed; ones you can retry stay on the card", () => {
    for (const code of ["expired", "already_decided", "revoked", "not_found"]) expect(isFinalError(code, "approve")).toBe(true);
    for (const code of ["pin_invalid", "rate_limited", "pin_required"]) expect(isFinalError(code, "approve")).toBe(false);
    expect(isFinalError("network", "approve")).toBe(true);
    expect(isFinalError("network", "deny")).toBe(false);
  });

  test("the deep-link page shows the further-along copy, the polled one on a tie", () => {
    const pending = screen();
    const done = { ...pending, status: "done" as const };
    const failed = { ...pending, status: "failed" as const };
    expect(newerRequest(pending, done)).toBe(done);
    expect(newerRequest(failed, done)).toBe(failed);
    expect(newerRequest(done, { ...pending, status: "approved" as const })).toBe(done);
    expect(newerRequest(undefined, done)).toBe(done);
    expect(newerRequest(pending, null)).toBe(pending);
    expect(isTerminal(done)).toBe(true);
    expect(isTerminal({ status: "approved" })).toBe(false);
  });

  test("a failed request says why, in every language", () => {
    for (const reason of ["unknown_outcome", "not_in_catalogue", "catalogue_unavailable", "not_allowed"]) {
      const key = statusMessageKey({ status: "failed", result: { status: 0, reason } } as never);
      expect(key).toBe(`status.${reason}`);
      for (const messages of [en, de, fr]) {
        expect((messages.assistantActions.status as Record<string, string>)[reason], reason).toBeTruthy();
      }
    }
    expect(statusMessageKey({ status: "failed", result: { status: 500 } })).toBe("status.failed");
    expect(statusMessageKey({ status: "done", result: { status: 200 } })).toBe("status.done");
  });

  test("audit rows (non-pending INSERTs) do not make every screen refetch", () => {
    expect(actionChangeMatters({ eventType: "INSERT", new: { status: "done" } })).toBe(false);
    expect(actionChangeMatters({ eventType: "INSERT", new: { status: "failed" } })).toBe(false);
    expect(actionChangeMatters({ eventType: "INSERT", new: { status: "pending" } })).toBe(true);
    expect(actionChangeMatters({ eventType: "UPDATE", new: { status: "done" } })).toBe(true);
    expect(actionChangeMatters({ eventType: "DELETE", new: {} })).toBe(true);
  });

  test("the prompt shows on every page of a joined device, but not on /join or its own page", () => {
    for (const path of ["/", "/calendar", "/settings/integrations", "/einkaufen", "/setup"]) expect(promptShownOn(path, true), path).toBe(true);
    expect(promptShownOn("/", false)).toBe(false);
    expect(promptShownOn("/join", true)).toBe(false);
    expect(promptShownOn("/assistant-actions/33333333-3333-4333-8333-333333333333", true)).toBe(false);
  });

  test("the screensaver stays off while an assistant request waits", () => {
    const idle = { isIdle: true, skipPath: false, handheld: false, ringingTimer: false, takeoverMessage: false, pendingAssistantActions: 0 };
    expect(screensaverAllowed(idle)).toBe(true);
    expect(screensaverAllowed({ ...idle, pendingAssistantActions: 1 })).toBe(false);
    expect(screensaverAllowed({ ...idle, takeoverMessage: true })).toBe(false);
    expect(screensaverAllowed({ ...idle, ringingTimer: true })).toBe(false);
    expect(screensaverAllowed({ ...idle, isIdle: false })).toBe(false);
  });

  test("an outcome notice on screen keeps the screensaver off until it is closed", () => {
    const idle = { isIdle: true, skipPath: false, handheld: false, ringingTimer: false, takeoverMessage: false, pendingAssistantActions: 0 };
    expect(screensaverAllowed({ ...idle, assistantActionNotices: 0 })).toBe(true);
    expect(screensaverAllowed({ ...idle, assistantActionNotices: 1 })).toBe(false);
  });

  test("after Allow, the overlay says what happened: done, didn't work, or unknown — check the device", () => {
    expect(outcomeNoticeKey({ status: "done", result: { status: 200 } })).toBe("status.done");
    expect(outcomeNoticeKey({ status: "failed", result: { status: 500 } })).toBe("status.failed");
    expect(outcomeNoticeKey({ status: "failed", result: { status: 0, reason: "unknown_outcome" } })).toBe("status.unknown_outcome");
    expect(outcomeNoticeKey({ status: "failed", result: { status: 0, reason: "not_in_catalogue" } })).toBe("status.not_in_catalogue");
    // Claimed, not yet answered: from this screen the outcome is unknown.
    expect(outcomeNoticeKey({ status: "approved", result: null })).toBe("status.unknown_outcome");
    expect(outcomeNoticeKey({ status: "pending", result: null })).toBeNull();
    for (const key of ["status.done", "status.failed", "status.unknown_outcome"]) {
      for (const messages of [en, de, fr]) {
        expect((messages.assistantActions.status as Record<string, string>)[key.slice(7)], key).toBeTruthy();
      }
    }
  });

  test("every status the deep-link page can show has words in every language", () => {
    for (const status of ["pending", "approved", "done", "failed", "denied", "expired"]) {
      for (const messages of [en, de, fr]) {
        expect((messages.assistantActions.status as Record<string, string>)[status], status).toBeTruthy();
      }
    }
  });
});

// ── kinds (RFC-012 §3) ──────────────────────────────────────────────────────

test.describe("a request carries a kind, and running it dispatches on it", () => {
  /** A handler that counts what it is asked, and answers as told. */
  function countingHandler(name: string, log: string[], opts: { blocked?: "not_available" | "not_allowed"; ok?: boolean } = {}): ActionKindHandler {
    return {
      validate: async (row) => { log.push(`${name}.validate:${row.id}`); return opts.blocked ?? null; },
      execute: async (row) => { log.push(`${name}.execute:${row.id}`); return { ok: opts.ok ?? true, result: { status: 0 } }; },
      describe: () => `${name} thing`,
    };
  }
  const pocketRow = { kind: "pocket_money" as const, entity_id: null, entity_name: null, domain: null, service: null, data: { amount_cents: 500 } };

  test("an approved home request runs the home handler, and only it", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const log: string[] = [];
    const { d } = deps(store);
    d.kinds = { home: countingHandler("home", log), pocket_money: countingHandler("pocket", log) };
    const res = await decide(d, row.id);
    expect(res.status).toBe(200);
    expect(log).toEqual([`home.validate:${row.id}`, `home.execute:${row.id}`]);
    expect(rows.get(row.id)!.status).toBe("done");
  });

  test("an approved pocket-money request runs the pocket-money handler, never Home Assistant", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows, pocketRow);
    const log: string[] = [];
    const { d, calls, catalogueChecks } = deps(store);
    d.kinds = { home: countingHandler("home", log), pocket_money: countingHandler("pocket", log) };
    const res = await decide(d, row.id);
    expect(res.status).toBe(200);
    expect(log).toEqual([`pocket.validate:${row.id}`, `pocket.execute:${row.id}`]);
    expect(calls).toEqual([]);
    expect(catalogueChecks).toEqual([]);
    expect(rows.get(row.id)!.status).toBe("done");
  });

  test("a handler's validate stops it: failed with its reason, execute never called", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows, pocketRow);
    const log: string[] = [];
    const { d } = deps(store);
    d.kinds = { pocket_money: countingHandler("pocket", log, { blocked: "not_allowed" }) };
    await decide(d, row.id);
    expect(log).toEqual([`pocket.validate:${row.id}`]);
    expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { status: 0, reason: "not_allowed" } });
  });

  test("a pocket-money row whose data is not a booking is approved like any other, and books nothing", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows, pocketRow);
    const { d, calls, catalogueChecks, pinChecks } = deps(store);
    const res = await decide(d, row.id);
    // Same approval as a home request: the PIN was checked, the swap won.
    expect(pinChecks).toEqual([PIN]);
    expect(res.status).toBe(200);
    expect(rows.get(row.id)).toMatchObject({
      status: "failed", decided_by_device_id: DEVICE, result: { status: 0, reason: "not_allowed" },
    });
    expect(calls).toEqual([]);
    expect(catalogueChecks).toEqual([]);
    expect(statusMessageKey(rows.get(row.id)!)).toBe("status.not_allowed");
  });

  test("a pocket-money request is denied, expires and is revoked exactly like a home one", async () => {
    const { store, rows, revoked } = fakeStore();
    const denied = seed(rows, pocketRow);
    const { d, pinChecks } = deps(store);
    expect((await decide(d, denied.id, "deny", undefined)).status).toBe(200);
    expect(rows.get(denied.id)!.status).toBe("denied");
    expect(pinChecks).toEqual([]);

    const old = seed(rows, { ...pocketRow, expires_at: T0.toISOString() });
    expect(await decide(d, old.id)).toMatchObject({ status: 409, error: "expired" });

    const orphan = seed(rows, { ...pocketRow, token_id: OTHER_TOKEN });
    revoked.add(OTHER_TOKEN);
    expect(await decide(d, orphan.id)).toMatchObject({ status: 409, error: "revoked" });
  });

  test("a kind this server does not know never runs", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows, { kind: "garage_sale" as never });
    const { d, calls } = deps(store);
    await decide(d, row.id);
    expect(calls).toEqual([]);
    expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { status: 0, reason: "not_available" } });
  });

  test("a handler that throws while checking ends the request unrun", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows);
    const { d, calls } = deps(store);
    d.kinds = { home: { ...ACTION_KIND_HANDLERS.home, validate: async () => { throw new Error("bug"); } } };
    await decide(d, row.id);
    expect(calls).toEqual([]);
    expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { status: 0, reason: "not_available" } });
  });

  test("the built-in map: home is the RFC-011 handler, pocket money refuses what is not a booking", async () => {
    expect(Object.keys(ACTION_KIND_HANDLERS).sort()).toEqual(["home", "pocket_money", "reward_decision"]);
    const { rows } = fakeStore();
    expect(await ACTION_KIND_HANDLERS.pocket_money.validate(seed(rows, pocketRow), FAMILY, {} as DecideDeps)).toBe("not_allowed");
  });

  test("a home row without its device fields is never run, even if one slipped past the CHECK", async () => {
    const { store, rows } = fakeStore();
    const row = seed(rows, { entity_id: null });
    const { d, calls } = deps(store);
    await decide(d, row.id);
    expect(calls).toEqual([]);
    expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { reason: "not_allowed" } });
  });
});

test.describe("creating a request of another kind", () => {
  test("stores the kind and no device fields, and the push describes it by kind", async () => {
    const { store, rows } = fakeStore();
    const pushes: PushRequest[] = [];
    const res = await createActionRequest({
      kind: "pocket_money", familyId: FAMILY, tokenId: TOKEN, clientName: "ChatGPT", data: { amount_cents: 500 },
    }, { store, push: async (p) => { pushes.push(p); }, now: () => T0 });
    expect(rows.get(res.id)).toMatchObject({
      kind: "pocket_money", entity_id: null, entity_name: null, domain: null, service: null,
      data: { amount_cents: 500 }, status: "pending", expires_at: "2026-10-01T12:02:00.000Z",
    });
    expect(pushes).toHaveLength(1);
    expect(describeRequest(EN, pushes[0].request)).toBe("ChatGPT wants to book pocket money");
  });
});

test.describe("every kind is described by its handler, for the screen, the push and the assistant", () => {
  const translators = Object.fromEntries(
    ([["en", en], ["de", de], ["fr", fr]] as const).map(([locale, messages]) => [
      locale, createTranslator({ locale, messages, namespace: "assistantActions" }) as unknown as ActionTranslator,
    ]),
  );

  test("home: exactly the words it had before kinds existed", () => {
    const { rows } = fakeStore();
    const row = seed(rows);
    for (const t of Object.values(translators)) {
      const before = describeVerb(t, { entity_name: "Front door", room: "Hall", domain: "lock", service: "unlock", data: {} });
      expect(toScreenRequest(row, t, "Hall").description).toBe(before);
      expect(describeRequestVerb(t, { ...row, room: "Hall" })).toBe(before);
      expect(describeRequest(t, { ...row, room: "Hall" })).toBe(describeAction(t, { ...row, entity_name: "Front door", domain: "lock", service: "unlock", room: "Hall" }));
    }
    expect(toScreenRequest(row, EN, "Hall")).toMatchObject({ kind: "home", description: "unlock Front door (Hall)" });
  });

  test("pocket money has words in every language", () => {
    const { rows } = fakeStore();
    const row = seed(rows, { kind: "pocket_money", entity_id: null, entity_name: null, domain: null, service: null });
    for (const [locale, t] of Object.entries(translators)) {
      const text = toScreenRequest(row, t).description;
      expect(text, locale).toBeTruthy();
      expect(text, locale).not.toContain("assistantActions.");
      expect(text, locale).not.toMatch(/[{}]/);
    }
    expect(toScreenRequest(row, EN)).toMatchObject({ kind: "pocket_money", room: null, description: "book pocket money" });
  });

  test("an unknown kind is said to be unknown, not left blank", () => {
    for (const t of Object.values(translators)) {
      const text = describeRequestVerb(t, { kind: "garage_sale" as never, client_name: "C", entity_name: null, domain: null, service: null, data: {} });
      expect(text).toBeTruthy();
      expect(text).not.toContain("assistantActions.");
    }
  });

  test("the assistant's generic status adds kind and description; the home status stays as it was", () => {
    const { rows } = fakeStore();
    const row = seed(rows, { status: "done", result: { status: 200 } });
    expect(toAssistantStatus(row, EN)).toEqual({ ...toAssistantRequest(row), kind: "home", description: "unlock Front door" });
  });

  test("not_available has words in every language", () => {
    for (const messages of [en, de, fr]) {
      expect((messages.assistantActions.status as Record<string, string>).not_available).toBeTruthy();
    }
  });
});

test.describe("following a request: GET /actions/{id} and /home/actions/{id}", () => {
  test("the generic status sees only the calling token's own requests, of any kind", async () => {
    const { store, rows } = fakeStore();
    const home = seed(rows);
    const pocket = seed(rows, { kind: "pocket_money", entity_id: null, entity_name: null, domain: null, service: null });
    const theirs = seed(rows, { kind: "pocket_money", token_id: OTHER_TOKEN, entity_id: null, entity_name: null, domain: null, service: null });
    const otherFamily = seed(rows, { family_id: OTHER_FAMILY, kind: "pocket_money", entity_id: null, entity_name: null, domain: null, service: null });
    const legacy = seed(rows, { token_id: null });
    const as = (id: string) => actionRequestStatus({ id, familyId: FAMILY, tokenId: TOKEN, scopes: BOTH_SCOPES }, { store, now: () => T0 });
    expect((await as(home.id))?.id).toBe(home.id);
    expect((await as(pocket.id))?.id).toBe(pocket.id);
    expect(await as(theirs.id)).toBeNull();
    expect(await as(otherFamily.id)).toBeNull();
    expect(await as(legacy.id)).toBeNull();
  });

  test("/home/actions/{id} keeps to home requests", async () => {
    const { store, rows } = fakeStore();
    const home = seed(rows);
    const pocket = seed(rows, { kind: "pocket_money", entity_id: null, entity_name: null, domain: null, service: null });
    const asHome = (id: string) => actionRequestStatus({ id, familyId: FAMILY, tokenId: TOKEN, kind: "home", scopes: ["home:control"] }, { store, now: () => T0 });
    expect((await asHome(home.id))?.id).toBe(home.id);
    expect(await asHome(pocket.id)).toBeNull();
  });

  test("a request is read only with its own kind's scope: a home:control-only token cannot see a booking or a reward decision", async () => {
    // A pocket-money booking holds a child's name, an amount and a note;
    // home:control is no permission to read those (family:read is).
    const { store, rows } = fakeStore();
    const none = { entity_id: null, entity_name: null, domain: null, service: null };
    const home = seed(rows);
    const pocket = seed(rows, { kind: "pocket_money", ...none, status: "done", result: { status: 200, booked: true } });
    const reward = seed(rows, { kind: "reward_decision", ...none });
    const as = (id: string, scopes: string[]) =>
      actionRequestStatus({ id, familyId: FAMILY, tokenId: TOKEN, scopes }, { store, now: () => T0 });
    expect((await as(home.id, ["home:control"]))?.id).toBe(home.id);
    expect(await as(pocket.id, ["home:control"])).toBeNull();
    expect(await as(reward.id, ["home:control"])).toBeNull();
    expect(await as(home.id, ["pocket_money:write"])).toBeNull();
    expect((await as(pocket.id, ["pocket_money:write"]))?.id).toBe(pocket.id);
    expect((await as(reward.id, ["pocket_money:write"]))?.id).toBe(reward.id);
    for (const row of [home, pocket, reward]) expect(await as(row.id, ["family:read", "tasks:write"])).toBeNull();
    // The same answer as for an id that does not exist: nothing says it is there.
    expect(await as(pocket.id, ["home:control"])).toEqual(await as("00000000-0000-4000-8000-000000000000", ["home:control"]));
  });

  test("both status routes hand the token's scopes to the lookup", () => {
    for (const route of ["src/app/api/integration/v1/actions/[id]/route.ts", "src/app/api/integration/v1/home/actions/[id]/route.ts"]) {
      const src = readFileSync(join(__dirname, "..", route), "utf8");
      expect(src, route).toMatch(/actionRequestStatus\(\s*\{[^}]*scopes: context\.scopes[^}]*\}/);
    }
  });

  test("either scope that can make a request may follow one", () => {
    expect([...ACTION_STATUS_SCOPES]).toEqual(["home:control", "pocket_money:write"]);
  });
});
