/*
  Which spec files need a browser, and which are plain Node tests.

  Most of e2e/ never opens a page: the specs read source files, call pure
  functions, or talk to the database and PostgREST from Node. They used to run
  in all three browser projects (desktop, mobile, webkit), i.e. three times
  over, for nothing — the viewport and the engine never reach them. They now
  run once, in the `unit` project; the browser specs stay in all three.

  The rule is read off the source, once, when the config loads. It is
  deliberately conservative: when in doubt a file counts as a browser spec.
  Calling a pure spec a browser spec costs two extra runs; the other mistake
  would quietly drop it from desktop, mobile and webkit. A file is a browser
  spec when any of these holds:

    1. It destructures one of Playwright's own fixtures or options in any
       function's parameter list — `page`, `context`, `browser`, `request`,
       `browserName`, `baseURL`, `playwright`, `viewport`, … (see FIXTURES).
       Any `({ page }) =>` or `function ({ page }) {`, not only a test's or a
       hook's, so a helper inside the spec counts too. An object literal
       passed as an argument, `t({ locale })`, is not a parameter list.
    2. It mentions `browserName`, `baseURL`, `test.use(`, `.extend(` /
       `.extend<` (a custom fixture), `newContext(`, `newPage(`, `.launch(`,
       `connectOverCDP`, or reads the running project (`project.name`,
       `project.use`), whose answer differs between the projects.
    3. It imports a launcher from Playwright (`chromium`, `webkit`, `firefox`,
       `request`, `devices`, `_electron`, `_android`) — that makes its own
       browser or HTTP context without a fixture.
    4. It uses a browser type in a type position (`: Page`, `<Page>`,
       `type Page`): `Page`, `BrowserContext`, `Browser`, `APIRequestContext`,
       `Locator`, `ElementHandle`, `Frame`. A header called X-Frame-Options or
       "Radio Browser" in a comment does not count.
    5. It imports (directly or through other e2e/ modules) a local helper for
       which 2–4 hold, i.e. a helper that takes a page or a request context.

  Everything else is `unit`. The `unit` project cannot launch a browser at all
  (see playwright.config.ts), and e2e/spec-projects.spec.ts checks the split
  from the other side with a broader scan, so a mistake here shows up as a red
  test rather than as missing coverage.
*/
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Playwright's built-in test fixtures and `use` options. */
export const FIXTURES = [
  // fixtures
  "page",
  "context",
  "browser",
  "browserName",
  "request",
  "playwright",
  // options: they differ per project, or only mean something to a browser
  "baseURL",
  "viewport",
  "isMobile",
  "hasTouch",
  "deviceScaleFactor",
  "locale",
  "timezoneId",
  "colorScheme",
  "reducedMotion",
  "forcedColors",
  "geolocation",
  "permissions",
  "storageState",
  "userAgent",
  "headless",
  "channel",
  "launchOptions",
  "contextOptions",
  "connectOptions",
  "javaScriptEnabled",
  "offline",
  "serviceWorkers",
  "extraHTTPHeaders",
  "httpCredentials",
  "ignoreHTTPSErrors",
  "bypassCSP",
  "acceptDownloads",
  "proxy",
  "screenshot",
  "trace",
  "video",
  "testIdAttribute",
  "actionTimeout",
  "navigationTimeout",
  "defaultBrowserType",
] as const;

const FIXTURE_WORD = new RegExp(`\\b(${FIXTURES.join("|")})\\b`);
/** A `({ … })` destructuring, across lines, without nesting. */
const DESTRUCTURE = /\(\s*\{([^{}()]*)\}/g;
const DIRECT_MARKERS: RegExp[] = [
  /\bbrowserName\b/,
  /\bbaseURL\b/,
  /\btest\s*\.\s*use\s*\(/,
  /\.\s*extend\s*[<(]/,
  /\bnewContext\s*\(/,
  /\bnewPage\s*\(/,
  /\.\s*launch(PersistentContext|Server)?\s*\(/,
  /\bconnectOverCDP\b/,
  /\bproject\s*\.\s*(name|use)\b/,
  /(?:[:<|,]\s*|\btype\s+)(Page|BrowserContext|Browser|APIRequestContext|Locator|ElementHandle|Frame)\b(?![-\w])/,
];
/** `import { chromium, request } from "@playwright/test"` and friends. */
const PLAYWRIGHT_IMPORT = /import\s+(?!type\b)\{([^}]*)\}\s*from\s*["'](@playwright\/test|playwright|playwright-core|@playwright\/[^"']+)["']/g;
const LAUNCHERS = /\b(chromium|webkit|firefox|request|devices|_electron|_android|selectors)\b/;
const RELATIVE_IMPORT = /(?:from|import|require\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g;

/** Why a source uses a browser by itself (rules 1–4), or null. */
/**
 * Whether the `(` at `open` starts a parameter list: after its matching `)`
 * comes `=>` (an arrow function) or `{` (a function body). A type annotation
 * inside, `({ page }: { page: Page })`, is skipped by the depth count.
 */
function isParameterList(source: string, open: number): boolean {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    if (depth === 0) return /^\s*(=>|\{)/.test(source.slice(i + 1, i + 40));
  }
  return false;
}

export function ownBrowserUse(source: string): string | null {
  for (const m of source.matchAll(DESTRUCTURE)) {
    if (!isParameterList(source, m.index)) continue;
    const hit = m[1].match(FIXTURE_WORD);
    if (hit) return `destructures \`${hit[1]}\``;
  }
  for (const re of DIRECT_MARKERS) {
    const hit = source.match(re);
    if (hit) return `mentions \`${hit[0].trim()}\``;
  }
  for (const m of source.matchAll(PLAYWRIGHT_IMPORT)) {
    const names = m[1].replace(/\btype\s+\w+/g, "");
    const hit = names.match(LAUNCHERS);
    if (hit) return `imports \`${hit[1]}\` from ${m[2]}`;
  }
  return null;
}

function resolveLocal(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Why `file` needs a browser (rules 1–5), or null when it is a plain Node
 * test. Follows relative imports that stay inside `e2eDir`; app code under
 * src/ cannot take a page, and JSON fixtures are data.
 */
export function browserReason(
  file: string,
  e2eDir: string,
  seen = new Map<string, string | null>(),
): string | null {
  if (seen.has(file)) return seen.get(file) ?? null;
  seen.set(file, null); // breaks import cycles; a cycle adds nothing new
  const source = readFileSync(file, "utf8");
  let reason = ownBrowserUse(source);
  if (!reason) {
    for (const m of source.matchAll(RELATIVE_IMPORT)) {
      const target = resolveLocal(file, m[1]);
      if (!target || !target.startsWith(e2eDir) || target.endsWith(".json")) continue;
      if (target === join(e2eDir, "spec-projects.ts")) continue; // this file: its patterns name every marker, it uses none
      const inner = browserReason(target, e2eDir, seen);
      if (inner) {
        reason = `imports ${m[1]}, which ${inner}`;
        break;
      }
    }
  }
  seen.set(file, reason);
  return reason;
}

/** Playwright's default testMatch: `**\/*.@(spec|test).?(c|m)[jt]s?(x)`. */
const SPEC_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;

export function listSpecFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "results") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSpecFiles(path));
    else if (SPEC_FILE.test(entry.name)) out.push(path);
  }
  return out.sort();
}

export interface SpecSplit {
  /** Absolute paths of the specs that run once, in `unit`. */
  unit: string[];
  /** Absolute paths of the specs that run in desktop, mobile and webkit, with the reason. */
  browser: Map<string, string>;
}

export function splitSpecs(e2eDir: string): SpecSplit {
  const dir = resolve(e2eDir);
  const seen = new Map<string, string | null>();
  const unit: string[] = [];
  const browser = new Map<string, string>();
  for (const file of listSpecFiles(dir)) {
    const reason = browserReason(file, dir, seen);
    if (reason) browser.set(file, reason);
    else unit.push(file);
  }
  return { unit, browser };
}

/** Exact-path matchers for testMatch / testIgnore. */
export function exactly(files: string[]): RegExp[] {
  return files.map((f) => new RegExp(`^${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}
