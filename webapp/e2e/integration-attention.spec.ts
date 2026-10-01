import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { familyLanguage, listAttentionItems, sayAttention } from "../src/lib/integration-attention";
import { codeOnly } from "./source-helpers";

/**
 * RFC-012 task 11 / §5: GET /attention lists the open hints with the
 * item_key `dismiss_attention` takes, titled in the family's language. The
 * fake client applies the filters it is given, so a missing family, state
 * or resolved filter really does let the wrong row through.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";

type Row = Record<string, unknown>;
type Filter = [column: string, value: unknown];

const item = (over: Row): Row => ({
  family_id: OURS, rule_id: "r", title: "English", detail: null, message_key: null, params: {},
  priority: 100, first_seen_at: "2026-10-01T06:00:00Z", state: "active", resolved_at: null, ...over,
});

/** `locale` null: the family has no locale setting. */
function fakeDb(locale: unknown = "de") {
  const tables: Record<string, Row[]> = {
    settings: [
      ...(locale === null ? [] : [{ family_id: OURS, key: "locale", value: locale }]),
      { family_id: THEIRS, key: "locale", value: "fr" },
    ],
    attention_items: [
      item({ item_key: "take-an-umbrella:2026-10-01", rule_id: "take-an-umbrella", title: "Rain likely today", detail: "70% chance, and somebody is out.", message_key: "take-an-umbrella", params: { chance: 70 }, priority: 20 }),
      item({ item_key: "birthday-today:b1", rule_id: "birthday-today", title: "Oma has a birthday today", message_key: "birthday-today", params: { name: "Oma" }, priority: 10 }),
      item({ item_key: "old-row", title: "Raised before translations", priority: 50 }),
      item({ item_key: "unknown-key", title: "Stored English", message_key: "no-such-hint", priority: 60 }),
      item({ item_key: "acknowledged", state: "acknowledged" }),
      item({ item_key: "snoozed", state: "snoozed" }),
      item({ item_key: "resolved", resolved_at: "2026-10-01T07:00:00Z" }),
      item({ item_key: "foreign", family_id: THEIRS, title: "Foreign" }),
    ],
  };
  const matches = (filters: Filter[]) => (row: Row) => filters.every(([c, v]) => (row[c] ?? null) === v);
  const db = {
    from(table: string) {
      const filters: Filter[] = [];
      const orders: [string, boolean][] = [];
      const run = () => {
        const hit = (tables[table] ?? []).filter(matches(filters));
        return [...hit].sort((a, b) => {
          for (const [c, asc] of orders) {
            const d = a[c] === b[c] ? 0 : (a[c] as never) < (b[c] as never) ? -1 : 1;
            if (d) return asc ? d : -d;
          }
          return 0;
        });
      };
      const chain = {
        select() { return chain; },
        eq(column: string, value: unknown) { filters.push([column, value]); return chain; },
        is(column: string, value: unknown) { filters.push([column, value]); return chain; },
        order(column: string, o: { ascending: boolean }) { orders.push([column, o.ascending]); return chain; },
        async maybeSingle() { return { data: run()[0] ?? null, error: null }; },
        then(resolve: (v: unknown) => void) { resolve({ data: run(), error: null }); },
      };
      return chain;
    },
  };
  return db as never;
}

test.describe("GET /attention", () => {
  test("the family's open hints, most important first, in the family's language", async () => {
    const result = await listAttentionItems(OURS, fakeDb("de"));
    expect(result.locale).toBe("de");
    expect(result.items).toEqual([
      { item_key: "birthday-today:b1", rule_id: "birthday-today", title: "Oma hat heute Geburtstag", detail: null, priority: 10, first_seen_at: "2026-10-01T06:00:00Z" },
      { item_key: "take-an-umbrella:2026-10-01", rule_id: "take-an-umbrella", title: "Heute wahrscheinlich Regen", detail: "70% Regenwahrscheinlichkeit, und jemand ist unterwegs.", priority: 20, first_seen_at: "2026-10-01T06:00:00Z" },
      { item_key: "old-row", rule_id: "r", title: "Raised before translations", detail: null, priority: 50, first_seen_at: "2026-10-01T06:00:00Z" },
      { item_key: "unknown-key", rule_id: "r", title: "Stored English", detail: null, priority: 60, first_seen_at: "2026-10-01T06:00:00Z" },
    ]);
  });

  test("acknowledged, snoozed, resolved and other families' hints are not listed", async () => {
    const keys = (await listAttentionItems(OURS, fakeDb())).items.map((i) => i.item_key);
    for (const never of ["acknowledged", "snoozed", "resolved", "foreign"]) expect(keys).not.toContain(never);
  });

  test("English when the family has no locale or an unknown one", async () => {
    expect(await familyLanguage(OURS, fakeDb(null))).toBe("en");
    expect(await familyLanguage(OURS, fakeDb("xx"))).toBe("en");
    expect(await familyLanguage(THEIRS, fakeDb("de"))).toBe("fr");
    const en = await listAttentionItems(OURS, fakeDb(null));
    expect(en.items[0].title).toBe("Oma has a birthday today");
  });

  test("a translation that cannot be formatted falls back to the stored English", () => {
    const row = { item_key: "k", rule_id: "r", title: "Stored", detail: "Stored detail", message_key: "birthday-soon", params: {}, priority: 1, first_seen_at: "" };
    const said = sayAttention(row, "fr");
    expect(said.title).toBe("Stored");
  });
});

test.describe("routes and tools", () => {
  test("GET /attention is family:read and takes the family from the token", () => {
    const src = codeOnly(readFileSync(join(__dirname, "../src/app/api/integration/v1/attention/route.ts"), "utf8"));
    expect(src).toContain('withIntegrationAuth(request, "family:read"');
    expect(src).toContain("listAttentionItems(context.familyId)");
    expect(src).not.toContain("createAdminClient");
  });
});
