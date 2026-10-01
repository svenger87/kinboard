import { test, expect } from "@playwright/test";
import { createTranslator } from "next-intl";
import en from "../messages/en.json";
import de from "../messages/de.json";
import fr from "../messages/fr.json";
import {
  ACTION_REQUEST_TTL_MS,
  BOOKING_NOTE_MAX,
  bookingNoteLabel,
  createActionRequest,
  decideActionRequest,
  describeRequest,
  describeRequest as describeRequestRaw,
  pocketMoneyBookingFrom,
  stripInvisible,
  toAssistantStatus,
  toScreenRequest,
  toScreenRequest as toScreenRequestRaw,
  type ActionFailureReason,
  type ActionRequestRow,
  type ActionRequestStore,
  type ActionTranslator,
  type DecideDeps,
  type PushRequest,
} from "../src/lib/home/action-requests";
import { outcomeNoticeKey, statusMessageKey } from "../src/lib/home/action-prompt";
import { amountToCents, bookPocketMoney, type BookingInput, type BookingResult, type RpcClient } from "../src/lib/pocket-money/booking";
import { lookupChild, type ChildLookup } from "../src/lib/pocket-money/children";
import { addPocketMoneyService } from "../src/lib/pocket-money/service";
import { SERVICES } from "../src/app/api/integration/v1/services/[service]/route";
import {
  parseBookingBody, requestPocketMoneyBooking, type BookingRequestDeps,
} from "../src/lib/integration-pocket-money";
import type { CreateKindRequestInput } from "../src/lib/home/action-requests";

/**
 * Pocket money from assistants (RFC-012 §3): asking for a booking, the
 * family allowing it with the PIN, and the booking running only then.
 *
 * Everything here runs against fakes that count what they were asked, so
 * "nothing was booked" is a count of zero, not an absence of errors. The
 * atomic balance guard itself is in SQL (book_pocket_money); it is proved
 * against the local database in the task report, including two concurrent
 * withdrawals.
 */

const FAMILY = "11111111-1111-1111-1111-111111111111";
const OTHER_FAMILY = "22222222-2222-2222-2222-222222222222";
const TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ENNO = "eeeeeeee-eeee-4eee-8eee-000000000001";
const PARENT = "eeeeeeee-eeee-4eee-8eee-000000000002";
const BINNED = "eeeeeeee-eeee-4eee-8eee-000000000003";
const NO_ACCOUNT = "eeeeeeee-eeee-4eee-8eee-000000000004";
const FOREIGN = "eeeeeeee-eeee-4eee-8eee-000000000005";
const ACCOUNT = "ffffffff-ffff-4fff-8fff-000000000001";
const T0 = new Date("2026-10-01T12:00:00.000Z");
const PIN = "4711";

const translators = Object.fromEntries(
  ([["en", en], ["de", de], ["fr", fr]] as const).map(([locale, messages]) => [
    locale, createTranslator({ locale, messages, namespace: "assistantActions" }) as unknown as ActionTranslator,
  ]),
) as Record<"en" | "de" | "fr", ActionTranslator>;
const EN = translators.en;

/** Intl's no-break and narrow no-break spaces as plain ones. */
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

const booking = (over: Record<string, unknown> = {}) => ({
  person_id: ENNO, person_name: "Enno", amount_cents: 500, currency: "EUR", type: "deposit", note: "mowing the lawn", ...over,
});

// ── amounts ─────────────────────────────────────────────────────────────────

test.describe("an amount in currency units becomes exact cents", () => {
  test("from its decimal text, with no float drift", () => {
    expect(amountToCents(0.01)).toBe(1);
    expect(amountToCents(0.29)).toBe(29); // 0.29 * 100 = 28.999999999999996
    expect(amountToCents(4.35)).toBe(435); // 4.35 * 100 = 434.99999999999994
    expect(amountToCents(1.1)).toBe(110);
    expect(amountToCents(5)).toBe(500);
    expect(amountToCents(19.99)).toBe(1999);
    expect(amountToCents(500)).toBe(50_000);
  });

  test("outside 0.01..500, more than two decimals, or not a number: refused", () => {
    for (const bad of [0, -1, -0.01, 0.001, 500.01, 501, 0.1 + 0.2, 1.005, Number.NaN, Infinity, "5", null, undefined, 1e21]) {
      expect(amountToCents(bad), String(bad)).toBeNull();
    }
  });
});

// ── the booking lib ─────────────────────────────────────────────────────────

test.describe("bookPocketMoney: one RPC, its answer read strictly", () => {
  function rpc(answer: { data: unknown; error: { message: string } | null }) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const client: RpcClient = { rpc: async (fn, args) => { calls.push({ fn, args }); return answer; } };
    return { client, calls };
  }
  const input: BookingInput = { familyId: FAMILY, accountId: ACCOUNT, amountCents: -300, type: "withdrawal", note: "ice cream" };

  test("sends the family, the account and the signed amount to book_pocket_money", async () => {
    const { client, calls } = rpc({ data: { ok: true, transaction: { id: "t1" }, balance_cents: 200 }, error: null });
    expect(await bookPocketMoney(client, input)).toEqual({ ok: true, transaction: { id: "t1" }, balanceCents: 200 });
    expect(calls).toEqual([{ fn: "book_pocket_money", args: {
      p_family_id: FAMILY, p_account_id: ACCOUNT, p_amount_cents: -300, p_type: "withdrawal",
      p_note: "ice cream", p_related_goal_id: null, p_created_by_person_id: null,
    } }]);
  });

  test("insufficient funds and a missing account are their own answers; anything else is a failure", async () => {
    expect(await bookPocketMoney(rpc({ data: { ok: false, error: "insufficient_funds" }, error: null }).client, input))
      .toEqual({ ok: false, error: "insufficient_funds" });
    expect(await bookPocketMoney(rpc({ data: { ok: false, error: "not_found" }, error: null }).client, input))
      .toEqual({ ok: false, error: "not_found" });
    expect(await bookPocketMoney(rpc({ data: null, error: { message: "boom" } }).client, input))
      .toEqual({ ok: false, error: "failed", message: "boom" });
    expect(await bookPocketMoney(rpc({ data: { ok: true }, error: null }).client, input))
      .toMatchObject({ ok: false, error: "failed" });
  });
});

// ── who can be booked for ───────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** Applies every filter it is given, so a missing family or deleted_at filter reaches the wrong row. */
function fakeDb() {
  const tables: Record<string, Row[]> = {
    people: [
      { id: ENNO, family_id: FAMILY, name: "Enno", is_child: true, deleted_at: null },
      { id: PARENT, family_id: FAMILY, name: "Mum", is_child: false, deleted_at: null },
      { id: BINNED, family_id: FAMILY, name: "Binned", is_child: true, deleted_at: "2026-09-30T10:00:00Z" },
      { id: NO_ACCOUNT, family_id: FAMILY, name: "Ida", is_child: true, deleted_at: null },
      { id: FOREIGN, family_id: OTHER_FAMILY, name: "Foreign", is_child: true, deleted_at: null },
    ],
    pocket_money_accounts: [
      { id: ACCOUNT, family_id: FAMILY, person_id: ENNO, currency: "EUR", balance_cents: 1000 },
      { id: "acc-parent", family_id: FAMILY, person_id: PARENT, currency: "EUR", balance_cents: 1000 },
      { id: "acc-binned", family_id: FAMILY, person_id: BINNED, currency: "EUR", balance_cents: 1000 },
      { id: "acc-foreign", family_id: OTHER_FAMILY, person_id: FOREIGN, currency: "EUR", balance_cents: 1000 },
      // An account that names our child but belongs to another family: never ours.
      { id: "acc-cross", family_id: OTHER_FAMILY, person_id: NO_ACCOUNT, currency: "EUR", balance_cents: 1000 },
    ],
  };
  const db = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const chain = {
        select() { return chain; },
        eq(c: string, v: unknown) { filters.push([c, v]); return chain; },
        is(c: string, v: unknown) { filters.push([c, v]); return chain; },
        async maybeSingle() {
          const hit = (tables[table] ?? []).filter((r) => filters.every(([c, v]) => (r[c] ?? null) === v));
          return { data: hit[0] ?? null, error: null };
        },
      };
      return chain;
    },
  };
  return db;
}

test.describe("who can be booked for: a child of this family, not binned, with an account", () => {
  test("a child with an account", async () => {
    expect(await lookupChild(FAMILY, ENNO, fakeDb())).toEqual({
      status: "ok", name: "Enno", account: { id: ACCOUNT, currency: "EUR", balanceCents: 1000 },
    });
  });

  test("anyone else is refused, and says why", async () => {
    const db = fakeDb();
    expect(await lookupChild(FAMILY, PARENT, db)).toEqual({ status: "not_a_child", name: "Mum" });
    expect(await lookupChild(FAMILY, BINNED, db)).toEqual({ status: "no_person" });
    expect(await lookupChild(FAMILY, FOREIGN, db)).toEqual({ status: "no_person" });
    expect(await lookupChild(FAMILY, NO_ACCOUNT, db)).toEqual({ status: "no_account", name: "Ida" });
    expect(await lookupChild(FAMILY, "00000000-0000-4000-8000-000000000000", db)).toEqual({ status: "no_person" });
    expect(await lookupChild(FAMILY, "not-a-uuid", db)).toEqual({ status: "no_person" });
    // From the other family's side, our child is nobody.
    expect(await lookupChild(OTHER_FAMILY, ENNO, db)).toEqual({ status: "no_person" });
  });
});

// ── asking for a booking ────────────────────────────────────────────────────

function requestDeps(opts: {
  child?: ChildLookup;
  pin?: boolean | "throws";
  budget?: { ok: true } | { ok: false; retryAfterMs: number } | "throws";
} = {}) {
  const log = { lookups: [] as string[], budgets: 0, created: [] as CreateKindRequestInput[] };
  const d: BookingRequestDeps = {
    lookupChild: async (familyId, personId) => {
      log.lookups.push(`${familyId}/${personId}`);
      return opts.child ?? { status: "ok", name: "Enno", account: { id: ACCOUNT, currency: "EUR", balanceCents: 1000 } };
    },
    familyHasPin: async () => {
      if (opts.pin === "throws") throw new Error("db");
      return opts.pin ?? true;
    },
    confirmationBudget: async () => {
      log.budgets++;
      if (opts.budget === "throws") throw new Error("db");
      return opts.budget ?? { ok: true };
    },
    createRequest: async (input) => {
      log.created.push(input);
      return { id: "req-1", expiresAt: "2026-10-01T12:02:00.000Z" };
    },
  };
  return { d, log };
}

const ask = (body: unknown, d: BookingRequestDeps) =>
  requestPocketMoneyBooking({ familyId: FAMILY, tokenId: TOKEN, clientName: "ChatGPT", body }, d);

test.describe("POST /pocket-money/bookings: asking stores a request, and books nothing", () => {
  const body = { person_id: ENNO, amount: 5, type: "deposit", note: "  mowing the lawn " };

  test("202 pending_confirmation, with the booking stored exactly as RFC-012 §3 says", async () => {
    const { d, log } = requestDeps();
    const res = await ask(body, d);
    expect(res).toEqual({
      status: 202, body: { status: "pending_confirmation", request_id: "req-1", expires_at: "2026-10-01T12:02:00.000Z" },
    });
    expect(log.lookups).toEqual([`${FAMILY}/${ENNO}`]);
    expect(log.budgets).toBe(1);
    expect(log.created).toEqual([{
      kind: "pocket_money", familyId: FAMILY, tokenId: TOKEN, clientName: "ChatGPT",
      data: { person_id: ENNO, person_name: "Enno", amount_cents: 500, currency: "EUR", type: "deposit", note: "mowing the lawn" },
    }]);
  });

  test("a withdrawal is stored with a positive amount and its type; an empty note is no note", async () => {
    const { d, log } = requestDeps();
    expect((await ask({ person_id: ENNO, amount: 2.35, type: "withdrawal", note: "   " }, d)).status).toBe(202);
    expect(log.created[0].data).toMatchObject({ amount_cents: 235, type: "withdrawal", note: null });
  });

  test("a body that is not a booking: 400 before anything is looked up", async () => {
    for (const bad of [
      null, [], "x", {},
      { ...body, person_id: "Enno" },
      { ...body, amount: 0 }, { ...body, amount: 500.5 }, { ...body, amount: 1.234 }, { ...body, amount: "5" },
      { ...body, type: "manual_deposit" }, { ...body, type: undefined },
      { ...body, note: 5 }, { ...body, note: "x".repeat(BOOKING_NOTE_MAX + 1) },
    ]) {
      const { d, log } = requestDeps();
      const res = await ask(bad, d);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.code).toBe("invalid_request");
      expect(log.lookups).toEqual([]);
      expect(log.created).toEqual([]);
    }
    expect(parseBookingBody({ ...body, note: "x".repeat(BOOKING_NOTE_MAX) }).ok).toBe(true);
  });

  test("a person who is not a child of this family with an account: refused with its reason, nothing stored", async () => {
    const cases: [ChildLookup, number, string, string][] = [
      [{ status: "no_person" }, 404, "not_found", "no_person"],
      [{ status: "not_a_child", name: "Mum" }, 400, "invalid_request", "not_a_child"],
      [{ status: "no_account", name: "Ida" }, 404, "not_found", "no_account"],
    ];
    for (const [child, status, code, reason] of cases) {
      const { d, log } = requestDeps({ child });
      const res = await ask(body, d);
      expect(res, reason).toMatchObject({ status, body: { code, reason } });
      expect(log.budgets).toBe(0);
      expect(log.created).toEqual([]);
    }
  });

  test("a note is stored without invisible characters", async () => {
    const { d, log } = requestDeps();
    expect((await ask({ ...body, note: "\u202Emowing\u200B the lawn\u2069" }, d)).status).toBe(202);
    expect(log.created[0].data.note).toBe("mowing the lawn");
    expect((await ask({ ...body, note: "\u202E\u200B" }, requestDeps().d)).status).toBe(202);
  });

  test("what the handler would refuse later is refused now: nothing stored, no screen asked", async () => {
    for (const child of [
      { status: "ok", name: "x".repeat(201), account: { id: ACCOUNT, currency: "EUR", balanceCents: 1000 } },
      { status: "ok", name: "Enno", account: { id: ACCOUNT, currency: "", balanceCents: 1000 } },
      { status: "ok", name: "Enno", account: { id: ACCOUNT, currency: "TOOLONGCUR", balanceCents: 1000 } },
    ] as ChildLookup[]) {
      const { d, log } = requestDeps({ child });
      expect(await ask(body, d)).toMatchObject({ status: 400, body: { code: "invalid_request" } });
      expect(log.budgets).toBe(0);
      expect(log.created).toEqual([]);
    }
  });

  test("a withdrawal larger than the balance is refused before anyone is asked", async () => {
    const child: ChildLookup = { status: "ok", name: "Enno", account: { id: ACCOUNT, currency: "EUR", balanceCents: 499 } };
    const { d, log } = requestDeps({ child });
    expect(await ask({ ...body, type: "withdrawal" }, d)).toMatchObject({ status: 400, body: { reason: "insufficient_funds" } });
    expect(log.created).toEqual([]);
    // Exactly the balance is fine.
    const ok = requestDeps({ child: { ...child, account: { ...child.account, balanceCents: 500 } } });
    expect((await ask({ ...body, type: "withdrawal" }, ok.d)).status).toBe(202);
  });

  test("no PIN: 403 pin_required, nothing stored, no budget spent", async () => {
    const { d, log } = requestDeps({ pin: false });
    expect(await ask(body, d)).toMatchObject({ status: 403, body: { code: "forbidden", reason: "pin_required" } });
    expect(log.budgets).toBe(0);
    expect(log.created).toEqual([]);
    const unreadable = requestDeps({ pin: "throws" });
    expect((await ask(body, unreadable.d)).status).toBe(503);
    expect(unreadable.log.created).toEqual([]);
  });

  test("the confirmation budget is the home one: refused → 429 with Retry-After, nothing stored", async () => {
    const { d, log } = requestDeps({ budget: { ok: false, retryAfterMs: 61_500 } });
    expect(await ask(body, d)).toMatchObject({ status: 429, body: { code: "rate_limited" }, headers: { "retry-after": "62" } });
    expect(log.created).toEqual([]);
    const unreadable = requestDeps({ budget: "throws" });
    expect((await ask(body, unreadable.d)).status).toBe(503);
    expect(unreadable.log.created).toEqual([]);
  });
});

// ── allowing it ─────────────────────────────────────────────────────────────

let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function fakeStore() {
  const rows = new Map<string, ActionRequestRow>();
  const revoked = new Set<string>();
  const store: ActionRequestStore = {
    insert: async (row) => {
      const full: ActionRequestRow = { ...row, id: newId(), created_at: T0.toISOString() };
      rows.set(full.id, full);
      return { ...full };
    },
    get: async (id, familyId) => {
      const r = rows.get(id);
      return r && r.family_id === familyId ? { ...r } : null;
    },
    listPending: async (familyId) => [...rows.values()].filter((r) => r.family_id === familyId && r.status === "pending"),
    transition: async (id, familyId, from, patch, unexpiredAt) => {
      const r = rows.get(id);
      if (!r || r.family_id !== familyId || r.status !== from) return null;
      if (unexpiredAt && !(Date.parse(r.expires_at) > Date.parse(unexpiredAt))) return null;
      Object.assign(r, patch);
      return { ...r };
    },
    tokenActive: async (tokenId) => tokenId !== null && !revoked.has(tokenId),
  };
  return { store, rows, revoked };
}

function seedBooking(rows: Map<string, ActionRequestRow>, over: Partial<ActionRequestRow> = {}): ActionRequestRow {
  const row: ActionRequestRow = {
    id: newId(), family_id: FAMILY, token_id: TOKEN, client_name: "ChatGPT", kind: "pocket_money",
    entity_id: null, entity_name: null, domain: null, service: null, data: booking(),
    status: "pending", created_at: T0.toISOString(),
    expires_at: new Date(T0.getTime() + ACTION_REQUEST_TTL_MS).toISOString(),
    decided_at: null, decided_by_device_id: null, result: null, ...over,
  };
  rows.set(row.id, row);
  return row;
}

function decideDeps(store: ActionRequestStore, opts: {
  pin?: string | null;
  account?: () => Promise<{ accountId: string; currency: string } | null>;
  book?: (input: BookingInput) => Promise<BookingResult>;
} = {}) {
  const booked: BookingInput[] = [];
  const lookups: string[] = [];
  const ha: unknown[] = [];
  const pin = opts.pin === undefined ? PIN : opts.pin;
  const d: DecideDeps = {
    store,
    hasPin: async () => pin !== null,
    verifyPin: async (_f, given) => (given === pin ? "valid" : "invalid"),
    callHaService: async (...args) => { ha.push(args); return { ok: true, status: 200 }; },
    catalogueEntity: async () => { ha.push("catalogue"); return {}; },
    pocketMoneyAccount: async (familyId, personId) => {
      lookups.push(`${familyId}/${personId}`);
      return opts.account ? opts.account() : { accountId: ACCOUNT, currency: "EUR" };
    },
    bookPocketMoney: async (input) => {
      booked.push(input);
      return opts.book ? opts.book(input) : { ok: true, transaction: { id: "t1" }, balanceCents: 1500 };
    },
    now: () => new Date(T0.getTime() + 30_000),
  };
  return { d, booked, lookups, ha };
}

const decide = (d: DecideDeps, id: string, decision = "approve", pin: unknown = PIN, familyId = FAMILY) =>
  decideActionRequest({ id, familyId, deviceId: DEVICE, decision, pin }, d);

test.describe("an assistant's booking runs only once a family member allowed it with the PIN", () => {
  test("allowed with the PIN: booked once, as stored, and done", async () => {
    const { store, rows } = fakeStore();
    const row = seedBooking(rows);
    const { d, booked, lookups, ha } = decideDeps(store);
    expect(booked).toEqual([]); // stored is not booked
    const res = await decide(d, row.id);
    expect(res.status).toBe(200);
    expect(lookups).toEqual([`${FAMILY}/${ENNO}`, `${FAMILY}/${ENNO}`]); // validate, then again right before booking
    expect(booked).toEqual([{ familyId: FAMILY, accountId: ACCOUNT, amountCents: 500, type: "manual_deposit", note: "mowing the lawn" }]);
    expect(rows.get(row.id)).toMatchObject({ status: "done", result: { status: 0 }, decided_by_device_id: DEVICE });
    expect(ha).toEqual([]);
  });

  test("a withdrawal is booked negative, as a withdrawal; no note → the assistant's name", async () => {
    const { store, rows } = fakeStore();
    const row = seedBooking(rows, { data: booking({ type: "withdrawal", amount_cents: 235, note: null }) });
    const { d, booked } = decideDeps(store);
    await decide(d, row.id);
    expect(booked).toEqual([{ familyId: FAMILY, accountId: ACCOUNT, amountCents: -235, type: "withdrawal", note: "ChatGPT" }]);
  });

  test("denied, a wrong PIN, no PIN at all, expired, revoked, another family, or decided twice: never booked", async () => {
    const { store, rows, revoked } = fakeStore();
    const { d, booked } = decideDeps(store);

    const denied = seedBooking(rows);
    expect((await decide(d, denied.id, "deny", undefined)).status).toBe(200);
    expect(rows.get(denied.id)!.status).toBe("denied");

    const wrong = seedBooking(rows);
    expect(await decide(d, wrong.id, "approve", "0000")).toMatchObject({ status: 403, error: "pin_invalid" });
    expect(rows.get(wrong.id)!.status).toBe("pending");

    const noPin = decideDeps(store, { pin: null });
    const unpinned = seedBooking(rows);
    expect(await decide(noPin.d, unpinned.id)).toMatchObject({ status: 403, error: "pin_required" });

    const old = seedBooking(rows, { expires_at: T0.toISOString() });
    expect(await decide(d, old.id)).toMatchObject({ status: 409, error: "expired" });

    const orphan = seedBooking(rows, { token_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
    revoked.add("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(await decide(d, orphan.id)).toMatchObject({ status: 409, error: "revoked" });

    const theirs = seedBooking(rows, { family_id: OTHER_FAMILY });
    expect(await decide(d, theirs.id)).toMatchObject({ status: 404 });

    expect(booked).toEqual([]);
    expect(noPin.booked).toEqual([]);

    const twice = seedBooking(rows);
    await decide(d, twice.id);
    expect(await decide(d, twice.id)).toMatchObject({ status: 409, error: "already_decided" });
    expect(booked).toHaveLength(1);
  });

  test("two screens allowing it at once book it once", async () => {
    const { store, rows } = fakeStore();
    const row = seedBooking(rows);
    const { d, booked } = decideDeps(store);
    const results = await Promise.all([decide(d, row.id), decide(d, row.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(booked).toHaveLength(1);
  });

  test("the child or the account gone by then: failed / no_account, nothing booked", async () => {
    const { store, rows } = fakeStore();
    const row = seedBooking(rows);
    const { d, booked } = decideDeps(store, { account: async () => null });
    await decide(d, row.id);
    expect(booked).toEqual([]);
    expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { status: 0, reason: "no_account" } });
  });

  test("the account going between the check and the booking: no_account, nothing booked", async () => {
    const { store, rows } = fakeStore();
    const row = seedBooking(rows);
    let calls = 0;
    const { d, booked } = decideDeps(store, { account: async () => (++calls === 1 ? { accountId: ACCOUNT, currency: "EUR" } : null) });
    await decide(d, row.id);
    expect(calls).toBe(2);
    expect(booked).toEqual([]);
    expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { status: 0, reason: "no_account" } });
  });

  test("the account's currency changed since the family said yes: not_allowed, nothing booked", async () => {
    // At the check…
    {
      const { store, rows } = fakeStore();
      const row = seedBooking(rows);
      const { d, booked } = decideDeps(store, { account: async () => ({ accountId: ACCOUNT, currency: "CHF" }) });
      await decide(d, row.id);
      expect(booked).toEqual([]);
      expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { reason: "not_allowed" } });
    }
    // …or between the check and the booking.
    {
      const { store, rows } = fakeStore();
      const row = seedBooking(rows);
      let calls = 0;
      const { d, booked } = decideDeps(store, {
        account: async () => ({ accountId: ACCOUNT, currency: ++calls === 1 ? "EUR" : "CHF" }),
      });
      await decide(d, row.id);
      expect(calls).toBe(2);
      expect(booked).toEqual([]);
      expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { reason: "not_allowed" } });
    }
  });

  test("not enough money by then: failed / insufficient_funds, with words of its own", async () => {
    const { store, rows } = fakeStore();
    const row = seedBooking(rows, { data: booking({ type: "withdrawal" }) });
    const { d, booked } = decideDeps(store, { book: async () => ({ ok: false, error: "insufficient_funds" }) });
    await decide(d, row.id);
    expect(booked).toHaveLength(1);
    const ended = rows.get(row.id)!;
    expect(ended).toMatchObject({ status: "failed", result: { status: 0, reason: "insufficient_funds" } });
    expect(statusMessageKey(ended)).toBe("status.insufficient_funds");
    expect(EN(statusMessageKey(ended))).not.toMatch(/Home Assistant|device/i);
  });

  test("the database refusing, or the lookup or booking throwing: failed / booking_failed", async () => {
    for (const opts of [
      { book: async () => ({ ok: false as const, error: "failed" as const, message: "x" }) },
      { book: async (): Promise<BookingResult> => { throw new Error("network"); } },
      { account: async (): Promise<{ accountId: string; currency: string } | null> => { throw new Error("db"); } },
    ]) {
      const { store, rows } = fakeStore();
      const row = seedBooking(rows);
      const { d } = decideDeps(store, opts);
      await decide(d, row.id);
      expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { status: 0, reason: "booking_failed" } });
    }
  });

  test("stored data that is not a booking never books", async () => {
    for (const data of [
      {}, booking({ amount_cents: 0 }), booking({ amount_cents: 50_001 }), booking({ amount_cents: 1.5 }),
      booking({ type: "adjustment" }), booking({ person_id: "Enno" }), booking({ note: "x".repeat(BOOKING_NOTE_MAX + 1) }),
    ]) {
      const { store, rows } = fakeStore();
      const row = seedBooking(rows, { data });
      const { d, booked } = decideDeps(store);
      await decide(d, row.id);
      expect(booked, JSON.stringify(data)).toEqual([]);
      expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { reason: "not_allowed" } });
    }
  });

  test("without the pocket-money dependencies nothing books: not_available", async () => {
    const { store, rows } = fakeStore();
    const row = seedBooking(rows);
    const { d } = decideDeps(store);
    delete d.bookPocketMoney;
    await decide(d, row.id);
    expect(rows.get(row.id)).toMatchObject({ status: "failed", result: { reason: "not_available" } });
  });
});

// ── in words ────────────────────────────────────────────────────────────────

test.describe("the family is asked in words, with the assistant's note in quotes", () => {
  const row = (data: Record<string, unknown>) => {
    const { rows } = fakeStore();
    return seedBooking(rows, { data });
  };

  test("the push and the screens, in every language", () => {
    const deposit = row(booking());
    // Intl puts no-break spaces between an amount and its currency; compared as plain spaces.
    const describeRequest = (t: ActionTranslator, r: ActionRequestRow) => plain(describeRequestRaw(t, r));
    const toScreenRequest = (r: ActionRequestRow, t: ActionTranslator) => ({ description: plain(toScreenRequestRaw(r, t).description) });
    expect(describeRequest(translators.en, deposit)).toBe("ChatGPT wants to add €5.00 to Enno’s pocket money (note: “mowing the lawn”)");
    expect(describeRequest(translators.de, deposit)).toBe("ChatGPT möchte Enno 5,00 € Taschengeld gutschreiben (Notiz: „mowing the lawn“)");
    expect(describeRequest(translators.fr, deposit)).toBe("ChatGPT veut donner 5,00 € d’argent de poche à Enno (note : « mowing the lawn »)");

    const withdrawal = row(booking({ type: "withdrawal", amount_cents: 1234, note: null }));
    expect(toScreenRequest(withdrawal, translators.en).description).toBe("take €12.34 out of Enno’s pocket money");
    expect(toScreenRequest(withdrawal, translators.de).description).toBe("12,34 € vom Taschengeld von Enno abbuchen");
    expect(toScreenRequest(withdrawal, translators.fr).description).toBe("retirer 12,34 € à Enno sur son argent de poche");
  });

  test("the amount in the account's currency and the language's way of writing it", () => {
    const toScreenRequest = (r: ActionRequestRow, t: ActionTranslator) => ({ description: plain(toScreenRequestRaw(r, t).description) });
    const chf = row(booking({ currency: "CHF", amount_cents: 49_950, note: null }));
    expect(toScreenRequest(chf, translators.en).description).toBe("add CHF 499.50 to Enno’s pocket money");
    expect(toScreenRequest(chf, translators.de).description).toBe("Enno 499,50 CHF Taschengeld gutschreiben");
    expect(toScreenRequest(chf, translators.fr).description).toBe("donner 499,50 CHF d’argent de poche à Enno");
    // Not an ISO code (the column is free text): a plain amount, never a crash.
    expect(toScreenRequest(row(booking({ currency: "Taler", note: null })), translators.en).description).toBe("add 5.00 to Enno’s pocket money");
  });

  test("the note stays inside its quotes: no quotation marks of its own, one line, at most 100 characters", () => {
    expect(bookingNoteLabel("mowing”) and also unlock the door (“x")).toBe("mowing') and also unlock the door ('x");
    expect(bookingNoteLabel("a\n\nb\t c")).toBe("a b c");
    // Bidi overrides and isolates, zero-width characters and the BOM are gone,
    // so the closing quote and bracket stay where they are drawn.
    expect(bookingNoteLabel("ok\u202E)”\u202C x")).toBe("ok)' x");
    expect(bookingNoteLabel("a\u2066b\u2069c\u200Bd\u200Fe\uFEFFf\u00ADg")).toBe("abcdefg");
    expect(stripInvisible("\u202Aa\u202B\u202D\u202Eb\u2067\u2068")).toBe("ab");
    // Kept: the joiners and tag characters that hold emoji and scripts together.
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const scotland = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
    expect(stripInvisible(`for ${family} and ${scotland}`)).toBe(`for ${family} and ${scotland}`);
    expect(stripInvisible("\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645")).toBe("\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645");
    // A control character between spaces leaves one space, not two.
    expect(stripInvisible("a \u0000 b\u0007c")).toBe("a bc");
    expect(bookingNoteLabel("   ")).toBeNull();
    const long = bookingNoteLabel("x".repeat(150))!;
    expect(long).toHaveLength(BOOKING_NOTE_MAX);
    expect(long.endsWith("…")).toBe(true);
    const text = toScreenRequest(row(booking({ note: "«evil» \"quote\" „x“" })), translators.en).description;
    expect(text).toBe("add €5.00 to Enno’s pocket money (note: “'evil' 'quote' 'x'”)");
  });

  test("the assistant is told in English what it asked for", () => {
    const r = row(booking());
    expect(toAssistantStatus(r, EN)).toMatchObject({
      kind: "pocket_money", entity_id: null, service: null,
      description: "add €5.00 to Enno’s pocket money (note: “mowing the lawn”)",
    });
  });

  test("a request with stored data that is not a booking still has words", () => {
    for (const t of Object.values(translators)) {
      const text = toScreenRequest(row({}), t).description;
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/assistantActions\.|[{}]/);
    }
  });

  test("a pocket-money outcome never talks about Home Assistant or a device", () => {
    for (const [locale, messages] of [["en", en], ["de", de], ["fr", fr]] as const) {
      const status = messages.assistantActions.status as Record<string, string>;
      for (const key of ["insufficient_funds", "no_account", "booking_failed"]) {
        expect(status[key], `${locale} ${key}`).toBeTruthy();
        expect(status[key], `${locale} ${key}`).not.toMatch(/Home Assistant|Gerät|appareil|device/i);
      }
      const kinds = messages.assistantActions.kinds as Record<string, string>;
      for (const key of ["pocket_money_deposit", "pocket_money_withdrawal", "pocket_money_note"]) expect(kinds[key]).toBeTruthy();
    }
    const failed = (reason?: ActionFailureReason) => ({ kind: "pocket_money" as const, status: "failed" as const, result: reason ? { status: 0, reason } : { status: 0 } });
    expect(statusMessageKey(failed("no_account"))).toBe("status.no_account");
    expect(statusMessageKey(failed())).toBe("status.booking_failed");
    expect(statusMessageKey(failed("unknown_outcome"))).toBe("status.booking_failed");
    expect(outcomeNoticeKey({ kind: "pocket_money", status: "approved", result: null })).toBe("status.booking_failed");
    // Home is as it was.
    expect(statusMessageKey({ kind: "home", status: "failed", result: { status: 500 } })).toBe("status.failed");
    expect(outcomeNoticeKey({ kind: "home", status: "approved", result: null })).toBe("status.unknown_outcome");
  });

  test("created as a request of its own kind, and the push says what it is", async () => {
    const { store, rows } = fakeStore();
    const pushes: PushRequest[] = [];
    const res = await createActionRequest(
      { kind: "pocket_money", familyId: FAMILY, tokenId: TOKEN, clientName: "ChatGPT", data: booking() },
      { store, push: async (p) => { pushes.push(p); }, now: () => T0 },
    );
    expect(rows.get(res.id)).toMatchObject({ kind: "pocket_money", entity_id: null, status: "pending", data: booking() });
    expect(describeRequest(EN, pushes[0].request)).toBe("ChatGPT wants to add €5.00 to Enno’s pocket money (note: “mowing the lawn”)");
    expect(pocketMoneyBookingFrom(rows.get(res.id)!.data)).toEqual(booking());
  });
});

// ── the RFC-001 service ─────────────────────────────────────────────────────

test.describe("services/add_pocket_money books at once for Home Assistant, and never for an assistant", () => {
  /** The family's client, as the service uses it: people, the account, and the booking RPC. */
  function serviceDb(answer: unknown = { ok: true, transaction: { id: "t1" }, balance_cents: 1250 }) {
    const reads: string[] = [];
    const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
    const db = {
      from(table: string) {
        reads.push(table);
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          is() { return chain; },
          async maybeSingle() { return { data: { id: ACCOUNT }, error: null }; },
          then(resolve: (v: unknown) => void) { resolve({ data: [{ id: ENNO, name: "Enno" }], error: null }); },
        };
        return chain;
      },
      async rpc(fn: string, args: Record<string, unknown>) { rpcs.push({ fn, args }); return { data: answer, error: null }; },
    };
    return { db, reads, rpcs };
  }

  test("an assistant's (OAuth-issued) token: 403, nothing read, nothing booked", async () => {
    const { db, reads, rpcs } = serviceDb();
    const res = await addPocketMoneyService({ familyId: FAMILY, body: { person: "Enno", amount: 2.5 }, assistant: true }, db);
    expect(res).toMatchObject({ status: 403, response: { code: "forbidden" } });
    expect(String(res.response.error)).toContain("POST /pocket-money/bookings");
    expect(reads).toEqual([]);
    expect(rpcs).toEqual([]);
  });

  test("the route's own add_pocket_money hands the token's assistant flag to the service", async () => {
    // A client that throws on any use: if the flag were dropped on the way,
    // the service would go on to read people and this would throw instead.
    const untouchable = new Proxy({}, { get() { throw new Error("the database was touched"); } });
    const res = await SERVICES.add_pocket_money.handle({ familyId: FAMILY, body: { person: "Enno", amount: 2.5 }, assistant: true, db: untouchable });
    expect(res).toMatchObject({ status: 403, response: { code: "forbidden" } });
    expect(SERVICES.add_pocket_money.scope).toBe("tasks:write");
  });

  test("a Home Assistant token books once: a deposit as manual_deposit, the note defaulting to Home Assistant", async () => {
    const { db, rpcs } = serviceDb();
    const res = await addPocketMoneyService({ familyId: FAMILY, body: { person: "enno", amount: 2.5 }, assistant: false }, db);
    expect(res).toEqual({ status: 201, response: { person_id: ENNO, person: "Enno", amount: 2.5, balance: 12.5 } });
    expect(rpcs).toEqual([{ fn: "book_pocket_money", args: {
      p_family_id: FAMILY, p_account_id: ACCOUNT, p_amount_cents: 250, p_type: "manual_deposit",
      p_note: "Home Assistant", p_related_goal_id: null, p_created_by_person_id: null,
    } }]);
  });

  test("a negative amount is a withdrawal with its note; too little money is the old 400", async () => {
    const { db, rpcs } = serviceDb({ ok: false, error: "insufficient_funds" });
    const res = await addPocketMoneyService({ familyId: FAMILY, body: { person: "Enno", amount: -1.25, note: "sweets" }, assistant: false }, db);
    expect(res).toEqual({ status: 400, response: { error: "insufficient_funds", code: "invalid_request" } });
    expect(rpcs[0].args).toMatchObject({ p_amount_cents: -125, p_type: "withdrawal", p_note: "sweets" });
  });
});
