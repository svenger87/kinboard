import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createClient } from "../src/lib/supabase/client";
import { createAdminClient } from "../src/lib/supabase/server";
import { clearFamilyToken, primeFamilyToken } from "../src/lib/supabase/family-token";
import { SCENARIOS, SHAPES, buildShapes, recordWire, type WireRecord } from "./helpers/postgrest-wire";

/**
 * RFC-024 §4.6, phase 7 step 2: `@supabase/postgrest-js` replaced supabase-js
 * and @supabase/ssr, and nothing on the wire changed.
 *
 * `e2e/fixtures/postgrest-wire.golden.json` is what the factories sent and
 * returned on supabase-js 2.105.3 / @supabase/ssr 0.5.2, for 28 calls (select
 * with every filter kind, order, range, counts, single/maybeSingle, insert,
 * upsert, update, delete, errors, throwOnError, rpc POST/GET/head, a call
 * site's own headers, the browser's 401 → fresh token → one retry, another
 * schema, csv) through each of the six client shapes the app
 * builds. This runs the same calls through today's factories and compares
 * every request — how it was handed to fetch, method, URL, every header, body
 * — and every result the call site sees.
 *
 * The one deliberate difference is `X-Client-Info`, which named the library
 * (`supabase-js-node/2.105.3`, `supabase-ssr/0.5.2`); nothing reads it.
 * It is removed from the golden side only, and the tests below check that it
 * was there on every request and is now on none, so the exception can't hide
 * anything else.
 */

interface Golden {
  recordedWith: Record<string, string>;
  records: WireRecord[];
}

const golden: Golden = JSON.parse(readFileSync("e2e/fixtures/postgrest-wire.golden.json", "utf8"));
const DROPPED = "x-client-info";

const isDbRequest = (url: string) => url.includes("/rest/v1/") || url.startsWith("http://rest.test:3000/");

function withoutDropped(records: WireRecord[]): WireRecord[] {
  return records.map((r) => ({
    ...r,
    requests: r.requests.map((q) => ({ ...q, headers: q.headers.filter(([name]) => name !== DROPPED) })),
  }));
}

let current: WireRecord[] = [];
const savedEnv = { ...process.env };

test.beforeAll(async () => {
  current = await recordWire(buildShapes({ createClient, createAdminClient, primeFamilyToken }), clearFamilyToken);
});

test.afterAll(() => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  clearFamilyToken();
});

test("the golden covers every shape and scenario, and was recorded from supabase-js", () => {
  expect(golden.recordedWith).toEqual({ "@supabase/supabase-js": "2.105.3", "@supabase/ssr": "0.5.2" });
  expect(golden.records).toHaveLength(SHAPES.length * SCENARIOS.length);
  expect(current).toHaveLength(golden.records.length);
  // Non-vacuity: every call reached the stub with a database request.
  for (const r of golden.records) expect(r.requests.some((q) => isDbRequest(q.url)), `${r.shape} / ${r.scenario}`).toBe(true);
});

for (const shape of SHAPES) {
  test.describe(shape, () => {
    for (const { name } of SCENARIOS) {
      test(name, () => {
        const want = withoutDropped(golden.records).find((r) => r.shape === shape && r.scenario === name);
        const got = current.find((r) => r.shape === shape && r.scenario === name);
        expect(want, "missing from the golden").toBeTruthy();
        expect(got).toEqual(want);
      });
    }
  });
}

test("X-Client-Info was on every database request before, and is on none now", () => {
  const dbRequests = (rs: WireRecord[]) => rs.flatMap((r) => r.requests.filter((q) => isDbRequest(q.url)));
  const before = dbRequests(golden.records);
  expect(before.length).toBeGreaterThanOrEqual(golden.records.length);
  for (const q of before) expect(q.headers.filter(([n]) => n === DROPPED)).toHaveLength(1);
  for (const q of dbRequests(current)) expect(q.headers.some(([n]) => n === DROPPED)).toBe(false);
  // Nothing else is dropped on the golden side: other requests (the token endpoint) never carried it.
  for (const r of golden.records) {
    for (const q of r.requests.filter((x) => !isDbRequest(x.url))) expect(q.headers.some(([n]) => n === DROPPED)).toBe(false);
  }
});

test("the headers that matter are there, by shape", () => {
  const header = (shape: string, scenario: string, name: string) =>
    current
      .find((r) => r.shape === shape && r.scenario === scenario)!
      .requests.filter((q) => isDbRequest(q.url))
      .map((q) => q.headers.find(([n]) => n === name)?.[1]);
  expect(header("browser, no family session", "single", "authorization")).toEqual(["Bearer anon-key"]);
  expect(header("browser, family token", "single", "authorization")).toEqual(["Bearer family-token"]);
  expect(header("browser, family token", "single", "apikey")).toEqual(["anon-key"]);
  expect(header("server, service role as integration", "delete with filters", "x-kinboard-actor")).toEqual(["integration"]);
  expect(header("server, service role (POSTGREST_URL)", "delete with filters", "authorization")).toEqual(["Bearer service-role-key"]);
  expect(header("server, service role (POSTGREST_URL)", "rpc GET", "accept-profile")).toEqual(["public"]);
  expect(header("server, service role (POSTGREST_URL)", "rpc POST with arguments", "content-profile")).toEqual(["public"]);
  expect(header("server, service role (POSTGREST_URL)", "upsert ignoring duplicates, with a count", "prefer")).toEqual([
    "resolution=ignore-duplicates, count=exact",
  ]);
  expect(header("browser, no family session", "a call site's own Authorization wins", "authorization")).toEqual(["Bearer call-site"]);
  // The browser's one retry with a freshly minted token; the server clients don't retry.
  expect(header("browser, family token", "401, then a fresh family token and one retry", "authorization")).toEqual([
    "Bearer family-token",
    "Bearer family-token-2",
  ]);
  expect(header("server, service role (POSTGREST_URL)", "401, then a fresh family token and one retry", "authorization")).toEqual([
    "Bearer service-role-key",
  ]);
  const kongPath = current.find((r) => r.shape.includes("a base with a path") && r.scenario === "single")!;
  expect(kongPath.requests[0].url).toBe("http://kong.test:8000/kinboard/rest/v1/todos?select=id%2Ctitle&id=eq.1");
});

test("the browser keeps one client per page, as @supabase/ssr did", () => {
  const g = globalThis as { window?: unknown };
  const had = "window" in g;
  g.window = { location: { origin: "http://kinboard.test" }, document: {} };
  try {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    const a = createClient();
    expect(createClient()).toBe(a);
  } finally {
    if (!had) delete g.window;
  }
  // No window (a server render of a client component): a fresh one each time.
  expect(createClient()).not.toBe(createClient());
});
