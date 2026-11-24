import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every package that ships with the app is under a licence from a short list
 * of standard ones.
 *
 * react-leaflet and @react-leaflet/core were production dependencies under
 * Hippocratic-2.1, a licence that adds use restrictions the usual open-source
 * licences do not have. Nothing flagged it: npm records the licence in the
 * lockfile and never looks at it again. This reads the same lockfile, so a
 * dependency that brings in an unusual licence fails here, in review, rather
 * than being found later.
 *
 * The list is what the lockfile held when this was written, minus Hippocratic.
 * Adding a licence to it is a decision, not a fix for a red test: read the
 * licence first.
 *
 * Development-only packages (`"dev": true`) are left out; they never reach the
 * image. Optional and dev-optional ones are kept, since a production install
 * can pull them in (sharp's platform builds are optional, for example).
 */

const ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "Apache-2.0",
  "BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "BlueOak-1.0.0",
  "LGPL-3.0-or-later",
  "MPL-2.0",
  "AFL-2.1",
  "Unlicense",
  "CC0-1.0",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "Python-2.0",
]);

interface LockEntry {
  license?: unknown;
  dev?: boolean;
  link?: boolean;
}

/**
 * Whether an SPDX expression is acceptable: every term of an AND, any
 * alternative of an OR. Lockfile expressions here are at most one level of
 * parentheses deep, e.g. "(MPL-2.0 OR Apache-2.0)" or "Apache-2.0 AND MIT".
 */
function allowed(expression: string): boolean {
  const bare = expression.trim().replace(/^\((.*)\)$/, "$1").trim();
  if (/ OR /.test(bare)) return bare.split(/ OR /).some(allowed);
  if (/ AND /.test(bare)) return bare.split(/ AND /).every(allowed);
  return ALLOWED.has(bare);
}

function shipped(lockfile: string): { name: string; license: string }[] {
  const lock = JSON.parse(readFileSync(lockfile, "utf8")) as { packages: Record<string, LockEntry> };
  return Object.entries(lock.packages)
    // "" is the app itself, a link is a workspace folder rather than a package.
    .filter(([path, entry]) => path !== "" && !entry.link && !entry.dev)
    .map(([path, entry]) => ({
      name: path.replace(/^.*node_modules\//, ""),
      license: typeof entry.license === "string" ? entry.license : JSON.stringify(entry.license ?? null),
    }));
}

const LOCKFILE = join(process.cwd(), "package-lock.json");

test("every production dependency in the lockfile has a licence from the allow-list", () => {
  const packages = shipped(LOCKFILE);
  // A lockfile without "packages" (v1) or with everything marked dev would make this vacuous.
  expect(packages.length).toBeGreaterThan(300);
  const refused = packages.filter((p) => !allowed(p.license)).map((p) => `${p.name}: ${p.license}`);
  expect(refused, "production dependencies under a licence that is not on the list").toEqual([]);
});

test("no production dependency is under the Hippocratic licence", () => {
  const hippocratic = shipped(LOCKFILE).filter((p) => /hippocratic/i.test(p.license)).map((p) => p.name);
  expect(hippocratic).toEqual([]);
});

test("the expression check reads AND, OR and parentheses the way SPDX means them", () => {
  expect(allowed("MIT")).toBe(true);
  expect(allowed("(MPL-2.0 OR Apache-2.0)")).toBe(true);
  expect(allowed("Apache-2.0 AND LGPL-3.0-or-later AND MIT")).toBe(true);
  expect(allowed("(Unlicense OR Apache-2.0)")).toBe(true);
  expect(allowed("Hippocratic-2.1")).toBe(false);
  expect(allowed("MIT AND Hippocratic-2.1")).toBe(false);
  expect(allowed("(Hippocratic-2.1 OR MIT)")).toBe(true);
  expect(allowed("SSPL-1.0")).toBe(false);
  expect(allowed("UNLICENSED")).toBe(false);
  expect(allowed("null")).toBe(false);
});
