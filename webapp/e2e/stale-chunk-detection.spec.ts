import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  claimRecovery,
  isChunkLoadError,
  noteStaleBundleRetry,
  RECOVERY_WINDOW_MS,
  staleBundleRetryDelayMs,
} from "../src/lib/stale-bundle";

/**
 * #383: after a deploy, an installed iPhone app showed "Failed to load chunk"
 * on navigation and stayed there until it was force-closed. Three things were
 * wrong, and each has a check here; stale-chunk-recovery-ui.spec.ts drives
 * the whole thing against a production build.
 */

/** What Turbopack's runtime throws (see .next/static/chunks/turbopack-*.js). */
function turbopackChunkError(): Error {
  const err = new Error("Failed to load chunk /_next/static/chunks/x.js from module 123");
  err.name = "ChunkLoadError";
  return err;
}

test.describe("isChunkLoadError", () => {
  test("Turbopack's ChunkLoadError — the message never says ChunkLoadError", () => {
    const err = turbopackChunkError();
    expect(err.message).not.toMatch(/ChunkLoadError/);
    expect(isChunkLoadError(err)).toBe(true);
  });

  test("by name alone, whatever the message", () => {
    expect(isChunkLoadError({ name: "ChunkLoadError", message: "something new" })).toBe(true);
  });

  test("Turbopack's message once flattened to a string", () => {
    expect(isChunkLoadError("Failed to load chunk /_next/static/chunks/x.js from module 123")).toBe(true);
    expect(isChunkLoadError("Error: Failed to load chunk /_next/static/chunks/x.js as a runtime dependency of chunk y")).toBe(true);
  });

  test("Safari's wording for a failed dynamic import", () => {
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
  });

  test("the webpack and other-browser messages still count", () => {
    for (const message of [
      "ChunkLoadError: Loading chunk 123 failed.",
      "Loading chunk 42 failed.",
      "Loading CSS chunk 7 failed.",
      "Failed to fetch dynamically imported module: https://x/_next/a.js",
      "error loading dynamically imported module",
    ]) {
      expect(isChunkLoadError(new Error(message)), message).toBe(true);
      expect(isChunkLoadError(message), message).toBe(true);
    }
  });

  test("other errors do not", () => {
    for (const value of [
      new TypeError("Cannot read properties of undefined (reading 'x')"),
      // Safari's generic failed-fetch message: every network error, not a stale bundle.
      new TypeError("Load failed"),
      "Load failed",
      new TypeError("Failed to fetch"),
      new TypeError("NetworkError when attempting to fetch resource."),
      { name: "AbortError", message: "The operation was aborted." },
      undefined,
      null,
      42,
      {},
    ]) {
      expect(isChunkLoadError(value), String(value)).toBe(false);
    }
  });
});

/** A sessionStorage stand-in. */
function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

test.describe("the recovery guard", () => {
  test("allows one recovery, refuses another within the window", () => {
    const store = memoryStore();
    const t0 = 1_700_000_000_000;
    expect(claimRecovery(store, t0)).toBe(true);
    expect(claimRecovery(store, t0 + 5_000)).toBe(false);
    expect(claimRecovery(store, t0 + RECOVERY_WINDOW_MS - 1)).toBe(false);
  });

  test("allows the next deploy's recovery — it is not once per session", () => {
    // An installed iPhone app keeps one session for days; a once-per-session
    // flag left it stuck on every deploy after the first.
    const store = memoryStore();
    const t0 = 1_700_000_000_000;
    expect(claimRecovery(store, t0)).toBe(true);
    expect(claimRecovery(store, t0 + RECOVERY_WINDOW_MS)).toBe(true);
    expect(claimRecovery(store, t0 + 3 * 24 * 3_600_000)).toBe(true);
  });

  test("the window is about a minute", () => {
    expect(RECOVERY_WINDOW_MS).toBeGreaterThanOrEqual(30_000);
    expect(RECOVERY_WINDOW_MS).toBeLessThanOrEqual(120_000);
  });

  test("no storage: still recovers", () => {
    expect(claimRecovery(null)).toBe(true);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(claimRecovery(throwing)).toBe(true);
  });

  test("the fallback retry budget survives reloads and runs out", () => {
    const store = memoryStore();
    const delays = [1, 2, 3];
    const resetAfter = 15 * 60_000;
    let now = 1_700_000_000_000;
    const seen: (number | null)[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(staleBundleRetryDelayMs(delays, resetAfter, now, store));
      noteStaleBundleRetry(resetAfter, now, store);
      now += 1_000;
    }
    expect(seen).toEqual([1, 2, 3, null]);
    // A quiet spell gives a later, unrelated failure the full budget again.
    expect(staleBundleRetryDelayMs(delays, resetAfter, now + resetAfter + 1, store)).toBe(1);
  });
});

test.describe("wiring", () => {
  const src = (...p: string[]) => readFileSync(join(__dirname, "..", "src", ...p), "utf8");

  for (const file of ["error.tsx", "global-error.tsx"]) {
    test(`${file} reloads straight away on a chunk error`, () => {
      const source = src("app", file);
      expect(source).toMatch(/const chunkError = isChunkLoadError\(error\)/);
      expect(source).toMatch(/if \(chunkError && !recoverFromStaleBundle\(\)\)/);
      // The countdown does not start while the reload is under way.
      expect(source).toMatch(/if \(reloading\) return;/);
    });

    test(`${file} never retries a chunk error with reset() or a client navigation`, () => {
      const source = src("app", file);
      // Every way out goes through `retry`, which for a chunk error is a full load.
      expect(source).toContain("const retry = chunkError ? () => window.location.reload() : reset;");
      expect(source).toContain("resetRef = useRef(retry)");
      expect(source).not.toMatch(/onClick=\{reset\}/);
      expect(source).not.toMatch(/useRef\(reset\)/);
    });

    test(`${file} does not show the raw chunk message`, () => {
      const source = src("app", file);
      expect(source).toMatch(/chunkError \? t(\.|\(")newVersionBroken/);
    });
  }

  test("error.tsx's Home is a full load for a chunk error", () => {
    const source = src("app", "error.tsx");
    const home = source.slice(source.indexOf("{chunkError ? ("));
    expect(home.indexOf('<a href="/">')).toBeGreaterThan(-1);
    expect(home.indexOf('<a href="/">')).toBeLessThan(home.indexOf('<Link href="/">'));
  });

  test("the window listeners look at the error objects, not only their messages", () => {
    const source = src("components", "chunk-error-recovery.tsx");
    expect(source).toContain("isChunkLoadError(event.error)");
    expect(source).toContain("isChunkLoadError(event.reason)");
  });

  test("the strings exist in every language", () => {
    for (const locale of ["en", "de", "fr"]) {
      const messages = JSON.parse(
        readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"),
      ) as { components: { appError: Record<string, string> } };
      expect(messages.components.appError.newVersion, locale).toBeTruthy();
      expect(messages.components.appError.newVersionBroken, locale).toBeTruthy();
    }
    const global = src("app", "global-error.tsx");
    expect(global.split("newVersion:").length - 1).toBe(3);
    expect(global.split("newVersionBroken:").length - 1).toBe(3);
  });
});
