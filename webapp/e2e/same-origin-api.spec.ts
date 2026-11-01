import { test, expect } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { publicApiEnv, serverSupabaseUrl } from "../src/lib/supabase/api-base";
import { absoluteStorageUrl, publicStorageUrl } from "../src/lib/supabase/public-url";
import { postgrestFetch } from "../src/lib/rest-proxy";

/**
 * The browser talks to the API at the address it opened Kinboard from
 * (RFC-018). Since 1.15 there is no Kong to choose between: the webapp serves
 * the app, /rest/v1 and the uploaded files itself, so one stack opened as
 * http://192.168.1.10:3001 on the kitchen tablet and as
 * https://kinboard.example.com on a phone serves both, and no setting can
 * point the browser anywhere else.
 */

test.describe("which API address the browser gets", () => {
  test("always the page's own origin, whatever an old .env still says", () => {
    expect(publicApiEnv("anon")).toEqual({ NEXT_PUBLIC_SUPABASE_URL: "same-origin", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" });
    const base = readFileSync("src/lib/supabase/api-base.ts", "utf8");
    // Nothing reads the settings that used to pick another address.
    expect(base).not.toMatch(/env\.(API_EXTERNAL_URL|KINBOARD_ENTRY|NEXT_PUBLIC_SUPABASE_URL)/);
  });

  test("the browser client builds on window.location.origin, never a baked value", () => {
    // The 2026-08-06 outage: a build carrying localhost:8130, read ahead of the runtime value.
    const client = readFileSync("src/lib/supabase/client.ts", "utf8");
    expect(client).toContain("return window.location.origin;");
    expect(client).not.toContain("process.env.NEXT_PUBLIC_SUPABASE_URL");
  });

  test("the root layout hands the browser publicApiEnv", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toContain("publicApiEnv(");
    expect(layout).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL:\s*process\.env/);
  });
});

test.describe("server-side code goes straight to PostgREST", () => {
  test("POSTGREST_URL first; a pre-1.15 compose file's Kong address until it is updated", () => {
    expect(serverSupabaseUrl({ POSTGREST_URL: "http://rest:3000/", SUPABASE_URL: "http://kong:8000" })).toBe("http://rest:3000");
    expect(serverSupabaseUrl({ SUPABASE_URL: "http://kong:8000" })).toBe("http://kong:8000");
    expect(() => serverSupabaseUrl({})).toThrow(/POSTGREST_URL is not set/);
  });

  test("the /rest/v1 prefix supabase-js adds is stripped on the way to PostgREST", async () => {
    const seen: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return new Response("[]");
    }) as typeof fetch;
    try {
      const f = postgrestFetch("http://rest:3000");
      await f("http://rest:3000/rest/v1/events?select=id&family_id=eq.1");
      await f("http://rest:3000/rest/v1/rpc/current_family_id", { method: "POST" });
      await f("http://elsewhere/rest/v1/events");
    } finally {
      globalThis.fetch = real;
    }
    expect(seen).toEqual([
      "http://rest:3000/events?select=id&family_id=eq.1",
      "http://rest:3000/rpc/current_family_id",
      "http://elsewhere/rest/v1/events",
    ]);
  });

  test("both server clients use it", () => {
    const server = readFileSync("src/lib/supabase/server.ts", "utf8");
    expect(server.match(/postgrestFetch\(/g)?.length).toBe(2);
  });
});

test.describe("stored image URLs (RFC-018 §4)", () => {
  test("new uploads store a relative path", () => {
    expect(publicStorageUrl("recipe-images", "fam/1700-abc.jpg")).toBe("/storage/v1/object/public/recipe-images/fam/1700-abc.jpg");
    expect(publicStorageUrl("recipe-images", "fam/Müsli.jpg")).toBe("/storage/v1/object/public/recipe-images/fam/M%C3%BCsli.jpg");
  });

  test("Integration API callers get the address they reached us on; foreign links pass through", () => {
    const rel = "/storage/v1/object/public/recipe-images/fam/a.jpg";
    expect(absoluteStorageUrl(rel, "https://kinboard.example.com/")).toBe(`https://kinboard.example.com${rel}`);
    expect(absoluteStorageUrl("https://img.chefkoch-cdn.de/x.jpg", "https://kb")).toBe("https://img.chefkoch-cdn.de/x.jpg");
    expect(absoluteStorageUrl(null, "https://kb")).toBeNull();
    for (const f of ["src/app/api/integration/v1/recipes/route.ts", "src/app/api/integration/v1/recipes/[id]/route.ts"]) {
      expect(readFileSync(f, "utf8"), f).toContain("absoluteStorageUrl(");
    }
  });

});

/**
 * The service worker's fetch handler, run in a sandbox with a fake cache, so
 * what it intercepts is observed rather than read off the source.
 */
test.describe("the service worker on a same-origin API", () => {
  function intercepted(pathname: string, destination = ""): boolean {
    const src = readFileSync("public/sw.js", "utf8");
    const handlers: Record<string, (e: unknown) => void> = {};
    let responded = false;
    const sandbox = {
      self: { addEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] = h), clients: { claim: () => Promise.resolve() } },
      location: { origin: "http://192.168.1.10:3001" },
      caches: { match: () => Promise.resolve(undefined), open: () => Promise.resolve({ put: () => {} }), keys: () => Promise.resolve([]) },
      fetch: () => Promise.resolve({ ok: true, clone: () => ({}) }),
      console,
      URL,
      indexedDB: {},
      Promise,
    };
    vm.runInNewContext(src, sandbox);
    handlers.fetch({
      request: { url: `http://192.168.1.10:3001${pathname}`, mode: "cors", destination },
      respondWith: () => {
        responded = true;
      },
    });
    return responded;
  }

  test("API calls and signed photo URLs go straight to the network", () => {
    expect(intercepted("/rest/v1/events?select=*")).toBe(false);
    expect(intercepted("/auth/v1/user")).toBe(false);
    expect(intercepted("/realtime/v1/websocket")).toBe(false);
    expect(intercepted("/storage/v1/object/sign/family-photos/f/a.jpg?exp=1&sig=ab", "image")).toBe(false);
    expect(intercepted("/api/realtime")).toBe(false);
  });

  test("public bucket images are cached like any other image", () => {
    expect(intercepted("/storage/v1/object/public/recipe-images/f/a.jpg", "image")).toBe(true);
    expect(intercepted("/icons/icon-192.svg", "image")).toBe(true);
  });
});

/**
 * The compose files resolved by `docker compose config` itself — with a fresh
 * .env.example and with the .env of an install from before 1.15, which still
 * carries KINBOARD_ENTRY, API_EXTERNAL_URL and Kong's ports.
 */
test.describe("the stack", () => {
  const hasCompose = spawnSync("docker", ["compose", "version"], { encoding: "utf8" }).status === 0;

  type Svc = { ports?: { published: string; target: number }[]; environment?: Record<string, string>; volumes?: { source: string; target: string }[] };
  function resolve(extraEnv: string, overlays: string[] = []) {
    const dir = mkdtempSync(join(tmpdir(), "stack-compose-"));
    try {
      const envFile = join(dir, "env");
      writeFileSync(envFile, readFileSync("docker/.env.example", "utf8") + extraEnv);
      const files = ["docker-compose.yml", ...overlays].flatMap((f) => ["-f", f]);
      // The shell's environment beats --env-file in compose; keep it out.
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const k of ["KINBOARD_ENTRY", "WEBAPP_PORT", "KONG_HTTP_PORT", "API_EXTERNAL_URL", "COMPOSE_FILES", "KINBOARD_TAG"]) delete env[k];
      const out = execFileSync("docker", ["compose", "--env-file", envFile, ...files, "config", "--format", "json"], {
        cwd: "docker",
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return JSON.parse(out) as { services: Record<string, Svc & { image?: string }> };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const pub = (s: Svc) => (s.ports ?? []).map((p) => `${p.published}:${p.target}`).sort();

  test("six services; none of the five 1.15 retired", () => {
    test.skip(!hasCompose, "needs docker compose");
    const services = Object.keys(resolve("").services).sort();
    expect(services).toEqual(["cron", "db", "db-init", "go2rtc", "rest", "webapp"]);
  });

  test("the webapp publishes 3001, runs the published image, and has its files and PostgREST", () => {
    test.skip(!hasCompose, "needs docker compose");
    const web = resolve("").services.webapp;
    expect(pub(web)).toEqual(["3001:3000"]);
    expect(web.image).toBe("ghcr.io/svenger87/kinboard:latest");
    expect(web.environment?.POSTGREST_URL).toBe("http://rest:3000");
    expect(web.environment?.FILES_DIR).toBe("/var/lib/storage/files");
    expect(web.volumes?.map((v) => v.target)).toContain("/var/lib/storage");
    for (const gone of ["KINBOARD_ENTRY", "API_EXTERNAL_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
      expect(web.environment, gone).not.toHaveProperty(gone);
    }
  });

  test("an install's old .env changes nothing: Kong's settings are simply not read", () => {
    test.skip(!hasCompose, "needs docker compose");
    const old = "KINBOARD_ENTRY=kong\nAPI_EXTERNAL_URL=http://192.168.1.10:8100\nKONG_HTTP_PORT=8101\nWEBAPP_PORT=3002\n";
    const cfg = resolve(old);
    expect(pub(cfg.services.webapp)).toEqual(["3002:3000"]);
    expect(Object.keys(cfg.services)).not.toContain("kong");
  });

  test("the image, Traefik, demo and build overlays still stack", () => {
    test.skip(!hasCompose, "needs docker compose");
    const all = resolve("", ["docker-compose.image.yml", "docker-compose.traefik.yml", "docker-compose.demo.yml.example"]);
    expect(Object.keys(all.services)).not.toContain("kong");
    expect(resolve("", ["docker-compose.build.yml"]).services.webapp.image).toBe("kinboard-webapp:local");
  });

  test(".env.example carries none of the retired settings", () => {
    const example = readFileSync("docker/.env.example", "utf8");
    for (const key of ["KINBOARD_ENTRY", "API_EXTERNAL_URL", "KONG_HTTP_PORT", "SECRET_KEY_BASE", "ADDITIONAL_REDIRECT_URLS"]) {
      expect(example, key).not.toMatch(new RegExp(`^${key}=`, "m"));
    }
  });
});
