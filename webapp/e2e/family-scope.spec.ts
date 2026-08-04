import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { familyIdFrom, rowInFamily, accountInFamily } from "../src/lib/family-scope";

/**
 * RLS is off. The Security & Threat Model page says so and names the
 * consequence: "every API route filters by `family_id` ... There is no
 * database-level backstop if a route ever forgot to filter."
 *
 * A route that takes an id from the path, uses the service-role client, and
 * matches on that id alone will happily read, edit or delete another
 * family's row. These cover both halves: the helper's behaviour, and a scan
 * that no dynamic route is missing the filter.
 */

// --- a stand-in for the supabase client, recording what it was asked ---
function fakeClient(rows: Record<string, Array<Record<string, unknown>>>) {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const api = {
    calls,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      calls.push({ table, filters });
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        maybeSingle: async () => {
          const match = (rows[table] ?? []).find((row) =>
            Object.entries(filters).every(([k, v]) => row[k] === v),
          );
          return { data: match ?? null };
        },
      };
      return chain;
    },
  };
  return api;
}

const OURS = "family-a";
const THEIRS = "family-b";

const DATA = {
  tickers: [
    { id: "t-ours", family_id: OURS },
    { id: "t-theirs", family_id: THEIRS },
  ],
  vehicles: [
    { id: "v-ours", family_id: OURS },
    { id: "v-theirs", family_id: THEIRS },
  ],
  pocket_money_accounts: [
    { id: "acct-ours", family_id: OURS },
    { id: "acct-theirs", family_id: THEIRS },
  ],
  pocket_money_goals: [
    { id: "g-ours", account_id: "acct-ours" },
    { id: "g-theirs", account_id: "acct-theirs" },
  ],
};

test.describe("rowInFamily", () => {
  test("accepts our row and rejects another family's", async () => {
    const db = fakeClient(DATA);
    expect(await rowInFamily(db, "tickers", "t-ours", OURS)).toBe(true);
    expect(await rowInFamily(db, "tickers", "t-theirs", OURS)).toBe(false);
    expect(await rowInFamily(db, "vehicles", "v-ours", OURS)).toBe(true);
    expect(await rowInFamily(db, "vehicles", "v-theirs", OURS)).toBe(false);
  });

  test("a missing row is indistinguishable from a foreign one", async () => {
    // Both are false, so callers return the same 404 and ids can't be
    // enumerated by watching the status code.
    const db = fakeClient(DATA);
    expect(await rowInFamily(db, "tickers", "does-not-exist", OURS)).toBe(false);
    expect(await rowInFamily(db, "tickers", "t-theirs", OURS)).toBe(false);
  });

  test("it actually filters on family_id, not just on id", async () => {
    const db = fakeClient(DATA);
    await rowInFamily(db, "vehicles", "v-ours", OURS);
    const call = db.calls.find((c) => c.table === "vehicles");
    expect(call?.filters).toMatchObject({ id: "v-ours", family_id: OURS });
  });

  test("rows that reach a family through their account are checked one hop out", async () => {
    const db = fakeClient(DATA);
    expect(await rowInFamily(db, "pocket_money_goals", "g-ours", OURS)).toBe(true);
    expect(await rowInFamily(db, "pocket_money_goals", "g-theirs", OURS)).toBe(false);
  });

  test("empty ids are rejected rather than matching everything", async () => {
    const db = fakeClient(DATA);
    expect(await rowInFamily(db, "tickers", "", OURS)).toBe(false);
    expect(await rowInFamily(db, "tickers", "t-ours", "")).toBe(false);
    expect(await accountInFamily(db, "", OURS)).toBe(false);
  });
});

test.describe("familyIdFrom", () => {
  const request = (url: string, body?: unknown) =>
    ({ nextUrl: new URL(url), ...(body ? {} : {}) }) as never;

  test("reads the query string for reads and the body for writes", () => {
    expect(familyIdFrom(request("https://x/api/tickers/1?family_id=abc"))).toBe("abc");
    expect(familyIdFrom(request("https://x/api/tickers/1"), { family_id: "abc" })).toBe("abc");
  });

  test("returns null when absent or empty, so callers 400 instead of matching all", () => {
    expect(familyIdFrom(request("https://x/api/tickers/1"))).toBeNull();
    expect(familyIdFrom(request("https://x/api/tickers/1?family_id="))).toBeNull();
    expect(familyIdFrom(request("https://x/api/tickers/1"), { family_id: "" })).toBeNull();
    expect(familyIdFrom(request("https://x/api/tickers/1"), { family_id: 42 })).toBeNull();
    expect(familyIdFrom(request("https://x/api/tickers/1"), null)).toBeNull();
  });
});

test("no dynamic API route uses the admin client without a family filter", () => {
  const root = join(__dirname, "..", "src", "app", "api");
  const routes: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts" && full.includes("[")) routes.push(full);
    }
  };
  walk(root);

  // If this ever finds nothing, the walk is broken, not the codebase.
  expect(routes.length).toBeGreaterThan(5);

  const unscoped = routes.filter((file) => {
    const source = readFileSync(file, "utf8");
    if (!source.includes("createAdminClient")) return false;
    return !/family_id|familyIdFrom|rowInFamily|accountInFamily/.test(source);
  });

  expect(unscoped.map((f) => f.slice(root.length + 1))).toEqual([]);
});
