/**
 * The `unit` project runs every spec file that needs no browser, once; the
 * browser projects (desktop, mobile, webkit) run the rest, three times. The
 * split is decided by a regex scan in e2e/spec-projects.ts when the config
 * loads. This spec checks the result from the other side, with TypeScript's
 * parser instead of regexes, against the projects the config really has:
 *
 *   - every spec file is in `unit` alone, or in all three browser projects;
 *   - no spec in `unit` takes a fixture in a test or hook callback, calls
 *     test's use or extend, imports a browser or request launcher from
 *     Playwright, reads the running project, or gets its `test` from anywhere
 *     but Playwright.
 *
 * A file the scan wrongly calls pure therefore fails here, rather than
 * silently losing its desktop, mobile and webkit runs.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import ts from "typescript";
import config from "../playwright.config";
import { listSpecFiles } from "./spec-projects";

const E2E = __dirname;
const BROWSER_PROJECTS = ["desktop", "mobile", "webkit"] as const;
const PLAYWRIGHT_MODULES = /^(@playwright\/test|playwright|playwright-core|@playwright\/.+)$/;
const LAUNCHERS = new Set(["chromium", "webkit", "firefox", "request", "devices", "_electron", "_android", "selectors"]);

type Matcher = string | RegExp | (string | RegExp)[] | undefined;
const asList = (m: Matcher) => (m === undefined ? [] : Array.isArray(m) ? m : [m]);
const hits = (m: string | RegExp, file: string) =>
  typeof m === "string" ? file === m || file.endsWith(`/${m}`) : m.test(file);

/** Whether a project would collect `file` (it is one of Playwright's default spec names). */
function collects(name: string, file: string): boolean {
  const project = config.projects?.find((p) => p.name === name);
  if (!project) throw new Error(`no project called ${name}`);
  const match = asList(project.testMatch as Matcher);
  const ignore = asList(project.testIgnore as Matcher);
  if (match.length > 0 && !match.some((m) => hits(m, file))) return false;
  return !ignore.some((m) => hits(m, file));
}

/** How a spec reaches a browser, fixture or launcher, read from its syntax tree. */
function fixtureUse(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const at = (node: ts.Node) => `${basename(file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      const named = node.importClause?.namedBindings;
      if (named && ts.isNamedImports(named) && !node.importClause?.isTypeOnly) {
        for (const el of named.elements) {
          const name = (el.propertyName ?? el.name).text;
          if (el.isTypeOnly) continue;
          if (PLAYWRIGHT_MODULES.test(from) && LAUNCHERS.has(name)) found.push(`${at(el)} imports ${name} from ${from}`);
          if (!PLAYWRIGHT_MODULES.test(from) && name === "test") found.push(`${at(el)} takes its \`test\` from ${from}`);
        }
      }
    }
    // testInfo.project / test.info().project: its answer differs per project.
    if (ts.isPropertyAccessExpression(node) && node.name.text === "project" && /info/i.test(node.expression.getText(source))) {
      found.push(`${at(node)} reads ${node.getText(source)}`);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      if (/^test(\.\w+)*\.(use|extend)$/.test(callee)) found.push(`${at(node)} calls ${callee}()`);
      // test(), test.describe(), test.beforeEach(), test.skip(fn), … — not
      // test.step(), whose callback gets a step, not fixtures.
      if (/^test(\.\w+)*$/.test(callee) && !callee.endsWith(".step")) {
        for (const arg of node.arguments) {
          if (!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)) continue;
          const first = arg.parameters[0];
          if (!first) continue;
          if (ts.isObjectBindingPattern(first.name) && first.name.elements.length === 0) continue;
          found.push(`${at(first)} ${callee}() callback takes fixtures: ${first.name.getText(source)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const files = listSpecFiles(E2E);
const unit = files.filter((f) => collects("unit", f));

test("there are four projects, and the split is not empty either way", () => {
  expect((config.projects ?? []).map((p) => p.name).sort()).toEqual(["desktop", "mobile", "unit", "webkit"]);
  expect(unit.length).toBeGreaterThan(100);
  expect(files.length - unit.length).toBeGreaterThan(50);
  // One of each that cannot move: this spec reads files; the hero one renders.
  expect(collects("unit", join(E2E, "spec-projects.spec.ts"))).toBe(true);
  for (const p of BROWSER_PROJECTS) expect(collects(p, join(E2E, "home-hero-layout.spec.ts"))).toBe(true);
});

test("every spec runs either once in unit or in all three browser projects", () => {
  const wrong = files.flatMap((f) => {
    const inUnit = collects("unit", f);
    const inBrowser = BROWSER_PROJECTS.filter((p) => collects(p, f));
    const ok = inUnit ? inBrowser.length === 0 : inBrowser.length === BROWSER_PROJECTS.length;
    return ok ? [] : [`${basename(f)}: unit=${inUnit}, ${inBrowser.join("+") || "no browser project"}`];
  });
  expect(wrong).toEqual([]);
});

test("the parser sees fixtures where they are, so the next check is not vacuous", () => {
  expect(fixtureUse(join(E2E, "home-hero-layout.spec.ts")).join("\n")).toContain("takes fixtures: { page }");
  const browserSpecs = files.filter((f) => !collects("unit", f));
  const seen = browserSpecs.filter((f) => fixtureUse(f).length > 0);
  expect(seen.length).toBeGreaterThan(browserSpecs.length / 2);
});

test("no spec in the unit project uses a browser, a fixture or a launcher", () => {
  expect(unit.flatMap(fixtureUse)).toEqual([]);
});
