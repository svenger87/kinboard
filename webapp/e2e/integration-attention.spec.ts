import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { familyLanguage, listAttentionItems, presentAttention, sayAttention } from "../src/lib/integration-attention";
import { codeOnly } from "./source-helpers";
import { RULES, RULES_BY_ID } from "../src/lib/attention/rules";

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
      item({ item_key: "old-row", rule_id: "overdue-tasks", title: "Raised before translations", priority: 50 }),
      item({ item_key: "unknown-key", rule_id: "nothing-planned-for-dinner", title: "Stored English", message_key: "no-such-hint", priority: 60 }),
      item({
        item_key: "lock-up-before-bed:2026-10-01", rule_id: "lock-up-before-bed", priority: 70,
        title: "2 still open", detail: "binary_sensor.terrassentur, cover.garage", message_key: "lock-up-before-bed",
        params: { count: 2, entities: "binary_sensor.terrassentur, cover.garage" },
        evidence: { entities: ["binary_sensor.terrassentur", "cover.garage"] },
      }),
      item({ item_key: "gone-rule:1", rule_id: "a-rule-this-build-does-not-know", priority: 80, title: "lock.front_door is open", detail: "lock.front_door" }),
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
    const result = await listAttentionItems(OURS, true, fakeDb("de"));
    expect(result.locale).toBe("de");
    expect(result.items).toEqual([
      { item_key: "birthday-today:b1", rule_id: "birthday-today", title: "Oma hat heute Geburtstag", detail: null, priority: 10, first_seen_at: "2026-10-01T06:00:00Z" },
      { item_key: "take-an-umbrella:2026-10-01", rule_id: "take-an-umbrella", title: "Heute wahrscheinlich Regen", detail: "70% Regenwahrscheinlichkeit, und jemand ist unterwegs.", priority: 20, first_seen_at: "2026-10-01T06:00:00Z" },
      { item_key: "old-row", rule_id: "overdue-tasks", title: "Raised before translations", detail: null, priority: 50, first_seen_at: "2026-10-01T06:00:00Z" },
      { item_key: "unknown-key", rule_id: "nothing-planned-for-dinner", title: "Stored English", detail: null, priority: 60, first_seen_at: "2026-10-01T06:00:00Z" },
      { item_key: "lock-up-before-bed:2026-10-01", rule_id: "lock-up-before-bed", title: "2 noch offen", detail: "binary_sensor.terrassentur, cover.garage", priority: 70, first_seen_at: "2026-10-01T06:00:00Z" },
      { item_key: "gone-rule:1", rule_id: "a-rule-this-build-does-not-know", title: "lock.front_door is open", detail: "lock.front_door", priority: 80, first_seen_at: "2026-10-01T06:00:00Z" },
    ]);
  });

  test("acknowledged, snoozed, resolved and other families' hints are not listed", async () => {
    const keys = (await listAttentionItems(OURS, false, fakeDb())).items.map((i) => i.item_key);
    for (const never of ["acknowledged", "snoozed", "resolved", "foreign"]) expect(keys).not.toContain(never);
  });

  test("English when the family has no locale or an unknown one", async () => {
    expect(await familyLanguage(OURS, fakeDb(null))).toBe("en");
    expect(await familyLanguage(OURS, fakeDb("xx"))).toBe("en");
    expect(await familyLanguage(THEIRS, fakeDb("de"))).toBe("fr");
    const en = await listAttentionItems(OURS, false, fakeDb(null));
    expect(en.items[0].title).toBe("Oma has a birthday today");
  });

  test("a translation that cannot be formatted falls back to the stored English", () => {
    const row = { item_key: "k", rule_id: "r", title: "Stored", detail: "Stored detail", message_key: "birthday-soon", params: {}, priority: 1, first_seen_at: "" };
    const said = sayAttention(row, "fr");
    expect(said.title).toBe("Stored");
  });
});

test.describe("Home Assistant hints need home:read", () => {
  const HA_TEXT = /binary_sensor\.|cover\.|lock\.|entities|terrassentur|garage|front_door/;

  for (const locale of ["en", "de", "fr", null]) {
    test(`a family:read-only token sees a count and no entity, in ${locale ?? "the default"}`, async () => {
      const result = await listAttentionItems(OURS, false, fakeDb(locale));
      expect(JSON.stringify(result)).not.toMatch(HA_TEXT);
      const lockUp = result.items.find((i) => i.rule_id === "lock-up-before-bed")!;
      expect(lockUp.detail).toBeNull();
      expect(lockUp.title).toMatch(/^2 /);
      expect(lockUp.item_key).toBe("lock-up-before-bed:2026-10-01");
      // A hint from a rule this build does not know is redacted too.
      const unknown = result.items.find((i) => i.rule_id === "a-rule-this-build-does-not-know")!;
      expect(unknown).toMatchObject({ title: "a-rule-this-build-does-not-know", detail: null });
    });
  }

  test("only the rule's numeric keepParams reach a redacted title; anything else falls back to the rule's name", () => {
    // A title whose wording would need a name: it must not be rendered with one.
    const row = {
      item_key: "k", rule_id: "lock-up-before-bed", title: "binary_sensor.door open", detail: "binary_sensor.door",
      message_key: "leave-soon", params: { what: "binary_sensor.door", count: "2" }, priority: 1, first_seen_at: "",
    };
    expect(presentAttention(row as never, "en", false)).toEqual({ title: "Lock up before bed", detail: null });
    expect(presentAttention(row as never, "en", true).title).toBe("binary_sensor.door");
  });

  test("with home:read the full detail is there", async () => {
    const result = await listAttentionItems(OURS, true, fakeDb("en"));
    const lockUp = result.items.find((i) => i.rule_id === "lock-up-before-bed")!;
    expect(lockUp).toMatchObject({ title: "2 still open", detail: "binary_sensor.terrassentur, cover.garage" });
  });

  test("hints not built from Home Assistant are the same either way", async () => {
    const full = await listAttentionItems(OURS, true, fakeDb("de"));
    const redacted = await listAttentionItems(OURS, false, fakeDb("de"));
    const plain = (r: typeof full) => r.items.filter((i) => !["lock-up-before-bed", "a-rule-this-build-does-not-know"].includes(i.rule_id));
    expect(plain(redacted)).toEqual(plain(full));
    expect(plain(full)).toHaveLength(4);
  });

  test("every rule that reads Home Assistant states is marked sensitive", () => {
    const src = readFileSync(join(__dirname, "../src/lib/attention/rules.ts"), "utf8");
    const blocks = src.split(/\nconst \w+: Rule = \{/).slice(1);
    expect(blocks.length).toBe(RULES.length);
    for (const block of blocks) {
      const id = /id: "([^"]+)"/.exec(block)![1];
      if (block.includes("signals.home")) expect(RULES_BY_ID[id].sensitive, id).toBeTruthy();
    }
    expect(RULES_BY_ID["lock-up-before-bed"].sensitive?.keepParams).toEqual(["count"]);
  });
});

test.describe("routes and tools", () => {
  test("GET /attention is family:read and takes the family from the token", () => {
    const src = codeOnly(readFileSync(join(__dirname, "../src/app/api/integration/v1/attention/route.ts"), "utf8"));
    expect(src).toContain('withIntegrationAuth(request, "family:read"');
    expect(src).toContain('listAttentionItems(context.familyId, context.scopes.includes("home:read"))');
    expect(src).not.toContain("createAdminClient");
  });
});
