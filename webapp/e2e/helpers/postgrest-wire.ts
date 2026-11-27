/**
 * What the database clients put on the wire, for a representative set of
 * calls (RFC-024 §4.6, phase 7 step 2).
 *
 * `e2e/postgrest-client-wire.spec.ts` runs these calls through today's
 * factories and compares every request (method, URL, every header, body) and
 * every result the call site sees with `e2e/fixtures/postgrest-wire.golden.json`,
 * which was recorded by running the *same* calls through the factories as they
 * were on supabase-js 2.105.3 and @supabase/ssr 0.5.2 (the commit before the
 * swap). The recording is in the fixture's `recordedWith`.
 *
 * Kept free of any import from src/ so the recorder and the spec share it
 * unchanged across both trees.
 */

export interface WireRequest {
  /** How the request was handed to fetch: a URL string, a URL, or a Request. */
  input: "string" | "URL" | "Request";
  method: string;
  url: string;
  /** Every header, lower-cased, sorted. */
  headers: Array<[string, string]>;
  body: string | null;
}

export interface WireResult {
  data: unknown;
  count: number | null | undefined;
  status: number | undefined;
  statusText: string | undefined;
  error: { name?: string; message?: string; details?: unknown; hint?: unknown; code?: unknown } | null;
  /** Set when the call threw (throwOnError) instead of returning. */
  threw?: { name: string; message: string };
}

export interface WireRecord {
  shape: string;
  scenario: string;
  requests: WireRequest[];
  result: WireResult;
}

interface StubResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Scenario {
  name: string;
  /** What the stub answers to the database request. */
  response?: StubResponse;
  /** Answers for successive database requests, in order; the last one repeats. Wins over `response`. */
  responses?: StubResponse[];
  /** What the family-token endpoint answers (default: no session). */
  token?: { token: string; expiresAt: number };
  run: (db: any) => PromiseLike<any>;
}

const ROWS = [
  { id: "1", title: "Milch" },
  { id: "2", title: "Brot" },
];

export const SCENARIOS: Scenario[] = [
  {
    name: "select with filters, order and range",
    response: { body: ROWS, headers: { "content-range": "0-1/*" } },
    run: (db) =>
      db
        .from("todos")
        .select("id, title, assignee:people(name)")
        .eq("family_id", "fam-1")
        .neq("status", "done")
        .in("person_id", ["p1", "p2"])
        .gte("due", "2026-11-01")
        .lt("due", "2026-12-01")
        .ilike("title", "%milch%")
        .is("deleted_at", null)
        .or("priority.eq.high,pinned.is.true")
        .not("category", "is", null)
        .contains("tags", ["kitchen"])
        .order("due", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(0, 9),
  },
  {
    name: "select with an exact count and head",
    response: { status: 200, body: null, headers: { "content-range": "*/42" } },
    run: (db) => db.from("families").select("id", { count: "exact", head: true }).eq("id", "fam-1"),
  },
  {
    name: "select with a planned count and limit",
    response: { status: 206, body: ROWS, headers: { "content-range": "0-1/120" } },
    run: (db) => db.from("events").select("*", { count: "planned" }).eq("family_id", "fam-1").limit(2),
  },
  {
    name: "single",
    response: { body: ROWS[0] },
    run: (db) => db.from("todos").select("id, title").eq("id", "1").single(),
  },
  {
    name: "single, no row (406)",
    response: {
      status: 406,
      body: {
        code: "PGRST116",
        details: "The result contains 0 rows",
        hint: null,
        message: "Cannot coerce the result to a single JSON object",
      },
    },
    run: (db) => db.from("todos").select("id").eq("id", "missing").single(),
  },
  {
    name: "maybeSingle",
    response: { body: [ROWS[1]] },
    run: (db) => db.from("todos").select("id, title").eq("id", "2").maybeSingle(),
  },
  {
    name: "maybeSingle, no row",
    response: { body: [] },
    run: (db) => db.from("todos").select("id").eq("id", "missing").maybeSingle(),
  },
  {
    name: "insert one, returning it",
    response: { status: 201, body: ROWS[0] },
    run: (db) => db.from("todos").insert({ family_id: "fam-1", title: "Milch", due: null }).select("id, title").single(),
  },
  {
    name: "insert many, minimal",
    response: { status: 201, body: null },
    run: (db) =>
      db.from("shopping_items").insert([
        { family_id: "fam-1", name: "Brot" },
        { family_id: "fam-1", name: "Käse", quantity: 2 },
      ]),
  },
  {
    name: "upsert on a conflict column",
    response: { status: 201, body: [ROWS[0]] },
    run: (db) => db.from("settings").upsert({ family_id: "fam-1", key: "theme", value: "dark" }, { onConflict: "family_id,key" }).select(),
  },
  {
    name: "upsert ignoring duplicates, with a count",
    response: { status: 201, body: null, headers: { "content-range": "*/1" } },
    run: (db) =>
      db
        .from("devices")
        .upsert([{ id: "d1", name: "Küche" }], { onConflict: "id", ignoreDuplicates: true, count: "exact" }),
  },
  {
    name: "update with filters, returning rows",
    response: { body: [ROWS[0]] },
    run: (db) => db.from("todos").update({ title: "Milch", done_at: null }).eq("id", "1").eq("family_id", "fam-1").select("id"),
  },
  {
    name: "update with match",
    response: { status: 204, body: null },
    run: (db) => db.from("todos").update({ status: "done" }).match({ family_id: "fam-1", id: "1" }),
  },
  {
    name: "delete with filters",
    response: { status: 204, body: null },
    run: (db) => db.from("todos").delete().eq("family_id", "fam-1").in("id", ["1", "2"]),
  },
  {
    name: "delete with an exact count",
    response: { status: 204, body: null, headers: { "content-range": "*/2" } },
    run: (db) => db.from("todos").delete({ count: "exact" }).eq("family_id", "fam-1"),
  },
  {
    name: "a PostgREST error comes back as { error }",
    response: {
      status: 400,
      body: { code: "42703", details: null, hint: null, message: 'column todos.nope does not exist' },
    },
    run: (db) => db.from("todos").select("nope").eq("id", "1"),
  },
  {
    name: "throwOnError throws the PostgREST error",
    response: { status: 409, body: { code: "23505", details: "Key exists", hint: null, message: "duplicate key value" } },
    run: (db) => db.from("todos").insert({ id: "1" }).throwOnError(),
  },
  {
    name: "rpc POST with arguments",
    response: { body: 7 },
    run: (db) => db.rpc("award_points", { p_person_id: "p1", p_points: 5, p_reason: "Zähne geputzt" }),
  },
  {
    name: "rpc POST without arguments",
    response: { body: JSON.stringify("fam-1") }, // a string body is sent as is
    run: (db) => db.rpc("current_family_id"),
  },
  {
    name: "rpc GET",
    response: { body: [{ day: "2026-11-27" }] },
    run: (db) => db.rpc("family_days", { p_from: "2026-11-01", p_to: "2026-11-30" }, { get: true }),
  },
  {
    name: "rpc with a count and head",
    response: { status: 200, body: null, headers: { "content-range": "*/3" } },
    run: (db) => db.rpc("open_todos", { p_family: "fam-1" }, { head: true, count: "exact" }),
  },
  {
    name: "rpc with filters on its result, single",
    response: { body: { id: "1" } },
    run: (db) => db.rpc("search_todos", { q: "milch" }).eq("id", "1").single(),
  },
  {
    name: "a call site's own header",
    response: { body: ROWS },
    run: (db) => db.from("todos").select("id").eq("id", "1").setHeader("x-kinboard-test", "1"),
  },
  {
    name: "a call site's own Authorization wins",
    response: { body: ROWS },
    run: (db) => db.from("todos").select("id").eq("id", "1").setHeader("Authorization", "Bearer call-site"),
  },
  {
    name: "401, then a fresh family token and one retry",
    responses: [
      { status: 401, body: { code: "PGRST301", details: null, hint: null, message: "JWT expired" } },
      { body: ROWS },
    ],
    token: { token: "family-token-2", expiresAt: 4_102_444_800 },
    run: (db) => db.from("todos").select("id, title").eq("family_id", "fam-1"),
  },
  {
    name: "401 on a write, then a fresh family token and one retry",
    responses: [
      { status: 401, body: { code: "PGRST301", details: null, hint: null, message: "JWT expired" } },
      { status: 204, body: null },
    ],
    token: { token: "family-token-2", expiresAt: 4_102_444_800 },
    run: (db) => db.from("todos").update({ status: "done" }).eq("id", "1"),
  },
  {
    name: "another schema",
    response: { body: ROWS },
    run: (db) => db.schema("kinboard").from("schema_migrations").select("version").limit(2),
  },
  {
    name: "csv",
    response: { body: "id\n1" },
    run: (db) => db.from("todos").select("id").eq("id", "1").csv(),
  },
];

const consoleMethods = ["log", "warn", "error", "info", "debug"] as const;

function describeInput(input: RequestInfo | URL): WireRequest["input"] {
  if (typeof input === "string") return "string";
  if (input instanceof URL) return "URL";
  return "Request";
}

function sortedHeaders(h: Headers): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  h.forEach((value, name) => out.push([name.toLowerCase(), value]));
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
}

function serialiseError(e: any): WireResult["error"] {
  if (!e) return null;
  return { name: e.name, message: e.message, details: e.details, hint: e.hint, code: e.code };
}

/**
 * Run every scenario through every client shape, with `globalThis.fetch`
 * replaced by a stub that records each request and answers with the
 * scenario's response. The family-token endpoint answers "no session".
 *
 * `shapes[i].make()` builds the client; it runs before each scenario, after
 * `beforeEach`, so a shape may prime a family token or set env.
 */
export async function recordWire(
  shapes: Array<{ name: string; make: () => any }>,
  beforeEach: () => void,
): Promise<WireRecord[]> {
  const records: WireRecord[] = [];
  const realFetch = globalThis.fetch;
  const saved = consoleMethods.map((m) => console[m]);
  let current: Scenario | null = null;
  let requests: WireRequest[] = [];
  let dbRequests = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const body = init?.body == null ? null : String(init.body);
    requests.push({ input: describeInput(input), method, url, headers: sortedHeaders(headers), body });
    if (url.endsWith("/api/session/token")) return Response.json(current?.token ?? { token: null, expiresAt: null });
    const seq = current?.responses;
    const r = (seq ? seq[Math.min(dbRequests++, seq.length - 1)] : current?.response) ?? {};
    const status = r.status ?? 200;
    const text = r.body === null || r.body === undefined ? null : typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(status === 204 ? null : text, {
      status,
      statusText: status === 200 ? "OK" : status === 201 ? "Created" : status === 204 ? "No Content" : "Error",
      headers: { "content-type": "application/json; charset=utf-8", ...(r.headers ?? {}) },
    });
  }) as typeof fetch;
  // The guard and the token module log; the comparison is about the wire.
  for (const m of consoleMethods) console[m] = () => {};

  try {
    for (const shape of shapes) {
      for (const scenario of SCENARIOS) {
        beforeEach();
        const db = shape.make();
        current = scenario;
        requests = [];
        dbRequests = 0;
        let result: WireResult;
        try {
          const r = await scenario.run(db);
          result = { data: r.data, count: r.count, status: r.status, statusText: r.statusText, error: serialiseError(r.error) };
        } catch (e: any) {
          result = { data: null, count: undefined, status: undefined, statusText: undefined, error: null, threw: { name: e?.name, message: e?.message } };
        }
        records.push({ shape: shape.name, scenario: scenario.name, requests, result: JSON.parse(JSON.stringify(result)) });
      }
    }
  } finally {
    globalThis.fetch = realFetch;
    consoleMethods.forEach((m, i) => (console[m] = saved[i]));
  }
  return records;
}

/** The client shapes the app builds, by name; the spec and the recorder build each the same way. */
export const SHAPES = [
  "browser, no family session",
  "browser, family token",
  "server, service role (POSTGREST_URL)",
  "server, service role as integration",
  "server, service role (legacy Kong SUPABASE_URL)",
  "server, service role (legacy Kong, a base with a path and a trailing slash)",
] as const;

export const WIRE_ENV = {
  POSTGREST_URL: "http://rest.test:3000",
  KONG_URL: "http://kong.test:8000",
  KONG_URL_WITH_PATH: " http://kong.test:8000/kinboard/ ",
  SERVICE_ROLE_KEY: "service-role-key",
  ANON_KEY: "anon-key",
  FAMILY_TOKEN: "family-token",
};

interface Factories {
  createClient: () => any;
  createAdminClient: (options?: { actor?: "integration" }) => any;
  primeFamilyToken: (token: string, expiresAt: number) => void;
}

/** Build every shape from the tree's own factories, setting the env each one reads. */
export function buildShapes(f: Factories): Array<{ name: (typeof SHAPES)[number]; make: () => any }> {
  const serverEnv = (legacyKong: string | false = false) => {
    if (legacyKong) {
      delete process.env.POSTGREST_URL;
      process.env.SUPABASE_URL = legacyKong;
    } else {
      process.env.POSTGREST_URL = WIRE_ENV.POSTGREST_URL;
      delete process.env.SUPABASE_URL;
    }
    // The older name, which the tree the golden file was recorded on reads
    // too; the current name is cleared so a runner's real key can't win
    // over it (RFC-024 §4.6: KINBOARD_SERVICE_ROLE_KEY comes first).
    process.env.SUPABASE_SERVICE_ROLE_KEY = WIRE_ENV.SERVICE_ROLE_KEY;
    delete process.env.KINBOARD_SERVICE_ROLE_KEY;
  };
  return [
    {
      name: "browser, no family session",
      make: () => {
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = WIRE_ENV.ANON_KEY;
        return f.createClient();
      },
    },
    {
      name: "browser, family token",
      make: () => {
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = WIRE_ENV.ANON_KEY;
        f.primeFamilyToken(WIRE_ENV.FAMILY_TOKEN, 4_102_444_800); // 2100-01-01
        return f.createClient();
      },
    },
    { name: "server, service role (POSTGREST_URL)", make: () => (serverEnv(), f.createAdminClient()) },
    { name: "server, service role as integration", make: () => (serverEnv(), f.createAdminClient({ actor: "integration" })) },
    { name: "server, service role (legacy Kong SUPABASE_URL)", make: () => (serverEnv(WIRE_ENV.KONG_URL), f.createAdminClient()) },
    {
      name: "server, service role (legacy Kong, a base with a path and a trailing slash)",
      make: () => (serverEnv(WIRE_ENV.KONG_URL_WITH_PATH), f.createAdminClient()),
    },
  ];
}
