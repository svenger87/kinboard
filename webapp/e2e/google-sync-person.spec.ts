import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { familyPersonIds, syncedEventPersonId } from "../src/lib/google-sync-person";
import type { PersonMappingRule } from "../src/lib/calendar-person-matcher";
import type { TaskDb } from "../src/lib/integration-tasks";
import { codeOnly } from "./source-helpers";

/**
 * Google sync reads an event's assignee from the private extended property
 * `person_id`, which anyone who can edit the Google calendar can set. It is
 * trusted only when it names one of the family's people outside the recycle
 * bin; anything else falls back exactly as an absent property does.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";
const MIA = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001";
const BINNED = "aaaaaaaa-aaaa-aaaa-aaaa-000000000002";
const DAD = "aaaaaaaa-aaaa-aaaa-aaaa-000000000003";
const OTHER_CHILD = "bbbbbbbb-bbbb-bbbb-bbbb-000000000001";

const RULES: PersonMappingRule[] = [{ id: "r1", person_id: DAD, match_type: "contains", pattern: "football", priority: 1 }];

function peopleDb() {
  const people = [
    { id: MIA, family_id: OURS, deleted_at: null },
    { id: DAD, family_id: OURS, deleted_at: null },
    { id: BINNED, family_id: OURS, deleted_at: "2026-09-30T10:00:00Z" },
    { id: OTHER_CHILD, family_id: THEIRS, deleted_at: null },
  ];
  return {
    from(table: string) {
      expect(table).toBe("people");
      const filters: Array<[string, unknown]> = [];
      const chain = {
        select: () => chain,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
        is: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
        then: <T>(resolve: (r: { data: unknown[]; error: null }) => T) =>
          Promise.resolve(resolve({
            data: people.filter((p) => filters.every(([c, v]) => ((p as Record<string, unknown>)[c] ?? null) === v)),
            error: null,
          })),
      };
      return chain;
    },
  } as unknown as TaskDb;
}

test.describe("the family's people", () => {
  test("only this family's, and not the binned", async () => {
    expect([...await familyPersonIds(peopleDb(), OURS)].sort()).toEqual([MIA, DAD].sort());
  });
});

test.describe("who a synced Google event is for", () => {
  const base = { calendarPersonId: undefined, title: "Dentist", mappingRules: [] as PersonMappingRule[] };
  const people = new Set([MIA, DAD]);

  test("the property wins when it names one of the family's people", () => {
    expect(syncedEventPersonId({ ...base, fromGoogle: MIA, familyPeople: people, calendarPersonId: DAD })).toBe(MIA);
  });

  test("another family's person, a binned one or garbage is ignored, and the calendar's person used", () => {
    for (const fromGoogle of [OTHER_CHILD, BINNED, "not-a-uuid", "", 7, null, undefined]) {
      expect(syncedEventPersonId({ ...base, fromGoogle, familyPeople: people, calendarPersonId: DAD }), String(fromGoogle)).toBe(DAD);
    }
  });

  test("with no calendar person, an ignored property falls through to the mapping rules, then to nobody", () => {
    expect(syncedEventPersonId({ ...base, fromGoogle: OTHER_CHILD, familyPeople: people, title: "Football practice", mappingRules: RULES })).toBe(DAD);
    expect(syncedEventPersonId({ ...base, fromGoogle: OTHER_CHILD, familyPeople: people })).toBeUndefined();
  });

  test("both sync routes use it, with the family's people loaded for the family being synced", () => {
    const read = (...p: string[]) => codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", ...p), "utf8"));
    for (const [file, family] of [[["google", "sync", "route.ts"], "family_id"], [["cron", "google-sync", "route.ts"], "familyId"]] as const) {
      const source = read(...file);
      expect(source, file.join("/")).toContain(`familyPersonIds(supabase, ${family})`);
      expect(source, file.join("/")).toContain("syncedEventPersonId({");
      expect(source, file.join("/")).not.toMatch(/let personId = event\.extendedProperties/);
    }
  });
});
