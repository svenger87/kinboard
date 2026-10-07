import { test, expect } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import {
  browserApiUrl,
  publicApiEnv,
  resolveBrowserBase,
  serverSupabaseUrl,
} from "../src/lib/supabase/api-base";
import { absoluteStorageUrl, publicStorageUrl } from "../src/lib/supabase/public-url";
import { toBrowserStorageUrl } from "../src/lib/supabase/signed-url";

/**
 * RFC-018: the browser talks to the API at the address it opened Kinboard
 * from. One stack, opened as http://192.168.1.10:3001 on the kitchen tablet
 * and as https://kinboard.example.com on a phone, serves both — no CORS, no
 * address baked into the bundle, nothing that breaks when the internet is
 * down and the tablet is in the same room as the server.
 */

test.describe("which API address the browser gets", () => {
  test("Kong as the front door: the old two-port address on SITE_URL's host gives way to the page's own origin", () => {
    // What every 1.12 install has; after the move the browser must not keep
    // calling :8100 on one fixed host.
    const lan = { API_EXTERNAL_URL: "http://192.168.1.10:8100", SITE_URL: "http://192.168.1.10:3001" };
    expect(browserApiUrl({ KINBOARD_ENTRY: "kong", ...lan })).toBeNull();
    expect(browserApiUrl({ KINBOARD_ENTRY: "Kong ", ...lan })).toBeNull();
    expect(browserApiUrl({ KINBOARD_ENTRY: "kong" })).toBeNull();
  });

  test("a separate API host is honoured even with Kong in front", () => {
    // A proxy may send only api.example.com to Kong and kinboard.example.com to
    // webapp:3000; same-origin calls would land on the webapp and 404.
    const env = { API_EXTERNAL_URL: "https://api.kinboard.example.com", SITE_URL: "https://kinboard.example.com" };
    expect(browserApiUrl({ KINBOARD_ENTRY: "kong", ...env })).toBe("https://api.kinboard.example.com");
    expect(browserApiUrl({ KINBOARD_ENTRY: "webapp", ...env })).toBe("https://api.kinboard.example.com");
    // Without SITE_URL nothing says it is the same host, so it is kept.
    expect(browserApiUrl({ KINBOARD_ENTRY: "kong", API_EXTERNAL_URL: "http://nas:8100" })).toBe("http://nas:8100");
  });

  test("an empty or `same-origin` API_EXTERNAL_URL means the page's own origin", () => {
    expect(browserApiUrl({ KINBOARD_ENTRY: "webapp", API_EXTERNAL_URL: "" })).toBeNull();
    expect(browserApiUrl({ KINBOARD_ENTRY: "webapp", API_EXTERNAL_URL: "same-origin" })).toBeNull();
    expect(browserApiUrl({ KINBOARD_ENTRY: "webapp", API_EXTERNAL_URL: "SAME-ORIGIN" })).toBeNull();
  });

  test("an install still on the webapp keeps its configured API address", () => {
    expect(browserApiUrl({ KINBOARD_ENTRY: "webapp", API_EXTERNAL_URL: "https://kinboard.example.com/" })).toBe(
      "https://kinboard.example.com",
    );
  });

  test("next dev (no KINBOARD_ENTRY, no API_EXTERNAL_URL) keeps NEXT_PUBLIC_SUPABASE_URL", () => {
    // RFC-018 §8: same-origin is a property of the containerised stack.
    expect(browserApiUrl({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:8130" })).toBe("http://localhost:8130");
  });

  test("API_EXTERNAL_URL, even empty, wins over a NEXT_PUBLIC value baked or passed alongside it", () => {
    expect(browserApiUrl({ API_EXTERNAL_URL: "", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:8100" })).toBeNull();
  });

  test("window.__ENV carries the address, or `same-origin`", () => {
    expect(publicApiEnv("anon", { KINBOARD_ENTRY: "kong" })).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "same-origin",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    });
    expect(publicApiEnv("anon", { KINBOARD_ENTRY: "webapp", API_EXTERNAL_URL: "http://nas:8100" }).NEXT_PUBLIC_SUPABASE_URL).toBe(
      "http://nas:8100",
    );
  });
});

test.describe("the base the browser client connects to", () => {
  const LAN = "http://192.168.1.10:3001";
  const PUBLIC = "https://kinboard.example.com";

  test("same-origin: two devices, two addresses, one stack", () => {
    expect(resolveBrowserBase("same-origin", undefined, LAN)).toBe(LAN);
    expect(resolveBrowserBase("same-origin", undefined, PUBLIC)).toBe(PUBLIC);
  });

  test("same-origin never falls through to an address baked into the build", () => {
    // The 2026-08-06 outage: a build carrying localhost:8130, read ahead of the runtime value.
    expect(resolveBrowserBase("same-origin", "http://localhost:8130", PUBLIC)).toBe(PUBLIC);
  });

  test("a configured address is used as it is", () => {
    expect(resolveBrowserBase("http://nas:8100/", "http://localhost:8130", LAN)).toBe("http://nas:8100");
  });

  test("with no window.__ENV at all, the build-time value, else the origin", () => {
    expect(resolveBrowserBase(undefined, "http://localhost:8130", LAN)).toBe("http://localhost:8130");
    expect(resolveBrowserBase(undefined, undefined, LAN)).toBe(LAN);
    expect(resolveBrowserBase("", "same-origin", LAN)).toBe(LAN);
  });

  test("the client reads the runtime value through resolveBrowserBase, not the raw env", () => {
    const client = readFileSync("src/lib/supabase/client.ts", "utf8");
    expect(client).toContain("resolveBrowserBase(");
    expect(client).toContain("browserApiBase(),");
  });
});

test.describe("server-side code stays on the internal address", () => {
  test("SUPABASE_URL (http://kong:8000) first, never the browser's address", () => {
    expect(serverSupabaseUrl({ SUPABASE_URL: "http://kong:8000", KINBOARD_ENTRY: "kong" })).toBe("http://kong:8000");
    expect(serverSupabaseUrl({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:8130" })).toBe("http://localhost:8130");
    expect(() => serverSupabaseUrl({ KINBOARD_ENTRY: "kong" })).toThrow(/SUPABASE_URL is not set: .*http:\/\/kong:8000/);
  });

  test("the server client and the proxy build on it, not on NEXT_PUBLIC_SUPABASE_URL", () => {
    for (const f of ["src/lib/supabase/server.ts", "src/proxy.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("serverSupabaseUrl()");
      expect(src, f).not.toContain("process.env.NEXT_PUBLIC_SUPABASE_URL!");
    }
  });

  test("the root layout decides per request, through publicApiEnv", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toContain("publicApiEnv(");
    expect(layout).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL:\s*process\.env/);
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

  test("a signed photo URL stays relative when the API is the page's own origin", () => {
    const signed = "http://kong:8000/storage/v1/object/sign/family-photos/f/a.jpg?token=t";
    expect(toBrowserStorageUrl(signed, undefined, "anon")).toBe("/storage/v1/object/sign/family-photos/f/a.jpg?token=t&apikey=anon");
  });

  test("an install still on the webapp serves the relative path itself, from Kong inside the stack", () => {
    const route = readFileSync("src/app/storage/v1/object/public/[...path]/route.ts", "utf8");
    expect(route).toContain("serverSupabaseUrl()");
    expect(route).toContain('p === ".."');
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
    expect(intercepted("/storage/v1/object/sign/family-photos/f/a.jpg?token=t", "image")).toBe(false);
  });

  test("public bucket images are cached like any other image", () => {
    expect(intercepted("/storage/v1/object/public/recipe-images/f/a.jpg", "image")).toBe(true);
    expect(intercepted("/icons/icon-192.svg", "image")).toBe(true);
  });
});

/**
 * The compose files resolved by `docker compose config` itself, with each
 * value of KINBOARD_ENTRY and with the overlays real installs stack on top.
 */
test.describe("which container publishes 3001", () => {
  const hasCompose = spawnSync("docker", ["compose", "version"], { encoding: "utf8" }).status === 0;

  function ports(entry: string | null, overlays: string[] = []) {
    const dir = mkdtempSync(join(tmpdir(), "entry-compose-"));
    try {
      const envFile = join(dir, "env");
      const example = readFileSync("docker/.env.example", "utf8").replace(/^KINBOARD_ENTRY=.*\n/m, "");
      writeFileSync(envFile, entry === null ? example : `${example}KINBOARD_ENTRY=${entry}\n`);
      const files = ["docker-compose.yml", ...overlays].flatMap((f) => ["-f", f]);
      // The shell's environment beats --env-file in compose; keep it out.
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const k of ["KINBOARD_ENTRY", "WEBAPP_PORT", "KONG_HTTP_PORT", "KONG_HTTPS_PORT", "API_EXTERNAL_URL"]) delete env[k];
      const out = execFileSync("docker", ["compose", "--env-file", envFile, ...files, "config", "--format", "json"], {
        cwd: "docker",
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const cfg = JSON.parse(out) as { services: Record<string, { ports?: { published: string; target: number }[]; environment?: Record<string, string> }> };
      const pub = (s: string) => (cfg.services[s].ports ?? []).map((p) => `${p.published}:${p.target}`).sort();
      return { kong: pub("kong"), webapp: pub("webapp"), env: cfg.services.webapp.environment ?? {} };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("kong: Kong takes 3001 and keeps 8100; the webapp publishes nothing", () => {
    test.skip(!hasCompose, "needs docker compose");
    const p = ports("kong");
    expect(p.kong).toEqual(["3001:8000", "8100:8000", "8543:8443"]);
    expect(p.webapp).toEqual([]);
    expect(p.env.KINBOARD_ENTRY).toBe("kong");
  });

  test("webapp, or no setting at all (an install from before): today's layout", () => {
    test.skip(!hasCompose, "needs docker compose");
    for (const entry of ["webapp", null]) {
      const p = ports(entry);
      expect(p.kong).toEqual(["8100:8000", "8543:8443"]);
      expect(p.webapp).toEqual(["3001:3000"]);
      expect(p.env.KINBOARD_ENTRY).toBe("webapp");
    }
  });

  test("the published-image, Traefik and demo overlays stack on either layout", () => {
    test.skip(!hasCompose, "needs docker compose");
    const overlays = ["docker-compose.image.yml", "docker-compose.traefik.yml", "docker-compose.demo.yml.example"];
    expect(ports("kong", overlays).kong).toContain("3001:8000");
    expect(ports("webapp", overlays).webapp).toEqual(["3001:3000"]);
  });

  test("a new install's .env.example starts on kong, with no API address", () => {
    const example = readFileSync("docker/.env.example", "utf8");
    expect(example).toMatch(/^KINBOARD_ENTRY=kong$/m);
    expect(example).toMatch(/^API_EXTERNAL_URL=$/m);
  });
});
