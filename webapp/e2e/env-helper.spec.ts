import { test, expect } from "@playwright/test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { codeOnly } from "./source-helpers";
import { KEY_NAMES } from "./helpers/service-key";
import {
  deriveServiceRoleKey,
  env,
  envFrom,
  forgetEnvNotices,
  SERVICE_ROLE_KEY_NAMES,
  serviceRoleKey,
} from "../src/lib/env";
import { createAdminClient } from "../src/lib/supabase/server";

/**
 * RFC-024 §4.6, phase 7 step 1: `env(new, ...old)`, and the service-role key
 * renamed to KINBOARD_SERVICE_ROLE_KEY with SUPABASE_SERVICE_ROLE_KEY and
 * SERVICE_ROLE_KEY still read, then a key derived from JWT_SECRET.
 *
 * The entrypoint settles the same question at container start
 * (docker/secrets-store.mjs, DERIVED); both sides must give the same answer,
 * so the names and the derivation are compared here, not only described.
 */

interface StoreModule {
  DERIVED: { env: string; older: string[]; role: string }[];
  deriveKey(role: string, secret: string): string;
}
// Dynamically: Playwright's require hook mangles a statically imported .mjs.
const store: Promise<StoreModule> = import("../docker/secrets-store.mjs");

/** RFC-024 §4.6's order, written out here rather than taken from the module under test. */
const RFC_NAMES = ["KINBOARD_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"];

const SRC = join(__dirname, "..", "src");
const E2E = __dirname;

/** Capture console.info for the length of `fn`. */
function infos(fn: () => void): string[] {
  const seen: string[] = [];
  const real = console.info;
  console.info = (...args: unknown[]) => void seen.push(args.map(String).join(" "));
  try {
    fn();
  } finally {
    console.info = real;
  }
  return seen;
}

test.describe("env(new, ...old)", () => {
  test.beforeEach(() => forgetEnvNotices());

  test("the new name wins, then each old name in order; empty counts as unset", () => {
    expect(envFrom({ NEW: "n", OLD1: "a", OLD2: "b" }, "NEW", "OLD1", "OLD2")).toBe("n");
    expect(envFrom({ NEW: "", OLD1: "a", OLD2: "b" }, "NEW", "OLD1", "OLD2")).toBe("a");
    expect(envFrom({ OLD1: "", OLD2: "b" }, "NEW", "OLD1", "OLD2")).toBe("b");
    expect(envFrom({ NEW: "", OLD1: "" }, "NEW", "OLD1", "OLD2")).toBeUndefined();
    expect(envFrom({}, "NEW")).toBeUndefined();
  });

  test("an old name is announced once per process, naming both, never the value", () => {
    const lines = infos(() => {
      for (let i = 0; i < 3; i++) expect(envFrom({ OLD: "s3cret-value" }, "NEW", "OLD")).toBe("s3cret-value");
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("NEW");
    expect(lines[0]).toContain("OLD");
    expect(lines[0]).not.toContain("s3cret-value");
  });

  test("the new name, or nothing at all, is never announced", () => {
    expect(infos(() => {
      envFrom({ NEW: "n", OLD: "o" }, "NEW", "OLD");
      envFrom({}, "NEW", "OLD");
    })).toEqual([]);
  });

  test("env() reads process.env when it runs, not when it was imported", () => {
    const name = `KB_ENV_HELPER_TEST_${process.pid}`;
    try {
      expect(env(name)).toBeUndefined();
      process.env[name] = "later";
      expect(env(name)).toBe("later");
    } finally {
      delete process.env[name];
    }
  });
});

test.describe("serviceRoleKey(): KINBOARD_, then SUPABASE_, then SERVICE_ROLE_KEY, then derived", () => {
  test.beforeEach(() => forgetEnvNotices());
  const J = "0123456789abcdef0123456789abcdef";

  // Every combination of the three names (8), each with and without a JWT secret.
  for (let mask = 0; mask < 8; mask++) {
    for (const withSecret of [false, true]) {
      const set = RFC_NAMES.filter((_, i) => mask & (1 << i));
      const label = `${set.length ? set.join(" + ") : "no name"}${withSecret ? " + JWT_SECRET" : ""}`;
      test(label, () => {
        const source: Record<string, string> = {};
        for (const n of set) source[n] = `key:${n}`;
        if (withSecret) source.JWT_SECRET = J;
        infos(() => {
          if (set.length) expect(serviceRoleKey(source)).toBe(`key:${set[0]}`);
          else if (withSecret) expect(serviceRoleKey(source)).toBe(deriveServiceRoleKey(J));
          else expect(() => serviceRoleKey(source)).toThrow(/KINBOARD_SERVICE_ROLE_KEY is not set/);
        });
      });
    }
  }

  test("PGRST_JWT_SECRET is the secret's fallback, as for family tokens; JWT_SECRET wins", () => {
    expect(serviceRoleKey({ PGRST_JWT_SECRET: J })).toBe(deriveServiceRoleKey(J));
    expect(serviceRoleKey({ JWT_SECRET: J, PGRST_JWT_SECRET: "other" })).toBe(deriveServiceRoleKey(J));
  });

  test("empty names count as unset, all the way down to deriving", () => {
    expect(serviceRoleKey({ KINBOARD_SERVICE_ROLE_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", SERVICE_ROLE_KEY: "", JWT_SECRET: J }))
      .toBe(deriveServiceRoleKey(J));
  });

  test("a legacy install's name is announced once, and the key's value never", () => {
    const lines = infos(() => {
      serviceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: "legacy-key-value" });
      serviceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: "legacy-key-value" });
    });
    expect(lines).toEqual(["[env] KINBOARD_SERVICE_ROLE_KEY is not set; using SUPABASE_SERVICE_ROLE_KEY, its older name. Both keep working."]);
  });

  test("the error for no key names no value", () => {
    let message = "";
    try { serviceRoleKey({ POSTGRES_PASSWORD: "pw-value" }); } catch (e) { message = String(e); }
    expect(message).toContain("KINBOARD_SERVICE_ROLE_KEY");
    expect(message).not.toContain("pw-value");
  });
});

test.describe("the app and the entrypoint agree", () => {
  test("the same names in the same order: app, entrypoint, test helper", async () => {
    const { DERIVED } = await store;
    const service = DERIVED.find((d) => d.role === "service_role");
    expect([...SERVICE_ROLE_KEY_NAMES]).toEqual(RFC_NAMES);
    expect(service && [service.env, ...service.older]).toEqual(RFC_NAMES);
    expect([...KEY_NAMES]).toEqual(RFC_NAMES);
  });

  test("the same derived key, byte for byte", async () => {
    const { deriveKey } = await store;
    for (const secret of ["0123456789abcdef0123456789abcdef", "a secret with spaces", "ü-unicode-€", "x"]) {
      expect(deriveServiceRoleKey(secret)).toBe(deriveKey("service_role", secret));
    }
    const [h, p] = deriveServiceRoleKey("x").split(".");
    expect(Buffer.from(h, "base64url").toString()).toBe('{"alg":"HS256","typ":"JWT"}');
    expect(Buffer.from(p, "base64url").toString()).toBe('{"role":"service_role","iss":"kinboard"}');
  });
});

test.describe("createAdminClient sends the key serviceRoleKey picks", () => {
  const NAMES = [...RFC_NAMES, "JWT_SECRET", "PGRST_JWT_SECRET", "POSTGREST_URL", "SUPABASE_URL"];
  let prior: Record<string, string | undefined> = {};
  const realFetch = globalThis.fetch;
  const bearers: string[] = [];

  test.beforeEach(() => {
    forgetEnvNotices();
    prior = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
    for (const n of NAMES) delete process.env[n];
    process.env.POSTGREST_URL = "http://rest.test:3000";
    bearers.length = 0;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      bearers.push(new Headers(init?.headers).get("authorization") ?? "");
      return Promise.resolve(Response.json([], { status: 200 }));
    }) as typeof fetch;
  });
  test.afterEach(() => {
    globalThis.fetch = realFetch;
    for (const n of NAMES) {
      if (prior[n] === undefined) delete process.env[n];
      else process.env[n] = prior[n];
    }
  });

  const cases: [string, Record<string, string>, () => string][] = [
    ["the new name", { KINBOARD_SERVICE_ROLE_KEY: "k-new", SUPABASE_SERVICE_ROLE_KEY: "k-old" }, () => "k-new"],
    ["a legacy compose file's SUPABASE_SERVICE_ROLE_KEY", { SUPABASE_SERVICE_ROLE_KEY: "k-old", SERVICE_ROLE_KEY: "k-env" }, () => "k-old"],
    [".env's SERVICE_ROLE_KEY", { SERVICE_ROLE_KEY: "k-env" }, () => "k-env"],
    ["only JWT_SECRET", { JWT_SECRET: "jwt" }, () => deriveServiceRoleKey("jwt")],
  ];
  for (const [label, given, expected] of cases) {
    test(label, async () => {
      Object.assign(process.env, given);
      const real = console.info;
      console.info = () => {};
      try {
        await createAdminClient().from("families").select("id");
      } finally {
        console.info = real;
      }
      expect(bearers).toEqual([`Bearer ${expected()}`]);
    });
  }

  test("no key and no secret: the factory refuses before anything is sent", () => {
    expect(() => createAdminClient()).toThrow(/KINBOARD_SERVICE_ROLE_KEY is not set/);
    expect(bearers).toEqual([]);
  });
});

/** Every .ts/.tsx/.mjs file under a directory. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "fixtures" ? [] : sourceFiles(path);
    return /\.(ts|tsx|mjs)$/.test(name) ? [path] : [];
  });
}

/**
 * Any name containing SERVICE_ROLE_KEY, with no word boundary: the variables
 * themselves, and identifiers built on them such as SERVICE_ROLE_KEY_NAMES,
 * whose import elsewhere would be a way to read the variables around
 * lib/env.ts (found in review).
 */
const KEY_NAME = /SERVICE_ROLE_KEY/;

/**
 * App code (webapp/src) that names a service-role key variable anywhere but
 * lib/env.ts: a `process.env.X` or `process.env["X"]` read, a destructuring,
 * an `env.X` on a passed-in environment, an import of the list of names, all
 * the same. Comments don't count.
 */
function appReads(root: string, allowed: string): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles(root)) {
    if (file === allowed) continue;
    codeOnly(readFileSync(file, "utf8")).split("\n").forEach((line, i) => {
      if (KEY_NAME.test(line)) hits.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

/**
 * Specs that *read* a key variable from process.env themselves, rather than
 * asking e2e/helpers/service-key.ts. Setting one (`process.env.X = …`,
 * `delete process.env.X`) is how a spec arranges its case, and is allowed.
 */
function specReads(root: string, allowed: string[]): string[] {
  const read = /process\.env(?:\?\.|\.|\[\s*["'`]|\?\.\[\s*["'`])(?:KINBOARD_|SUPABASE_)?SERVICE_ROLE_KEY\b(?!["'`]?\]?\s*=[^=])/;
  // The helper's list of names, used to read them some other way.
  const list = /\b(?:KEY_NAMES|SERVICE_ROLE_KEY_NAMES)\b/;
  const hits: string[] = [];
  for (const file of sourceFiles(root)) {
    if (allowed.includes(file)) continue;
    codeOnly(readFileSync(file, "utf8")).split("\n").forEach((line, i) => {
      const withoutDeletes = line.replace(/delete\s+process\.env(?:\.\w+|\[[^\]]+\])/g, "");
      if (read.test(withoutDeletes) || list.test(line)) hits.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

/** A module specifier from `from` resolved to a file under root (`@/` is root), or null for a package. */
function resolveImport(root: string, from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(root, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = join(from, "..", spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* not this one */ }
  }
  return null;
}

/**
 * Files under webapp/src marked "use client" from which lib/env.ts can be
 * reached through imports, directly or through any chain of modules
 * (a client component importing lib/supabase/server pulls it in too).
 * Type-only imports are skipped: they leave nothing in the bundle.
 */
function clientImports(root: string): string[] {
  const target = join(root, "lib", "env.ts");
  const importsOf = new Map<string, string[]>();
  const edges = (file: string): string[] => {
    let out = importsOf.get(file);
    if (out) return out;
    const code = codeOnly(readFileSync(file, "utf8"));
    out = [...code.matchAll(/(?:import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)]
      .filter((m) => !m[1])
      .map((m) => resolveImport(root, file, m[2] ?? m[3]))
      .filter((f): f is string => f !== null);
    importsOf.set(file, out);
    return out;
  };
  const reaches = (start: string): boolean => {
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length) {
      for (const next of edges(queue.shift()!)) {
        if (next === target) return true;
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    return false;
  };
  return sourceFiles(root)
    .filter((file) => file !== target && /^\s*["']use client["']/.test(readFileSync(file, "utf8")) && reaches(file))
    .map((f) => relative(root, f));
}

test.describe("guard: one place reads the service-role key", () => {
  const ENV_TS = join(SRC, "lib", "env.ts");
  const SPEC_ALLOWED = [join(E2E, "helpers", "service-key.ts"), join(E2E, "env-helper.spec.ts")];

  test("no file in webapp/src but lib/env.ts names a service-role key variable", () => {
    expect(appReads(SRC, ENV_TS)).toEqual([]);
  });

  test("no spec reads a service-role key variable except through helpers/service-key.ts", () => {
    expect(specReads(E2E, SPEC_ALLOWED)).toEqual([]);
  });

  test("no client component reaches lib/env through its imports (it would carry server settings to the browser)", () => {
    expect(clientImports(SRC)).toEqual([]);
  });

  test("the guards see each form they forbid, and let the rest through", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-env-guard-"));
    try {
      mkdirSync(join(dir, "lib"));
      writeFileSync(join(dir, "lib", "env.ts"), "export const k = process.env.KINBOARD_SERVICE_ROLE_KEY;\n");
      writeFileSync(join(dir, "a.ts"), "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n");
      writeFileSync(join(dir, "b.ts"), "const k = process.env['KINBOARD_SERVICE_ROLE_KEY'];\n");
      writeFileSync(join(dir, "c.ts"), "const { SERVICE_ROLE_KEY } = process.env;\n");
      writeFileSync(join(dir, "d.ts"), "const k = env.SUPABASE_SERVICE_ROLE_KEY ?? '';\n");
      writeFileSync(join(dir, "e.ts"), "import { SERVICE_ROLE_KEY_NAMES } from '@/lib/env';\nconst k = SERVICE_ROLE_KEY_NAMES.map((n) => process.env[n]);\n");
      writeFileSync(join(dir, "ok.ts"), "// process.env.SUPABASE_SERVICE_ROLE_KEY in a comment\nconst k = serviceRoleKey();\n");
      expect([...new Set(appReads(dir, join(dir, "lib", "env.ts")).map((h) => h.split(":")[0]))]).toEqual(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]);

      writeFileSync(join(dir, "s1.spec.ts"), "const has = !!process.env.SUPABASE_SERVICE_ROLE_KEY;\n");
      writeFileSync(join(dir, "s2.spec.ts"), "const k = process.env[\"KINBOARD_SERVICE_ROLE_KEY\"] || '';\n");
      writeFileSync(join(dir, "s3.spec.ts"), "if (process.env.SERVICE_ROLE_KEY === 'x') {}\n");
      writeFileSync(join(dir, "s4.spec.ts"), "const k = process.env?.SUPABASE_SERVICE_ROLE_KEY;\n");
      writeFileSync(join(dir, "s5.spec.ts"), "import { KEY_NAMES } from './helpers/service-key';\n");
      writeFileSync(join(dir, "w.spec.ts"), "process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';\ndelete process.env.KINBOARD_SERVICE_ROLE_KEY;\nprocess.env['SERVICE_ROLE_KEY'] = 'y';\n");
      const spec = specReads(dir, []).map((h) => h.split(":")[0]);
      expect(spec.filter((f) => f.endsWith(".spec.ts"))).toEqual(["s1.spec.ts", "s2.spec.ts", "s3.spec.ts", "s4.spec.ts", "s5.spec.ts"]);

      writeFileSync(join(dir, "client.tsx"), "\"use client\";\nimport { env } from \"@/lib/env\";\n");
      writeFileSync(join(dir, "server.tsx"), "import { env } from \"@/lib/env\";\n");
      // Through a chain: client -> lib/db (relative) -> lib/env.
      writeFileSync(join(dir, "lib", "db.ts"), "import { serviceRoleKey } from \"./env\";\nexport const k = serviceRoleKey;\n");
      writeFileSync(join(dir, "chain.tsx"), "'use client';\nimport { k } from '@/lib/db';\n");
      // A type-only import leaves nothing in the bundle.
      writeFileSync(join(dir, "types-only.tsx"), "'use client';\nimport type { k } from '@/lib/db';\n");
      expect(clientImports(dir).sort()).toEqual(["chain.tsx", "client.tsx"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
