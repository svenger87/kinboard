import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * /api/unsplash/image fetched whatever URL it was handed and returned the
 * body verbatim. No host check, no family check, no authentication.
 *
 * Demonstrated against the running instance before the fix: pointing it at
 * http://localhost:3000/ returned the dashboard's own HTML with a 200, and
 * http://kong:8000/ reached the Supabase gateway. Anything able to reach a
 * Kinboard instance could read arbitrary URLs from inside the network —
 * other containers, a router's admin page, a cloud metadata endpoint.
 */

const source = readFileSync(
  join(__dirname, "..", "src", "app", "api", "unsplash", "image", "route.ts"),
  "utf8",
);

const ALLOWED = new Set(["images.unsplash.com", "plus.unsplash.com"]);
const accept = (raw: string): boolean => {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === "https:" && ALLOWED.has(u.hostname);
};

test("the URLs that were exploitable are refused", () => {
  for (const url of [
    "http://localhost:3000/",
    "http://127.0.0.1:3000/",
    "http://kong:8000/",
    "http://kinboard-db:5432/",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.1.1/",
    "file:///etc/passwd",
    "http://images.unsplash.com/x.jpg", // http, not https
  ]) {
    expect(accept(url), url).toBe(false);
  }
});

test("real Unsplash URLs still work", () => {
  expect(accept("https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1080")).toBe(true);
  expect(accept("https://plus.unsplash.com/premium_photo-123?w=1080")).toBe(true);
});

test("a lookalike host doesn't slip through", () => {
  // Substring matching would let all of these past.
  for (const url of [
    "https://images.unsplash.com.evil.example/x.jpg",
    "https://evil.example/images.unsplash.com/x.jpg",
    "https://notimages.unsplash.com/x.jpg",
    "https://images.unsplash.com@evil.example/x.jpg",
  ]) {
    expect(accept(url), url).toBe(false);
  }
});

test("garbage is refused rather than thrown on", () => {
  for (const url of ["", "not a url", "//images.unsplash.com/x.jpg", "javascript:alert(1)"]) {
    expect(accept(url), JSON.stringify(url)).toBe(false);
  }
});

test("the route requires a family_id, which the caller always sent", () => {
  expect(source).toContain("family_id and photo_url are required");
  expect(source).toContain('searchParams.get("family_id")');
});

test("redirects are not followed off the allowlisted host", () => {
  // Otherwise a 302 from an allowed host walks straight back out.
  expect(source).toContain('redirect: "manual"');
  expect(source).toContain("unexpected redirect");
});

test("a non-image content type is not passed through", () => {
  expect(source).toContain('contentType.startsWith("image/")');
});

test("the fetch is time-bounded", () => {
  expect(source).toContain("AbortSignal.timeout");
});
