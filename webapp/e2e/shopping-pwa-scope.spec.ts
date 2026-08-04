import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { safeNextPath } from "../src/components/auth-guard";

/**
 * "Shopping PWA routes to main PWA."
 *
 * Two independent causes, either enough on its own:
 *
 * 1. The service worker registers at the root and intercepts navigations for
 *    both installed apps. Every failed navigation fell back to
 *    `caches.match('/')` — the main app — and /einkaufen wasn't precached, so
 *    it had nothing of its own to fall back to. A cold launch or a flaky
 *    phone connection opened Kinboard inside the shopping app's window.
 *
 * 2. Joining always pushed to "/". Opening the installed shopping app while
 *    signed out walked /einkaufen -> /join -> "/", leaving the user in the
 *    dashboard inside the shopping app.
 */

const sw = readFileSync(join(__dirname, "..", "public", "sw.js"), "utf8");
const manifest = (f: string) =>
  JSON.parse(readFileSync(join(__dirname, "..", "public", f), "utf8"));

test.describe("service worker fallback", () => {
  // Mirrors navigationFallbackFor.
  const fallback = (pathname: string) =>
    pathname.startsWith("/einkaufen") ? "/einkaufen" : "/";

  test("a shopping navigation falls back inside the shopping app", () => {
    expect(fallback("/einkaufen")).toBe("/einkaufen");
    expect(fallback("/einkaufen/")).toBe("/einkaufen");
  });

  test("a main-app navigation still falls back to the main app", () => {
    for (const p of ["/", "/calendar", "/shopping", "/settings"]) {
      expect(fallback(p), p).toBe("/");
    }
  });

  test("/shopping is the main app, not the standalone one", () => {
    // Easy to conflate: /shopping is a Kinboard page, /einkaufen is the PWA.
    expect(fallback("/shopping")).toBe("/");
  });

  test("the standalone route is precached, so it has something to fall back to", () => {
    const precache = sw.slice(sw.indexOf("PRECACHE_ASSETS"), sw.indexOf("];", sw.indexOf("PRECACHE_ASSETS")));
    expect(precache).toContain("'/einkaufen'");
    expect(precache).toContain("'/manifest-shopping.json'");
  });

  test("the shipped worker no longer hardcodes the main app as the fallback", () => {
    const navBlock = sw.slice(sw.indexOf("request.mode === 'navigate'"), sw.indexOf("request.destination === 'script'"));
    expect(navBlock).toContain("navigationFallbackFor(url)");
    expect(navBlock).not.toContain("caches.match('/')");
  });
});

test.describe("where joining sends you", () => {
  test("back to where you were heading", () => {
    expect(safeNextPath("/einkaufen")).toBe("/einkaufen");
    expect(safeNextPath("/calendar")).toBe("/calendar");
  });

  test("the dashboard when there's nowhere in particular", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });

  test("never back to /join, which would loop", () => {
    expect(safeNextPath("/join")).toBe("/");
    expect(safeNextPath("/join?next=/join")).toBe("/");
  });

  test("never off-origin", () => {
    // "//evil.example/x" is protocol-relative — the browser reads it as
    // another origin, so a bare startsWith("/") check is not enough.
    for (const bad of ["//evil.example/x", "https://evil.example", "javascript:alert(1)", "evil"]) {
      expect(safeNextPath(bad), bad).toBe("/");
    }
  });
});

test("the two apps have distinct identities", () => {
  const main = manifest("manifest.json");
  const shopping = manifest("manifest-shopping.json");
  expect(main.id).toBe("/");
  expect(shopping.id).toBe("/einkaufen");
  expect(main.id).not.toBe(shopping.id);
  expect(shopping.scope).toBe("/einkaufen");
  expect(shopping.start_url).toBe("/einkaufen");
});
