import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

/**
 * Every image build must serve a different sw.js.
 *
 * A page that stays open (a wall kiosk, a PWA left open on a phone) only
 * learns of a deploy when the browser fetches sw.js and finds different bytes:
 * that fires `updatefound` (hooks/use-pwa.ts), and kiosks apply it after idle
 * (components/pwa-provider.tsx). The Dockerfile used to stamp only the package
 * version into sw.js, so six deploys of 1.17.0-rc.3 in one day all served a
 * byte-identical file and no open screen noticed any of them.
 *
 * These tests run the Dockerfile's own stamping line, not a copy of it: they
 * pull the command that touches public/sw.js out of the builder stage and run
 * it twice in a scratch directory.
 */

const WEBAPP = join(__dirname, "..");
const REPO = join(WEBAPP, "..");
const dockerfile = readFileSync(join(WEBAPP, "image", "Dockerfile"), "utf8");

/** The shell command(s) in the builder RUN that write public/sw.js. */
function stampingCommands(): string {
  const lines = dockerfile
    .split("\n")
    .filter((l) => l.includes("public/sw.js") && !l.trim().startsWith("#"))
    .map((l) => l.trim().replace(/;?\s*\\$/, ""));
  expect(lines.length, "the Dockerfile stamps public/sw.js").toBeGreaterThan(0);
  return lines.join("; ");
}

/** Runs the Dockerfile's stamping on a fresh copy of sw.js; returns the result. */
function stamp(revision: string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-stamp-"));
  try {
    mkdirSync(join(dir, "public"));
    mkdirSync(join(dir, "scripts"));
    copyFileSync(join(WEBAPP, "public", "sw.js"), join(dir, "public", "sw.js"));
    copyFileSync(join(WEBAPP, "scripts", "stamp-sw.sh"), join(dir, "scripts", "stamp-sw.sh"));
    const env: NodeJS.ProcessEnv = { ...process.env, KINBOARD_VERSION: "1.17.0-rc.3" };
    delete env.BUILD_REVISION;
    if (revision !== undefined) env.BUILD_REVISION = revision;
    execFileSync("sh", ["-eu", "-c", `BUILD_REVISION="\${BUILD_REVISION:-}"; ${stampingCommands()}`], {
      cwd: dir,
      env,
      stdio: "pipe",
    });
    return readFileSync(join(dir, "public", "sw.js"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cacheName = (sw: string) => /const CACHE_NAME = '([^']+)'/.exec(sw)?.[1];

test.describe("sw.js is stamped per build", () => {
  test("two builds of the same version get different sw.js bytes", () => {
    const a = stamp("2b98b7a");
    const b = stamp("bb015e9");
    expect(a).not.toBe(b);
    expect(cacheName(a)).toBe("kinboard-1.17.0-rc.3-2b98b7a");
    expect(cacheName(b)).toBe("kinboard-1.17.0-rc.3-bb015e9");
  });

  test("a build without a revision still gets its own, non-empty one", () => {
    const a = stamp(undefined);
    const b = stamp("");
    expect(a).not.toContain("__KINBOARD_");
    expect(cacheName(a)).toMatch(/^kinboard-1\.17\.0-rc\.3-[A-Za-z0-9._-]+$/);
    expect(a).not.toBe(b);
  });

  test("the same revision gives the same bytes (no randomness when a sha is given)", () => {
    expect(stamp("6ca5123")).toBe(stamp("6ca5123"));
  });

  test("the builder stage declares BUILD_REVISION before the stamping RUN", () => {
    const builder = dockerfile.slice(dockerfile.indexOf("AS builder"), dockerfile.indexOf("AS runner"));
    const arg = builder.indexOf("ARG BUILD_REVISION");
    expect(arg, "ARG BUILD_REVISION in the builder stage").toBeGreaterThan(-1);
    expect(arg).toBeLessThan(builder.search(/^[ \t]*[^#\s].*public\/sw\.js/m));
  });

  test("dev mode keeps a literal placeholder name", () => {
    const raw = readFileSync(join(WEBAPP, "public", "sw.js"), "utf8");
    expect(cacheName(raw)).toBe("kinboard-__KINBOARD_VERSION__-__KINBOARD_REVISION__");
  });

  test("activating a new build still deletes the previous build's cache", async () => {
    const deleted: string[] = [];
    const handlers: Record<string, (e: unknown) => void> = {};
    const pending: Promise<unknown>[] = [];
    vm.runInNewContext(stamp("bb015e9"), {
      self: {
        addEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] = h),
        clients: { claim: () => Promise.resolve() },
      },
      location: { origin: "http://kiosk.local" },
      caches: {
        keys: () => Promise.resolve(["kinboard-1.17.0-rc.3-2b98b7a", "kinboard-1.17.0-rc.3-bb015e9"]),
        delete: (n: string) => (deleted.push(n), Promise.resolve(true)),
        open: () => Promise.resolve({ put: () => {}, addAll: () => Promise.resolve() }),
        match: () => Promise.resolve(undefined),
      },
      console: { log: () => {}, warn: () => {}, error: () => {} },
      URL,
      indexedDB: {},
      Promise,
    });
    handlers.activate({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
    expect(deleted).toEqual(["kinboard-1.17.0-rc.3-2b98b7a"]);
  });
});

test.describe("every build path passes the revision", () => {
  test("CI passes BUILD_REVISION to every image build", () => {
    const wf = readFileSync(join(REPO, ".github", "workflows", "docker.yml"), "utf8");
    // The webapp's builds; kinboard-updater (Dockerfile.webhook) and
    // kinboard-postgres (context webapp/image/postgres) serve no sw.js.
    const builds = wf.split("uses: docker/build-push-action@").slice(1)
      .filter((b) => !b.split(/\n\s*- (name|uses):/)[0].includes("file: webapp/docker/Dockerfile.webhook"))
      .filter((b) => /\n\s*context: webapp\n/.test(b));
    expect(builds.length).toBeGreaterThan(0);
    expect(wf.split("uses: docker/build-push-action@").length - 1, "the webapp's, the updater's, kinboard-postgres's and kinboard-aio's").toBe(builds.length + 3);
    // kinboard-aio is FROM the webapp image (its sw.js is the webapp's), and records the same revision.
    const aio = wf.split("uses: docker/build-push-action@").slice(1).find((b) => b.includes("file: webapp/image/aio/Dockerfile"));
    expect(aio).toMatch(/BUILD_REVISION=\$\{\{ steps\.app\.outputs\.short \}\}/);
    for (const b of builds) {
      const step = b.split(/\n\s*- (name|uses):/)[0];
      expect(step).toMatch(/build-args:[\s|]*\n\s*BUILD_REVISION=\$\{\{ steps\.rev\.outputs\.short \}\}/);
    }
    expect(wf).toContain('echo "short=${GITHUB_SHA::7}"');
  });

  test("a source build through compose passes it, and start.sh sets it", () => {
    const build = readFileSync(join(WEBAPP, "docker", "docker-compose.build.yml"), "utf8");
    expect(build).toMatch(/BUILD_REVISION: \$\{BUILD_REVISION:-\}/);
    const start = readFileSync(join(WEBAPP, "docker", "start.sh"), "utf8");
    expect(start).toMatch(/export BUILD_REVISION/);
    expect(start).toMatch(/BUILD_REVISION="\$\{BUILD_REVISION:-\$\(git -C .* rev-parse --short=7 HEAD/);
  });
});
