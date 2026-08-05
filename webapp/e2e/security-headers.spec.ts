import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pentest 2026-08-05, finding F2: the internet-facing app carried no security
 * response headers — no clickjacking protection, no HSTS, no MIME-sniff
 * protection.
 */

const config = readFileSync(join(__dirname, "..", "next.config.mjs"), "utf8");

test("the required headers are configured", () => {
  for (const h of [
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Content-Security-Policy",
  ]) {
    expect(config, h).toContain(h);
  }
});

test("clickjacking is blocked two ways", () => {
  expect(config).toContain("X-Frame-Options");
  expect(config).toContain("frame-ancestors 'none'");
});

test("HSTS is long-lived and covers subdomains", () => {
  expect(config).toMatch(/max-age=\d{7,}; includeSubDomains/);
});

test("the CSP deliberately omits script-src", () => {
  // A script-src CSP would break the window.__ENV inline script; that needs a
  // nonce and is a separate change. Guard against someone adding a broken one.
  const csp = config.slice(config.indexOf("Content-Security-Policy"));
  const value = csp.slice(csp.indexOf("value:"), csp.indexOf("},", csp.indexOf("value:")));
  expect(value).not.toContain("script-src");
  expect(value).toContain("frame-ancestors");
});

test("the headers apply to every path", () => {
  expect(config).toContain('source: "/:path*"');
});
