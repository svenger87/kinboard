import { test, expect } from "@playwright/test";
import { SERVICE_HANDLERS } from "../src/app/api/integration/v1/services/[service]/route";

/**
 * The service arguments, as Home Assistant actually sends them (#309).
 *
 * RFC-001 §5.2 names them `add_pocket_money(person_id, amount, reason)` and
 * `dismiss_attention(attention_id)`, and the Home Assistant component passes
 * the service data through unchanged. The server shipped reading `person`,
 * `note`, `key` and `rule_id` instead, so both services answered 400 to every
 * call from Home Assistant and nothing here noticed, because nothing sent the
 * component's payload. These do: the real handlers, a stand-in database that
 * honours the filters it is given, and the payload byte for byte.
 */

type Row = Record<string, unknown>;

/**
 * A stand-in for the service-role client. It applies `eq`, `is` and the one
 * `or` shape the handlers use, so a handler that forgets a filter sees rows it
 * should not — which is the point: a fake that ignored filters could not tell
 * a family-scoped query from an unscoped one.
 */
function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(seed).map(([name, rows]) => [name, rows.map((r) => ({ ...r }))]),
  );
  const writes: Array<{ table: string; op: "insert" | "update"; row: Row }> = [];

  function from(table: string) {
    const preds: Array<(row: Row) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row = {};

    const matching = () => (tables[table] ?? []).filter((row) => preds.every((p) => p(row)));
    const run = () => {
      if (op === "insert") {
        const row = { id: `new-${writes.length}`, ...payload };
        (tables[table] ??= []).push(row);
        writes.push({ table, op, row });
        return [row];
      }
      const rows = matching();
      if (op === "update") {
        for (const row of rows) {
          Object.assign(row, payload);
          writes.push({ table, op, row: { ...row } });
        }
      }
      return rows;
    };

    const chain = {
      select: () => chain,
      insert: (row: Row) => ((op = "insert"), (payload = row), chain),
      update: (patch: Row) => ((op = "update"), (payload = patch), chain),
      eq: (column: string, value: unknown) => (preds.push((r) => r[column] === value), chain),
      is: (column: string, value: unknown) =>
        (preds.push((r) => (r[column] ?? null) === value), chain),
      or: (filter: string) => {
        const alternatives = filter.split(",").map((part) => {
          const [column, operator, ...rest] = part.split(".");
          if (operator !== "eq") throw new Error(`fake db: unsupported or() operator ${operator}`);
          return { column, value: rest.join(".") };
        });
        preds.push((r) => alternatives.some((a) => r[a.column] === a.value));
        return chain;
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve({ data: run(), error: null }).then(resolve),
    };
    return chain;
  }

  return { from, tables, writes };
}

const OURS = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";
const MIA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BEN_BINNED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEA_FOREIGN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function pocketMoneyDb() {
  return fakeDb({
    people: [
      { id: MIA, name: "Mia", family_id: OURS, deleted_at: null },
      { id: BEN_BINNED, name: "Ben", family_id: OURS, deleted_at: "2026-09-01T00:00:00Z" },
      { id: LEA_FOREIGN, name: "Lea", family_id: THEIRS, deleted_at: null },
    ],
    pocket_money_accounts: [
      { id: "acct-mia", family_id: OURS, person_id: MIA, balance_cents: 500, lifetime_saved_cents: 500 },
      { id: "acct-ben", family_id: OURS, person_id: BEN_BINNED, balance_cents: 0, lifetime_saved_cents: 0 },
      // Lea's account carries OUR family id on purpose. That isolates the
      // person check: if the people lookup ever stopped filtering by family,
      // the account lookup would not catch it here, and the test must fail.
      { id: "acct-lea", family_id: OURS, person_id: LEA_FOREIGN, balance_cents: 0, lifetime_saved_cents: 0 },
    ],
    pocket_money_transactions: [],
  });
}

const addPocketMoney = SERVICE_HANDLERS.add_pocket_money;
const dismissAttention = SERVICE_HANDLERS.dismiss_attention;

test.describe("add_pocket_money", () => {
  test("accepts exactly what the Home Assistant component sends", async () => {
    const db = pocketMoneyDb();
    // services.yaml: person_id, amount, reason — passed through unchanged.
    const body = { person_id: MIA, amount: 2.5, reason: "Rasen gemäht" };

    const result = await addPocketMoney({ familyId: OURS, body, db });

    expect(result.status).toBe(201);
    expect(result.response).toEqual({ person_id: MIA, person: "Mia", amount: 2.5, balance: 7.5 });
    const txn = db.tables.pocket_money_transactions[0];
    expect(txn).toMatchObject({ account_id: "acct-mia", amount_cents: 250, note: "Rasen gemäht" });
    expect(db.tables.pocket_money_accounts[0]).toMatchObject({
      balance_cents: 750,
      lifetime_saved_cents: 750,
    });
  });

  test("a person_id from another family is not found, and nothing is written", async () => {
    const db = pocketMoneyDb();
    const result = await addPocketMoney({
      familyId: OURS,
      body: { person_id: LEA_FOREIGN, amount: 5, reason: "x" },
      db,
    });

    expect(result.status).toBe(404);
    expect(result.response).toEqual({ error: `No person with id ${LEA_FOREIGN}`, code: "not_found" });
    expect(db.writes).toEqual([]);
  });

  test("a person in the recycle bin is not found either", async () => {
    const db = pocketMoneyDb();
    const result = await addPocketMoney({
      familyId: OURS,
      body: { person_id: BEN_BINNED, amount: 5, reason: "x" },
      db,
    });
    expect(result.status).toBe(404);
    expect(db.writes).toEqual([]);
  });

  test("an id that is not a uuid is not found rather than an error", async () => {
    const db = pocketMoneyDb();
    const result = await addPocketMoney({
      familyId: OURS,
      body: { person_id: "sensor.mia", amount: 1, reason: "x" },
      db,
    });
    expect(result.status).toBe(404);
  });

  test("the older `person` and `note` still work", async () => {
    const db = pocketMoneyDb();
    const result = await addPocketMoney({
      familyId: OURS,
      body: { person: "mia", amount: -1, note: "Eis" },
      db,
    });

    expect(result.status).toBe(201);
    expect(result.response).toMatchObject({ person: "Mia", balance: 4 });
    expect(db.tables.pocket_money_transactions[0]).toMatchObject({
      amount_cents: -100,
      type: "withdrawal",
      note: "Eis",
    });
  });

  test("person_id wins over person, and reason wins over note", async () => {
    const db = pocketMoneyDb();
    db.tables.people.push({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Tom", family_id: OURS, deleted_at: null });

    const result = await addPocketMoney({
      familyId: OURS,
      body: { person_id: MIA, person: "Tom", amount: 1, reason: "RFC", note: "old" },
      db,
    });

    expect(result.status).toBe(201);
    expect(result.response).toMatchObject({ person_id: MIA, person: "Mia" });
    expect(db.tables.pocket_money_transactions[0]).toMatchObject({ note: "RFC" });
  });

  test("with no reason or note the booking still says where it came from", async () => {
    const db = pocketMoneyDb();
    await addPocketMoney({ familyId: OURS, body: { person_id: MIA, amount: 1 }, db });
    expect(db.tables.pocket_money_transactions[0]).toMatchObject({ note: "Home Assistant" });
  });

  test("a missing person names the RFC field first", async () => {
    const result = await addPocketMoney({ familyId: OURS, body: { amount: 1 }, db: pocketMoneyDb() });
    expect(result.status).toBe(400);
    expect(String(result.response.error)).toMatch(/^`person_id`/);
  });
});

const KEY = "lock-up-before-bed:2026-10-01";
const ROW_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FOREIGN_ROW_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function attentionDb() {
  return fakeDb({
    attention_items: [
      { id: ROW_ID, family_id: OURS, rule_id: "lock-up-before-bed", item_key: KEY, state: "active", resolved_at: null },
      { id: "99999999-9999-4999-8999-999999999999", family_id: OURS, rule_id: "bins-out", item_key: "bins-out:2026-10-02", state: "active", resolved_at: null },
      // The same key in another family, and a row of theirs addressed by id.
      { id: FOREIGN_ROW_ID, family_id: THEIRS, rule_id: "lock-up-before-bed", item_key: KEY, state: "active", resolved_at: null },
    ],
  });
}

test.describe("dismiss_attention", () => {
  test("accepts exactly what the Home Assistant component sends", async () => {
    const db = attentionDb();
    // services.yaml: attention_id — the item key, as the summary reports it.
    const result = await dismissAttention({ familyId: OURS, body: { attention_id: KEY }, db });

    expect(result.status).toBe(200);
    expect(result.response).toEqual({ dismissed: 1, keys: [KEY] });
    expect(db.tables.attention_items[0].state).toBe("acknowledged");
    expect(db.tables.attention_items[1].state).toBe("active");
    // Another family's item with the same key is left alone.
    expect(db.tables.attention_items[2].state).toBe("active");
  });

  test("an attention_id that is a row id dismisses that row", async () => {
    const db = attentionDb();
    const result = await dismissAttention({ familyId: OURS, body: { attention_id: ROW_ID }, db });

    expect(result.response).toEqual({ dismissed: 1, keys: [KEY] });
    expect(db.tables.attention_items[0].state).toBe("acknowledged");
  });

  test("another family's row id dismisses nothing", async () => {
    const db = attentionDb();
    const result = await dismissAttention({ familyId: OURS, body: { attention_id: FOREIGN_ROW_ID }, db });

    expect(result.response).toEqual({ dismissed: 0, keys: [] });
    expect(db.writes).toEqual([]);
  });

  test("text that merely mentions an id cannot reach the id filter", async () => {
    // A non-uuid attention_id is matched as a key only, so free text cannot
    // smuggle extra conditions into PostgREST's or() syntax.
    const db = attentionDb();
    const result = await dismissAttention({
      familyId: OURS,
      body: { attention_id: `x,id.eq.${ROW_ID}` },
      db,
    });
    expect(result.response).toEqual({ dismissed: 0, keys: [] });
  });

  test("the older `key` and `rule_id` still work", async () => {
    const byKey = attentionDb();
    expect((await dismissAttention({ familyId: OURS, body: { key: KEY }, db: byKey })).response)
      .toEqual({ dismissed: 1, keys: [KEY] });

    const byRule = attentionDb();
    expect((await dismissAttention({ familyId: OURS, body: { rule_id: "bins-out" }, db: byRule })).response)
      .toEqual({ dismissed: 1, keys: ["bins-out:2026-10-02"] });
  });

  test("attention_id wins over key and rule_id", async () => {
    const db = attentionDb();
    const result = await dismissAttention({
      familyId: OURS,
      body: { attention_id: KEY, key: "bins-out:2026-10-02", rule_id: "bins-out" },
      db,
    });
    expect(result.response).toEqual({ dismissed: 1, keys: [KEY] });
    expect(db.tables.attention_items[1].state).toBe("active");
  });

  test("nothing to go on names the RFC field first", async () => {
    const result = await dismissAttention({ familyId: OURS, body: {}, db: attentionDb() });
    expect(result.status).toBe(400);
    expect(String(result.response.error)).toMatch(/^`attention_id`/);
  });
});
