import { test, expect } from "@playwright/test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { codeOnly } from "./source-helpers";
import { createClient } from "../src/lib/supabase/client";
import { clearFamilyToken, primeFamilyToken } from "../src/lib/supabase/family-token";
import { legacyKongAnonKey, legacyKongPageEnv, legacyKongPageScript, legacyKongUrl } from "../src/lib/supabase/legacy-kong";

/**
 * RFC-024 §4.6, phase 7 step 3: the browser sends no key, and the anon key's
 * readers retire.
 *
 * PostgREST runs a request with no `Authorization` header as its anon role
 * (PGRST_DB_ANON_ROLE=anon), and the anon key's only claim was `role: anon`,
 * so the key gave the browser nothing a missing header doesn't. Without a
 * reader, NEXT_PUBLIC_SUPABASE_ANON_KEY and NEXT_PUBLIC_SUPABASE_URL have
 * nothing left for `next build` to inline, which is how a stray `.env.local`
 * once took production down (2026-08-06).
 *
 * What stays, for one release (§4.6 step 7 removes it): the legacy Kong path
 * of a compose file from before 1.15, which reads SUPABASE_URL and the anon
 * key in one place, lib/supabase/legacy-kong.ts. With Kong as that install's
 * front door, Kong answers the browser's /rest/v1 and wants `apikey`, so
 * there, and only there, the page still carries the key and the browser
 * sends it as `apikey`. And the compose files keep passing the key, for an
 * image rolled back to 1.17, whose pages need it.
 *
 * That the two requests reach exactly the same rows on a live database is
 * e2e/rls-matrix.spec.ts's business; the wire, request for request, is
 * e2e/postgrest-client-wire.spec.ts's.
 */

const SRC = join(__dirname, "..", "src");
const DOCKER = join(__dirname, "..", "docker");
const ROOT = join(__dirname, "..", "..");

/** The one module allowed to read the legacy names. */
const SHIM = "lib/supabase/legacy-kong.ts";

/** Every .ts/.tsx file under a directory. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/**
 * Lines of code (comments blanked) under `root` that name a retired setting:
 * the anon key, the browser's API address, the Kong address, or the
 * `window.__ENV` they travelled in. Any form counts — `process.env.X`,
 * `env["X"]`, `env.X`, a string — because the name itself is what a reader
 * needs. `allow` is a path relative to `root`.
 */
function retiredReads(root: string, allow: string[] = []): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles(root)) {
    const rel = relative(root, file);
    if (allow.includes(rel)) continue;
    codeOnly(readFileSync(file, "utf8")).split("\n").forEach((line, i) => {
      if (/\bNEXT_PUBLIC_SUPABASE_(ANON_KEY|URL)\b|\bSUPABASE_URL\b|\b__ENV\b/.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

test.describe("nothing reads the retired names but the legacy Kong shim", () => {
  test("webapp/src: only lib/supabase/legacy-kong.ts names them", () => {
    expect(retiredReads(SRC, [SHIM])).toEqual([]);
    // Non-vacuity: the shim itself is seen, and reads both.
    const shim = retiredReads(SRC).filter((h) => h.startsWith(SHIM));
    expect(shim.some((h) => h.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"))).toBe(true);
    expect(shim.some((h) => h.includes("SUPABASE_URL"))).toBe(true);
  });

  test("the guard sees each form it forbids, and not a comment", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-retired-"));
    try {
      writeFileSync(join(dir, "a.ts"), "const k = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;\n");
      writeFileSync(join(dir, "b.tsx"), 'const u = env["NEXT_PUBLIC_SUPABASE_URL"];\n');
      writeFileSync(join(dir, "c.ts"), "const v = window.__ENV?.x;\n");
      writeFileSync(join(dir, "d.ts"), "const base = process.env.SUPABASE_URL;\n");
      writeFileSync(join(dir, "ok.ts"), "// NEXT_PUBLIC_SUPABASE_ANON_KEY and window.__ENV, in a comment\nconst p = process.env.POSTGREST_URL;\nconst s = env.KINBOARD_SERVICE_ROLE_KEY;\n");
      writeFileSync(join(dir, "shim.ts"), "const k = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;\n");
      expect(retiredReads(dir, ["shim.ts"]).map((h) => h.split(":")[0])).toEqual(["a.ts", "b.tsx", "c.ts", "d.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the image is built without the key or an address", () => {
    const dockerfile = codeOnly(readFileSync(join(DOCKER, "Dockerfile"), "utf8").replace(/^\s*#.*$/gm, ""));
    expect(dockerfile).not.toMatch(/NEXT_PUBLIC_SUPABASE/);
    const buildOverlay = readFileSync(join(DOCKER, "docker-compose.build.yml"), "utf8").replace(/^\s*#.*$/gm, "");
    expect(buildOverlay).not.toMatch(/NEXT_PUBLIC_SUPABASE/);
    const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8").replace(/^\s*#.*$/gm, "");
    expect(ci).not.toMatch(/NEXT_PUBLIC_SUPABASE/);
  });

  test("the compose files still pass the key, for an image rolled back to 1.17", () => {
    // 1.17's layout hands it to every page, and its client refuses to start
    // without one ("supabaseKey is required."). Removing these lines would
    // break the rollback, not this image.
    expect(readFileSync(join(DOCKER, "docker-compose.yml"), "utf8")).toMatch(/^\s+NEXT_PUBLIC_SUPABASE_ANON_KEY: \$\{ANON_KEY\}$/m);
    expect(readFileSync(join(ROOT, "compose.yml"), "utf8")).toMatch(/^\s+NEXT_PUBLIC_SUPABASE_ANON_KEY: \$\{KINBOARD_ANON_KEY:-\}$/m);
    // And the entrypoint still mints it when a one-file install sets none.
    expect(readFileSync(join(DOCKER, "secrets-store.mjs"), "utf8")).toContain('{ env: "NEXT_PUBLIC_SUPABASE_ANON_KEY", older: ["ANON_KEY"], role: "anon" }');
  });
});

test.describe("the legacy Kong shim", () => {
  test("reads Kong's address and key from what it is given, never a baked value", () => {
    expect(legacyKongUrl({ SUPABASE_URL: " http://kong:8000/ " })).toBe("http://kong:8000");
    expect(legacyKongUrl({ SUPABASE_URL: "  " })).toBeNull();
    expect(legacyKongUrl({})).toBeNull();
    expect(legacyKongAnonKey({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "kong-key" })).toBe("kong-key");
    expect(legacyKongAnonKey({})).toBe("");
    const shim = codeOnly(readFileSync(join(SRC, SHIM), "utf8"));
    expect(shim).not.toMatch(/process\.env\.NEXT_PUBLIC_/);
  });

  test("the page carries the key only behind a pre-1.15 Kong", () => {
    const kong = { SUPABASE_URL: "http://kong:8000", NEXT_PUBLIC_SUPABASE_ANON_KEY: "kong-key" };
    expect(legacyKongPageEnv(kong)).toEqual({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "kong-key" });
    // Every 1.15+ compose file sets POSTGREST_URL: no window.__ENV at all, even with the key passed.
    expect(legacyKongPageEnv({ ...kong, POSTGREST_URL: "http://rest:3000" })).toBeNull();
    expect(legacyKongPageEnv({ POSTGREST_URL: "http://rest:3000", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toBeNull();
    expect(legacyKongPageEnv({ SUPABASE_URL: "http://kong:8000" })).toBeNull();
    expect(legacyKongPageScript({ POSTGREST_URL: "http://rest:3000", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toBeNull();
    expect(legacyKongPageScript(kong)).toBe('window.__ENV={"NEXT_PUBLIC_SUPABASE_ANON_KEY":"kong-key"};');
    // A value can't close the script element.
    expect(legacyKongPageScript({ ...kong, NEXT_PUBLIC_SUPABASE_ANON_KEY: "</script><script>x()" })).not.toContain("<");
    // The layout renders exactly that, and builds nothing of its own.
    const layout = codeOnly(readFileSync(join(SRC, "app/layout.tsx"), "utf8"));
    expect(layout).toContain("legacyKongPageScript()");
    expect(layout).toMatch(/\{kongPageScript && <script dangerouslySetInnerHTML=\{\{ __html: kongPageScript \}\} \/>\}/);
  });

  test("/rest/v1 adds the key only on the way to Kong", () => {
    const route = codeOnly(readFileSync(join(SRC, "app/rest/v1/[...path]/route.ts"), "utf8"));
    expect(route).toMatch(/if \(!direct\) headers\.set\("apikey", legacyKongAnonKey\(\)\);/);
    // The browser's own apikey, if an old page still sends one, is dropped on the way in.
    const proxy = codeOnly(readFileSync(join(SRC, "lib/rest-proxy.ts"), "utf8"));
    expect(proxy).toMatch(/const DROP_REQUEST = new Set\(\[[^\]]*"apikey"/);
  });
});

type Seen = { url: string; headers: Record<string, string> };

/**
 * The browser client in Node: `window` stubbed with an origin, `fetch`
 * stubbed to record each request and answer from `answer`. The family-token
 * endpoint answers with `token` (null: no session).
 */
async function inBrowser(
  opts: { windowEnv?: Record<string, string>; tokens?: string[]; answer?: (n: number) => Response },
  run: (db: ReturnType<typeof createClient>) => Promise<unknown>,
): Promise<Seen[]> {
  const g = globalThis as { window?: unknown };
  const realFetch = globalThis.fetch;
  const had = "window" in g;
  const seen: Seen[] = [];
  let dbCalls = 0;
  let tokenCalls = 0;
  // No `document`: createClient then builds a fresh client each time instead
  // of keeping one per page, so each test sees its own window.__ENV.
  g.window = {
    location: { origin: "http://kinboard.test" },
    ...(opts.windowEnv ? { __ENV: opts.windowEnv } : {}),
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    seen.push({ url, headers });
    if (url.endsWith("/api/session/token")) {
      const t = opts.tokens?.length ? opts.tokens[Math.min(tokenCalls++, opts.tokens.length - 1)] : null;
      return Response.json(t ? { token: t, expiresAt: 4_102_444_800 } : { token: null, expiresAt: null });
    }
    return opts.answer ? opts.answer(dbCalls++) : Response.json([]);
  }) as typeof fetch;
  clearFamilyToken();
  try {
    const db = createClient();
    await run(db);
  } finally {
    globalThis.fetch = realFetch;
    if (!had) delete g.window;
    clearFamilyToken();
  }
  return seen.filter((s) => s.url.includes("/rest/v1/"));
}

test.describe("the browser client", () => {
  const savedKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  test.beforeAll(() => {
    // Set, as an old .env.local would: the client must not read it.
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "build-machine-anon-key";
  });
  test.afterAll(() => {
    if (savedKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedKey;
  });

  test("without a family session: no apikey, no Authorization, on the page's own origin", async () => {
    const seen = await inBrowser({}, (db) => db.from("todos").select("id").eq("id", "1") as unknown as Promise<unknown>);
    expect(seen).toHaveLength(1);
    expect(seen[0].url.startsWith("http://kinboard.test/rest/v1/todos?")).toBe(true);
    expect(seen[0].headers).not.toHaveProperty("apikey");
    expect(seen[0].headers).not.toHaveProperty("authorization");
  });

  test("with a family token: that token, and still no apikey", async () => {
    const seen = await inBrowser({ tokens: ["family-token"] }, (db) => db.from("todos").select("id").eq("id", "1") as unknown as Promise<unknown>);
    expect(seen.map((s) => s.headers.authorization)).toEqual(["Bearer family-token"]);
    expect(seen[0].headers).not.toHaveProperty("apikey");
  });

  test("a 401 mints a fresh token and retries once, with no key on either", async () => {
    const seen = await inBrowser(
      {
        // The token endpoint mints a second, different token after the 401.
        tokens: ["family-token-2"],
        answer: (n) => (n === 0 ? Response.json({ code: "PGRST301", message: "JWT expired" }, { status: 401 }) : Response.json([{ id: "1" }])),
      },
      async (db) => {
        primeFamilyToken("family-token", 4_102_444_800);
        const r = await db.from("todos").select("id");
        expect(r.data).toEqual([{ id: "1" }]);
      },
    );
    expect(seen.map((s) => s.headers.authorization)).toEqual(["Bearer family-token", "Bearer family-token-2"]);
    for (const s of seen) expect(s.headers).not.toHaveProperty("apikey");
  });

  test("behind a pre-1.15 Kong: the page's key as apikey, and still no Authorization without a token", async () => {
    const windowEnv = { NEXT_PUBLIC_SUPABASE_ANON_KEY: "kong-anon-key" };
    const seen = await inBrowser({ windowEnv }, (db) => db.from("todos").select("id").eq("id", "1") as unknown as Promise<unknown>);
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.apikey).toBe("kong-anon-key");
    expect(seen[0].headers).not.toHaveProperty("authorization");
    const withToken = await inBrowser({ windowEnv, tokens: ["family-token"] }, (db) => db.from("todos").select("id").eq("id", "1") as unknown as Promise<unknown>);
    expect(withToken.map((s) => [s.headers.apikey, s.headers.authorization])).toEqual([["kong-anon-key", "Bearer family-token"]]);
  });

  test("a page rendered before the update, with the old window.__ENV, works; its old address is never used", async () => {
    // What 1.17's layout wrote; a service worker can serve such a page.
    const windowEnv = { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:8130", NEXT_PUBLIC_SUPABASE_ANON_KEY: "old-page-anon-key" };
    const seen = await inBrowser({ windowEnv }, (db) => db.from("todos").select("id").eq("id", "1") as unknown as Promise<unknown>);
    expect(seen).toHaveLength(1);
    // Not the old address: the page's own origin.
    expect(new URL(seen[0].url).origin).toBe("http://kinboard.test");
    // Its key goes only as `apikey`, which the webapp's /rest/v1 drops; never as the bearer.
    expect(seen[0].headers.apikey).toBe("old-page-anon-key");
    expect(seen[0].headers).not.toHaveProperty("authorization");
    // And never the build machine's.
    expect(JSON.stringify(seen)).not.toContain("build-machine-anon-key");
  });

  test("the filterless-write guard still refuses before anything is sent", async () => {
    const seen = await inBrowser({ tokens: ["family-token"] }, async (db) => {
      const r = await (db.from("todos").delete() as unknown as Promise<{ error: { message?: string } | null }>);
      expect(r.error).not.toBeNull();
    });
    expect(seen).toEqual([]);
  });
});
