import { test, expect } from "@playwright/test";
import { hasServiceKey } from "./helpers/service-key";
import { NO_KEY, createPostgrestClient, type DbClient } from "../src/lib/supabase/postgrest";
import { createAdminClient } from "../src/lib/supabase/server";
import { mintFamilyToken } from "../src/lib/family-jwt";
import { VISIBLE_CALENDARS } from "../src/lib/google-calendar-reconcile";

/**
 * The browser's queries that the hand-written database types had drifted
 * from (RFC-024 §4.6 step 4; the 12 errors #561 found when it typed the
 * browser client strictly): `attention_items` and `context_rules` were
 * missing from src/types/database.ts, and `events → calendars` had no
 * relationship. They are typed from the generated schema now; this runs them,
 * exactly as src/hooks/use-attention.ts and use-supabase-queries.ts send them,
 * through a browser-shaped client — no key, a family token — that is typed
 * strictly (no `any`), against a real PostgREST.
 *
 * Needs a stack: KINBOARD_SERVICE_ROLE_KEY, SUPABASE_URL (or
 * NEXT_PUBLIC_SUPABASE_URL) and JWT_SECRET. Works only in a family of its
 * own, `claude-db-types`, which it creates and deletes again, including
 * whatever an interrupted run left behind.
 */

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
test.skip(!(hasServiceKey() && URL) && !process.env.FAMILY_CODE, "needs KINBOARD_SERVICE_ROLE_KEY and SUPABASE_URL for a running stack");
test.describe.configure({ mode: "serial" });

const FAMILY = "c1a0de00-0024-4000-8000-0000000d0001";
const CALENDAR = "c1a0de00-0024-4000-8000-0000000d0c01";
const EVENT = "c1a0de00-0024-4000-8000-0000000d0e01";
const RULE = "claude-db-types-rule";

let admin: DbClient;
let browser: DbClient;

async function purge() {
  const { error } = await admin.from("families").delete().eq("id", FAMILY);
  if (error) throw error;
}

test.beforeAll(async () => {
  admin = createAdminClient();
  // No key, as the browser sends none (RFC-024 §4.6 step 3); the family token is its credential.
  browser = createPostgrestClient(URL!, NO_KEY, {
    headers: { Authorization: `Bearer ${mintFamilyToken(FAMILY).token}` },
  });
  await purge();
  const steps = [
    () => admin.from("families").insert({ id: FAMILY, name: "claude-db-types", join_code: "CLAUDEDBTY" }),
    () => admin.from("calendars").insert({ id: CALENDAR, family_id: FAMILY, name: "claude-db-types", color: "#123456" }),
    () => admin.from("events").insert({
      id: EVENT, calendar_id: CALENDAR, title: "claude-db-types",
      start_at: "2026-11-27T10:00:00Z", end_at: "2026-11-27T11:00:00Z",
    }),
    () => admin.from("attention_items").insert({
      family_id: FAMILY, rule_id: RULE, item_key: "claude-db-types", title: "claude-db-types", priority: 1,
    }),
  ];
  for (const step of steps) {
    const { error } = await step();
    if (error) throw error;
  }
});

test.afterAll(async () => {
  await purge();
  const { data } = await admin.from("families").select("id").eq("id", FAMILY);
  expect(data).toEqual([]);
});

test("attention_items: useAttentionItems' read, then the acknowledge write", async () => {
  const { data, error } = await browser
    .from("attention_items")
    .select("*")
    .eq("family_id", FAMILY)
    .is("resolved_at", null)
    .order("priority", { ascending: true })
    .order("first_seen_at", { ascending: true });
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  // Typed from the CHECK constraint: "active" | "acknowledged" | "snoozed" | "dismissed".
  const state: "active" | "acknowledged" | "snoozed" | "dismissed" = data![0].state;
  expect(state).toBe("active");

  const { error: ackError } = await browser
    .from("attention_items")
    .update({ state: "acknowledged", acted_at: new Date().toISOString() })
    .eq("id", data![0].id);
  expect(ackError).toBeNull();
  const { data: after } = await admin.from("attention_items").select("state, acted_at").eq("id", data![0].id).single();
  expect(after?.state).toBe("acknowledged");
  expect(after?.acted_at).not.toBeNull();
});

test("context_rules: useSetRuleEnabled's upsert, twice on one key, then useContextRules' read", async () => {
  for (const enabled of [false, true]) {
    const { error } = await browser
      .from("context_rules")
      .upsert(
        { family_id: FAMILY, rule_id: RULE, enabled, updated_at: new Date().toISOString() },
        { onConflict: "family_id,rule_id" },
      );
    expect(error).toBeNull();
  }
  const { data, error } = await browser.from("context_rules").select("*").eq("family_id", FAMILY);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(data![0]).toMatchObject({ rule_id: RULE, enabled: true });
});

test("events → calendars: useEvents' embed, filtered through the relationship", async () => {
  const { data, error } = await browser
    .from("events")
    .select(`
      *,
      calendar:calendars!inner(family_id, person_id, color, name, is_holidays, is_waste_collection)
    `)
    .eq("calendar.family_id", FAMILY)
    .or(VISIBLE_CALENDARS, { referencedTable: "calendar" });
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  // An object, not an array: events.calendar_id is a many-to-one.
  const calendar: { family_id: string; color: string; name: string } = data![0].calendar;
  expect(calendar).toMatchObject({ family_id: FAMILY, color: "#123456", name: "claude-db-types" });
  expect(data![0].id).toBe(EVENT);
});
