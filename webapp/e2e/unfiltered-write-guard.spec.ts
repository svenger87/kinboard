import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createBrowserSupabaseClient } from "../src/lib/supabase/client";
import { createAdminClient } from "../src/lib/supabase/server";
import { serverSupabaseFetch } from "../src/lib/supabase/api-base";
import { clearFamilyToken, primeFamilyToken } from "../src/lib/supabase/family-token";
import {
  ALLOW_UNFILTERED_HEADER,
  UnfilteredWriteError,
  allowUnfiltered,
  unfilteredWriteTarget,
} from "../src/lib/supabase/unfiltered-write-guard";

/**
 * RFC-024 §4.2.1: every PostgREST client the app builds refuses an UPDATE or
 * DELETE that carries no filter, before anything is sent — the app-side twin
 * of `safeupdate` in the database.
 *
 * The clients under test are the real factories (the browser's
 * `createClient`, the server's `createAdminClient`, with and without the
 * integration actor) and the server's anon client built on the same
 * `serverSupabaseFetch` the cookie-bound factory uses (that factory needs a
 * request scope for `cookies()`). The network is a stub `fetch` on
 * globalThis that records every request: a refused write must leave it
 * untouched.
 *
 * Non-vacuity: "a guard that never fires" is ruled out by the control test
 * below, which sends the same unfiltered writes through a client built
 * without the guard and asserts that the stub *was* called with exactly the
 * request the guard refuses.
 */

interface Seen {
  url: string;
  method: string;
  headers: Headers;
}

const seen: Seen[] = [];
const realFetch = globalThis.fetch;
const consoleError = console.error;
const consoleWarn = console.warn;
const logged: string[] = [];

function stubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  const headers = new Headers(init?.headers);
  if (url.endsWith("/api/session/token")) {
    return Promise.resolve(Response.json({ token: null, expiresAt: null }));
  }
  seen.push({ url, method, headers });
  return Promise.resolve(Response.json([], { status: 200 }));
}

const SERVER_ENV = { POSTGREST_URL: "http://rest.test:3000" };

test.beforeAll(() => {
  process.env.POSTGREST_URL = SERVER_ENV.POSTGREST_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

test.beforeEach(() => {
  seen.length = 0;
  logged.length = 0;
  globalThis.fetch = stubFetch as typeof fetch;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
});

test.afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = consoleError;
  console.warn = consoleWarn;
  clearFamilyToken();
});

type Client = ReturnType<typeof createAdminClient>;

/** Every client shape the app builds, as the request would leave it. */
const CLIENTS: Array<{ name: string; make: () => Client }> = [
  {
    name: "browser, anon (no family session)",
    make: () => {
      clearFamilyToken();
      return createBrowserSupabaseClient() as unknown as Client;
    },
  },
  {
    name: "browser, authenticated (family token)",
    make: () => {
      primeFamilyToken("family-token", Math.floor(Date.now() / 1000) + 3600);
      return createBrowserSupabaseClient() as unknown as Client;
    },
  },
  {
    name: "server, anon key",
    make: () =>
      createSupabaseClient("http://rest.test:3000", "anon-key", {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { fetch: serverSupabaseFetch(SERVER_ENV) },
      }) as unknown as Client,
  },
  { name: "server, service role", make: () => createAdminClient() },
  { name: "server, service role as integration", make: () => createAdminClient({ actor: "integration" }) },
];

// Loose on purpose: the generated Database types would reject a made-up row.
const table = (db: Client, name = "todos") => (db as any).from(name);

for (const { name, make } of CLIENTS) {
  test.describe(name, () => {
    test("an update or delete without a filter is refused, and nothing is sent", async () => {
      const db = make();
      const upd = await table(db).update({ title: "x" });
      const del = await table(db).delete();
      const delSelect = await table(db).delete().select("id").order("id").limit(5);

      for (const r of [upd, del, delSelect]) {
        expect(r.error?.message).toMatch(/^UnfilteredWriteError: Refused (UPDATE|DELETE) on "todos" without a filter/);
        expect(r.data).toBeNull();
      }
      expect(seen).toEqual([]);
      // The refusal is logged where it happens (the server log, for the server clients).
      expect(logged.filter((l) => l.includes('[unfiltered-write-guard] Refused'))).toHaveLength(3);
    });

    test("throwOnError() surfaces the error itself, naming the table", async () => {
      const db = make();
      const err = await table(db, "shopping_items").delete().throwOnError().then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(UnfilteredWriteError);
      expect((err as UnfilteredWriteError).table).toBe("shopping_items");
      expect((err as UnfilteredWriteError).method).toBe("DELETE");
      expect(seen).toEqual([]);
    });

    test("WHERE-equivalents count as filters: eq, neq, in, match, or, is, not, filter", async () => {
      const db = make();
      const results = await Promise.all([
        table(db).update({ title: "x" }).eq("id", "1"),
        table(db).delete().eq("id", "1"),
        table(db).update({ title: "x" }).neq("id", "1"),
        table(db).delete().in("id", ["1", "2"]),
        table(db).update({ title: "x" }).match({ family_id: "f", id: "1" }),
        table(db).delete().or("id.eq.1,id.eq.2"),
        table(db).update({ title: "x" }).is("deleted_at", null),
        table(db).delete().not("id", "is", null),
        table(db).delete().filter("id", "eq", "1"),
        table(db).update({ title: "x" }).eq("id", "1").select("id").single(),
      ]);
      for (const r of results) expect(r.error).toBeNull();
      expect(seen).toHaveLength(10);
      // Sorted: the browser client awaits its token first, so arrival order varies.
      expect(seen.map((s) => s.method).sort()).toEqual([...Array(5).fill("DELETE"), ...Array(5).fill("PATCH")]);
    });

    test('an empty in() is a filter that matches nothing, and is sent as "in.()"', async () => {
      const db = make();
      const r = await table(db).delete().in("id", []);
      expect(r.error).toBeNull();
      expect(seen).toHaveLength(1);
      expect(new URL(seen[0].url).searchParams.get("id")).toBe("in.()");
    });

    test("match({}) adds no filter, so it is refused like no filter at all", async () => {
      const db = make();
      const r = await table(db).delete().match({});
      expect(r.error?.message).toContain("UnfilteredWriteError");
      expect(seen).toEqual([]);
    });

    test("reads, inserts, upserts and RPC calls are not touched", async () => {
      const db = make();
      const results = await Promise.all([
        table(db).select("*"),
        table(db).insert({ title: "x" }),
        table(db).insert([{ title: "x" }]).select("id"),
        table(db).upsert({ id: "1", title: "x" }, { onConflict: "id" }),
        (db as any).rpc("purge_everything"),
        (db as any).rpc("touch", { x: 1 }, { get: true }),
      ]);
      for (const r of results) expect(r.error).toBeNull();
      expect(seen.map((s) => s.method).sort()).toEqual(["GET", "GET", "POST", "POST", "POST", "POST"]);
    });

    test("allowUnfiltered sends the write, without the marker header", async () => {
      const db = make();
      const r = await allowUnfiltered(table(db).delete(), "Rückstellung für den Test");
      expect(r.error).toBeNull();
      expect(seen).toHaveLength(1);
      expect(seen[0].method).toBe("DELETE");
      expect(seen[0].headers.has(ALLOW_UNFILTERED_HEADER)).toBe(false);
      expect(logged.some((l) => l.includes('allowed DELETE on "todos"') && l.includes("Rückstellung für den Test"))).toBe(true);
    });
  });
}

test("the browser's authenticated client still attaches its family token", async () => {
  primeFamilyToken("family-token", Math.floor(Date.now() / 1000) + 3600);
  const r = await table(createBrowserSupabaseClient() as unknown as Client).update({ title: "x" }).eq("id", "1");
  expect(r.error).toBeNull();
  expect(seen[0].headers.get("authorization")).toBe("Bearer family-token");
});

test("the server clients still reach PostgREST without the /rest/v1 prefix", async () => {
  const r = await table(createAdminClient()).delete().eq("id", "1");
  expect(r.error).toBeNull();
  expect(new URL(seen[0].url).pathname).toBe("/todos");
});

test("control: without the guard the same unfiltered writes do go out (the stub can see them)", async () => {
  // The same requests as above, through a client whose fetch is the stub
  // alone. If this ever stops seeing them, the refusal tests above prove
  // nothing.
  const bare = createSupabaseClient("http://rest.test:3000", "anon-key", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: stubFetch as typeof fetch },
  }) as unknown as Client;
  await table(bare).update({ title: "x" });
  await table(bare).delete();
  expect(seen.map((s) => `${s.method} ${new URL(s.url).pathname}${new URL(s.url).search}`)).toEqual([
    "PATCH /rest/v1/todos",
    "DELETE /rest/v1/todos",
  ]);
});

test.describe("which requests count as unfiltered writes", () => {
  const base = "http://localhost:3000/rest/v1";
  test("shaping parameters are not filters", () => {
    expect(unfilteredWriteTarget(`${base}/todos`, "DELETE")).toBe("todos");
    expect(unfilteredWriteTarget(`${base}/todos?select=id&order=id.asc&limit=1&offset=0`, "PATCH")).toBe("todos");
    expect(unfilteredWriteTarget(`${base}/todos?columns=title&on_conflict=id`, "patch")).toBe("todos");
    expect(unfilteredWriteTarget("/rest/v1/todos", "DELETE")).toBe("todos");
  });
  test("any other parameter is a filter", () => {
    expect(unfilteredWriteTarget(`${base}/todos?id=eq.1`, "DELETE")).toBeNull();
    expect(unfilteredWriteTarget(`${base}/todos?select=id&or=(a.eq.1,b.eq.2)`, "PATCH")).toBeNull();
    expect(unfilteredWriteTarget(`${base}/todos?and=(a.eq.1)`, "DELETE")).toBeNull();
    expect(unfilteredWriteTarget(`${base}/todos?id=in.()`, "DELETE")).toBeNull();
  });
  test("reads, inserts, RPC and anything outside /rest/v1 are out of scope", () => {
    expect(unfilteredWriteTarget(`${base}/todos`, "GET")).toBeNull();
    expect(unfilteredWriteTarget(`${base}/todos`, "POST")).toBeNull();
    expect(unfilteredWriteTarget(`${base}/rpc/purge`, "POST")).toBeNull();
    expect(unfilteredWriteTarget(`${base}/rpc/purge`, "PATCH")).toBeNull();
    expect(unfilteredWriteTarget("http://localhost:3000/api/todos/1", "DELETE")).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* Every deliberate exception is listed, and the list matches the code.     */
/* ------------------------------------------------------------------------ */

const SITES_FILE = "e2e/allow-unfiltered-sites.txt";
const GUARD_MODULE = "src/lib/supabase/unfiltered-write-guard.ts";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Every `allowUnfiltered(` call in `src`, as `<file> | <reason>`. The reason
 * has to be a string literal, so the list says why without anyone opening
 * the file. A call whose reason is not a literal is reported as such and
 * can't match a list entry.
 */
function allowUnfilteredSites(files: Array<{ path: string; text: string }>): string[] {
  const sites: string[] = [];
  for (const { path, text } of files) {
    const re = /\ballowUnfiltered\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      // The definition and its doc comment are not uses.
      const lineStart = text.lastIndexOf("\n", m.index) + 1;
      const line = text.slice(lineStart, m.index);
      if (/^\s*(\*|\/\/)|function\s+$/.test(line)) continue;
      let depth = 1;
      let i = m.index + m[0].length;
      const commas: number[] = [];
      for (; i < text.length && depth > 0; i++) {
        const c = text[i];
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) depth--;
        else if (c === "," && depth === 1) commas.push(i);
      }
      const close = i - 1;
      // A trailing comma after the reason is allowed.
      let end = close;
      if (commas.length && !text.slice(commas[commas.length - 1] + 1, close).trim()) end = commas.pop()!;
      const from = commas.length ? commas[commas.length - 1] + 1 : end;
      const arg = text.slice(from, end).trim();
      const literal = /^(["'`])([^"'`]*)\1$/.exec(arg);
      sites.push(`${path} | ${literal ? literal[2] : `<not a string literal: ${arg}>`}`);
    }
  }
  return sites.sort();
}

function listedSites(): string[] {
  return readFileSync(SITES_FILE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .sort();
}

test.describe("deliberate whole-table writes", () => {
  test(`every allowUnfiltered( in src is listed in ${SITES_FILE}, and nothing else is`, () => {
    const files = sourceFiles("src")
      .map((p) => relative(".", p))
      .filter((p) => p !== GUARD_MODULE)
      .map((path) => ({ path, text: readFileSync(path, "utf8") }));
    expect(allowUnfilteredSites(files)).toEqual(listedSites());
  });

  test("the scan finds a use, so an unlisted one would fail the check above", () => {
    const fixture = [
      {
        path: "src/app/api/example/route.ts",
        text: [
          "// allowUnfiltered( in a comment is not a use",
          'await allowUnfiltered(db.from("t").delete(), "reset the demo family").select();',
          "await allowUnfiltered(",
          '  admin.from("u").update({ a: f(1, 2) }),',
          "  'nightly cache rebuild',",
          ");",
          "await allowUnfiltered(q, reason);",
        ].join("\n"),
      },
    ];
    expect(allowUnfilteredSites(fixture)).toEqual([
      "src/app/api/example/route.ts | <not a string literal: reason>",
      "src/app/api/example/route.ts | nightly cache rebuild",
      "src/app/api/example/route.ts | reset the demo family",
    ]);
  });

  test("the guard module itself is the only place the header is named", () => {
    const named = sourceFiles("src")
      .map((p) => relative(".", p))
      .filter((p) => readFileSync(p, "utf8").includes("x-kinboard-allow-unfiltered"));
    expect(named).toEqual([GUARD_MODULE]);
  });
});
